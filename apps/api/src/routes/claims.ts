import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { ClaimStatus } from "@alberta-rules/core";
import { bodyHash, httpError } from "../services/security.js";
import {
  audit,
  createClaim,
  evaluateRequest,
  lockPatient,
  moveStatus,
  saveDecision,
  wireFromContext,
} from "../services/adjudication.js";
import * as s from "../db/schema.js";
import * as schemas from "../schemas.js";
import type { RoutesContext } from "./context.js";
export function registerClaimsRoutes(context: RoutesContext) {
  const { app, db, now, any, write, admin, access, secure, outcomes } = context;
  app.get(
    "/api/v1/claims",
    {
      preHandler: any,
      schema: {
        ...secure,
        querystring: z.strictObject({
          status: schemas.statusSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        summary: "List recent claims with their latest decision",
        tags: ["Claims"],
      },
    },
    async (req) =>
      db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(s.claims)
          .where(
            req.query.status
              ? eq(s.claims.status, req.query.status)
              : undefined,
          )
          .orderBy(desc(s.claims.createdAt))
          .limit(req.query.limit)
          .offset(req.query.offset);
        const claimIds = rows.map((row) => row.id);
        const patientIds = [...new Set(rows.map((row) => row.patientId))];
        const planIds = [...new Set(rows.map((row) => row.planId))];
        const [adjudications, patientRows, planRows] = await Promise.all([
          claimIds.length
            ? tx
                .select()
                .from(s.claimAdjudications)
                .where(inArray(s.claimAdjudications.claimId, claimIds))
                .orderBy(desc(s.claimAdjudications.seq))
            : [],
          patientIds.length
            ? tx
                .select({
                  id: s.patients.id,
                  firstName: s.patients.firstName,
                  lastName: s.patients.lastName,
                })
                .from(s.patients)
                .where(inArray(s.patients.id, patientIds))
            : [],
          planIds.length
            ? tx
                .select({
                  id: s.insurancePlans.id,
                  planId: s.insurancePlans.planId,
                  name: s.insurancePlans.name,
                })
                .from(s.insurancePlans)
                .where(inArray(s.insurancePlans.id, planIds))
            : [],
        ]);
        await audit(tx, req.actor!, "read", "claim:list");
        return rows.map((claim) => {
          const latest = adjudications.find((a) => a.claimId === claim.id);
          const patient = patientRows.find((p) => p.id === claim.patientId);
          const plan = planRows.find((p) => p.id === claim.planId);
          return {
            id: claim.id,
            patient_id: claim.patientId,
            patient_name: patient
              ? `${patient.firstName} ${patient.lastName}`
              : "Unknown patient",
            plan_id: claim.planId,
            plan_code: plan?.planId ?? null,
            plan_name: plan?.name ?? null,
            status: claim.status,
            outcome: latest?.outcome ?? null,
            billed_amount: claim.billedAmount / 100,
            plan_pays_total: latest?.decision.planPaysTotal
              ? latest.decision.planPaysTotal / 100
              : 0,
            service_date: claim.serviceDate,
            provider_billing_number: claim.providerBillingNumber,
            denial_reason_code: claim.denialReasonCode,
            created_at: claim.createdAt,
          };
        });
      }),
  );
  app.post(
    "/api/v1/evaluate",
    {
      preHandler: access(["admin", "biller"], "evaluate:write"),
      schema: {
        ...secure,
        body: schemas.evaluateSchema,
        querystring: z.strictObject({
          trace: z.enum(["true", "false"]).optional(),
        }),
        response: { 200: schemas.decisionResponseSchema },
        summary: "Evaluate without persisting a claim or consuming benefits",
        tags: ["Claims"],
      },
    },
    async (req) =>
      db.transaction(
        async (tx) => {
          const { decision } = await evaluateRequest(
            tx,
            req.body,
            now(),
            false,
          );
          outcomes.inc({ outcome: decision.outcome });
          // Required patient-access audit is the sole write in a dry run.
          await audit(tx, req.actor!, "read", `patient:${req.body.patient_id}`);
          return schemas.decisionWire(decision, req.query.trace === "true");
        },
        { isolationLevel: "repeatable read" },
      ),
  );
  app.post(
    "/api/v1/claims",
    {
      preHandler: write,
      schema: {
        ...secure,
        body: schemas.evaluateSchema,
        headers: z.object({
          "idempotency-key": z.string().min(1).max(200).optional(),
        }),
        summary: "Adjudicate and persist a claim",
        tags: ["Claims"],
      },
    },
    async (req, reply) => {
      const key = req.headers["idempotency-key"];
      const owner = `user:${req.actor!.userId}`;
      const hash = bodyHash(req.body);
      const response = await db.transaction(async (tx) => {
        if (key) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${owner + ":" + key},0))`,
          );
          const [old] = await tx
            .select()
            .from(s.idempotencyKeys)
            .where(
              and(
                eq(s.idempotencyKeys.owner, owner),
                eq(s.idempotencyKeys.key, key),
              ),
            );
          if (old && Date.parse(old.expiresAt) > now().getTime()) {
            if (old.bodyHash !== hash)
              throw httpError(
                409,
                "Idempotency key reused with a different body",
              );
            await audit(tx, req.actor!, "read", "claim:idempotency-replay");
            return { status: old.statusCode, body: old.response };
          }
          if (old)
            await tx
              .delete(s.idempotencyKeys)
              .where(eq(s.idempotencyKeys.id, old.id));
        }
        const result = await createClaim(tx, req.body, now(), req.actor!);
        if (key)
          await tx.insert(s.idempotencyKeys).values({
            owner,
            key,
            bodyHash: hash,
            statusCode: result.status,
            response: result.body,
            expiresAt: new Date(now().getTime() + 86400000).toISOString(),
          });
        return result;
      });
      return reply.code(response.status).send(response.body);
    },
  );
  app.get(
    "/api/v1/claims/:id",
    {
      preHandler: access(["admin", "biller", "analyst"], "claims:read"),
      schema: {
        ...secure,
        params: schemas.idParams,
        summary:
          "Read claim, adjudication history, status history and review flags",
        tags: ["Claims"],
      },
    },
    async (req) =>
      db.transaction(async (tx) => {
        const [claim] = await tx
          .select()
          .from(s.claims)
          .where(eq(s.claims.id, req.params.id));
        if (!claim) throw httpError(404, "Claim not found");
        const adjudications = await tx
          .select()
          .from(s.claimAdjudications)
          .where(eq(s.claimAdjudications.claimId, claim.id))
          .orderBy(desc(s.claimAdjudications.seq));
        const flags = await tx
          .select()
          .from(s.claimFlags)
          .where(eq(s.claimFlags.claimId, claim.id));
        const history = await tx
          .select()
          .from(s.claimStatusHistory)
          .where(eq(s.claimStatusHistory.claimId, claim.id));
        await audit(tx, req.actor!, "read", `claim:${claim.id}`);
        return {
          id: claim.id,
          patient_id: claim.patientId,
          status: claim.status,
          province: claim.province,
          billed_amount: claim.billedAmount / 100,
          denial_reason_code: claim.denialReasonCode,
          coverage_snapshot: schemas.snake(claim.coverageSnapshot),
          decision: adjudications[0]
            ? schemas.decisionWire(adjudications[0].decision, true)
            : null,
          adjudications: adjudications.map((a) => ({
            id: a.id,
            seq: a.seq,
            supersedes_id: a.supersedesId,
            created_at: a.createdAt,
            decision: schemas.decisionWire(a.decision, true),
          })),
          status_history: schemas.snake(history),
          flags: schemas.snake(flags),
        };
      }),
  );
  app.post(
    "/api/v1/claims/:id/status",
    {
      preHandler: write,
      schema: {
        ...secure,
        params: schemas.idParams,
        body: z.strictObject({
          to_status: schemas.statusSchema,
          reason_code: z.string().min(1).max(100).optional(),
          correction: schemas.evaluateSchema.optional(),
        }),
        summary:
          "Apply a legal transition; rejected resubmissions rerun adjudication",
        tags: ["Claims"],
      },
    },
    async (req) =>
      db.transaction(async (tx) => {
        const [claim] = await tx
          .select()
          .from(s.claims)
          .where(eq(s.claims.id, req.params.id));
        if (!claim) throw httpError(404, "Claim not found");
        await lockPatient(tx, claim.patientId);
        const [current] = await tx
          .select()
          .from(s.claims)
          .where(eq(s.claims.id, claim.id))
          .for("update");
        if (
          current!.status === "rejected" &&
          req.body.to_status === "submitted"
        ) {
          if (!req.body.correction)
            throw httpError(
              422,
              "A corrected claim is required for resubmission",
            );
          if (
            req.body.correction.patient_id !== claim.patientId ||
            req.body.correction.plan_id !== claim.planId ||
            req.body.correction.history ||
            req.body.correction.prior_accumulators
          )
            throw httpError(
              422,
              "Correction must keep the patient and plan and use stored history",
            );
          const { decision, ctx, planRows } = await evaluateRequest(
            tx,
            req.body.correction,
            now(),
            true,
            claim.id,
          );
          await tx
            .update(s.claims)
            .set({
              context: ctx,
              providerBillingNumber: ctx.providerBillingNumber,
              serviceDate: ctx.serviceDate,
              receivedDate: ctx.receivedDate,
              billedAmount: decision.billedAmount,
              coverageSnapshot: decision.coverageSnapshot,
              dateOfLoss: ctx.dateOfLoss ?? null,
              denialReasonCode: decision.primaryReasonCode,
            })
            .where(eq(s.claims.id, claim.id));
          await tx
            .delete(s.claimLines)
            .where(eq(s.claimLines.claimId, claim.id));
          await tx.insert(s.claimLines).values(
            ctx.lines.map((l, i) => ({
              claimId: claim.id,
              lineNo: i + 1,
              serviceCode: l.serviceCode,
              diagnosisCode: l.diagnosisCode,
              units: l.units,
              amount: l.amount,
              serviceDate: l.serviceDate ?? ctx.serviceDate,
              priorAuthNumber: l.priorAuthNumber,
            })),
          );
          await moveStatus(tx, claim.id, "rejected", "submitted", null, now());
          if (decision.suggestedStatus !== "submitted")
            await moveStatus(
              tx,
              claim.id,
              "submitted",
              decision.suggestedStatus,
              decision.primaryReasonCode,
              now(),
            );
          await saveDecision(tx, claim.id, decision, claim.patientId, planRows);
          await audit(
            tx,
            req.actor!,
            "update",
            `claim:${claim.id}`,
            "Corrected resubmission",
          );
          return {
            id: claim.id,
            status: decision.suggestedStatus,
            decision: schemas.decisionWire(decision),
          };
        }
        await moveStatus(
          tx,
          claim.id,
          current!.status,
          req.body.to_status,
          req.body.reason_code ?? null,
          now(),
        );
        await audit(tx, req.actor!, "update", `claim:${claim.id}`);
        return { id: claim.id, status: req.body.to_status };
      }),
  );
  app.post(
    "/api/v1/claims/:id/reprocess",
    {
      preHandler: admin,
      schema: {
        ...secure,
        params: schemas.idParams,
        body: schemas.reasonSchema,
        summary: "Append a fresh adjudication and flag downstream review",
        tags: ["Claims"],
      },
    },
    async (req, reply) => {
      const result = await db.transaction(async (tx) => {
        const [claim] = await tx
          .select()
          .from(s.claims)
          .where(eq(s.claims.id, req.params.id));
        if (!claim) throw httpError(404, "Claim not found");
        await lockPatient(tx, claim.patientId);
        const [current] = await tx
          .select()
          .from(s.claims)
          .where(eq(s.claims.id, claim.id))
          .for("update");
        if (["paid", "closed"].includes(current!.status))
          throw httpError(409, "Terminal claim cannot be reprocessed");
        const rows = await tx
          .select()
          .from(s.insurancePlans)
          .where(inArray(s.insurancePlans.planId, claim.context.planIds));
        const body = wireFromContext(
          claim.context,
          claim.patientId,
          claim.planId,
          rows.map((p) => p.id),
        );
        const { decision, planRows } = await evaluateRequest(
          tx,
          body,
          now(),
          true,
          claim.id,
        );
        const a = await saveDecision(
          tx,
          claim.id,
          decision,
          claim.patientId,
          planRows,
        );
        // Status is a separate audited workflow; reprocessing does not invent illegal denied->submitted edges.
        await tx
          .update(s.claimFlags)
          .set({ clearedAt: now().toISOString() })
          .where(
            and(
              eq(s.claimFlags.claimId, claim.id),
              eq(s.claimFlags.flag, "REPROCESS_CANDIDATE"),
            ),
          );
        await audit(
          tx,
          req.actor!,
          "update",
          `claim:${claim.id}`,
          req.body.reason,
        );
        return {
          id: a.id,
          claim_id: claim.id,
          seq: a.seq,
          supersedes_id: a.supersedesId,
          status: current!.status,
          decision: schemas.decisionWire(decision, true),
        };
      });
      return reply.code(201).send(result);
    },
  );
  app.post(
    "/api/v1/claims/:id/override",
    {
      preHandler: admin,
      schema: {
        ...secure,
        params: schemas.idParams,
        body: schemas.overrideSchema,
        summary:
          "Record a reasoned human decision; ACCEPT requires explicit amounts",
        tags: ["Claims"],
      },
    },
    async (req) =>
      db.transaction(async (tx) => {
        const [claim] = await tx
          .select()
          .from(s.claims)
          .where(eq(s.claims.id, req.params.id));
        if (!claim) throw httpError(404, "Claim not found");
        await lockPatient(tx, claim.patientId);
        const [current] = await tx
          .select()
          .from(s.claims)
          .where(eq(s.claims.id, claim.id))
          .for("update");
        const [a] = await tx
          .select()
          .from(s.claimAdjudications)
          .where(eq(s.claimAdjudications.claimId, claim.id))
          .orderBy(desc(s.claimAdjudications.seq))
          .limit(1);
        if (
          !a ||
          !["PEND", "DENY"].includes(a.outcome) ||
          ["paid", "closed"].includes(current!.status)
        )
          throw httpError(
            409,
            "Only a nonterminal PEND or DENY can be overridden",
          );
        const d = structuredClone(a.decision);
        const b = req.body;
        if (b.to_outcome === "ACCEPT") {
          if (
            !b.lines ||
            b.lines.length !== claim.context.lines.length ||
            new Set(b.lines.map((l) => l.line_no)).size !== b.lines.length
          )
            throw httpError(
              422,
              "Approval requires one explicit payment allocation per line",
            );
          d.lines = claim.context.lines.map((l, i) => {
            const allocation = b.lines!.find((v) => v.line_no === i + 1);
            if (!allocation) throw httpError(422, "Missing line allocation");
            const paid = Math.round(allocation.plan_pays * 100),
              member = Math.round(allocation.member_pays * 100);
            if (paid + member !== l.amount * l.units)
              throw httpError(
                422,
                "Plan and member allocation must equal the billed line amount",
              );
            return {
              lineNo: i + 1,
              outcome: "payable" as const,
              eligibleAmount: paid + member,
              deductibleApplied: 0,
              coinsuranceAmount: 0,
              planPays: paid,
              memberPays: member,
              deniedAmount: 0,
              allowedUnits: l.units,
              reasons: [],
              reviewPrompts: [],
            };
          });
          d.planPaysTotal = d.lines.reduce((sum, l) => sum + l.planPays, 0);
          d.memberPaysTotal = d.lines.reduce((sum, l) => sum + l.memberPays, 0);
          if (current!.status === "denied")
            await moveStatus(
              tx,
              claim.id,
              "denied",
              "appeal_pending",
              "MANUAL_OVERRIDE",
              now(),
            );
          const from: ClaimStatus =
            current!.status === "denied" ? "appeal_pending" : current!.status;
          await moveStatus(
            tx,
            claim.id,
            from,
            "paid",
            "MANUAL_OVERRIDE",
            now(),
          );
        } else {
          d.lines = claim.context.lines.map((source, i) => ({
            lineNo: i + 1,
            reasons: [],
            reviewPrompts: [],
            outcome: "denied",
            eligibleAmount: 0,
            planPays: 0,
            memberPays: 0,
            deductibleApplied: 0,
            coinsuranceAmount: 0,
            allowedUnits: 0,
            deniedAmount:
              claim.context.lines[i]!.amount * claim.context.lines[i]!.units,
            normalMemberPays: 0,
          }));
          d.planPaysTotal = 0;
          d.memberPaysTotal = 0;
          if (current!.status !== "denied")
            await moveStatus(
              tx,
              claim.id,
              current!.status,
              "denied",
              "MANUAL_OVERRIDE",
              now(),
            );
        }
        d.outcome = b.to_outcome;
        d.suggestedStatus = b.to_outcome === "ACCEPT" ? "paid" : "denied";
        d.primaryReasonCode = "MANUAL_OVERRIDE";
        d.errors = [
          {
            code: "MANUAL_OVERRIDE",
            message: "Adjudicator override; see audited reason",
          },
        ];
        d.reviewPrompts = [];
        d.accumulatorUpdates = {};
        if (claim.context.planIds.length > 1 && b.to_outcome === "ACCEPT") {
          if (
            !b.payers ||
            b.payers.length !== claim.context.planIds.length ||
            new Set(b.payers.map((p) => p.plan_id)).size !== b.payers.length ||
            b.payers.some((p) => !claim.context.planIds.includes(p.plan_id))
          )
            throw httpError(
              422,
              "COB approval requires a payment allocation for every covered plan",
            );
          d.payers = b.payers.map((p) => {
            if (
              p.lines.length !== d.lines.length ||
              new Set(p.lines.map((l) => l.line_no)).size !== p.lines.length
            )
              throw httpError(
                422,
                "Each payer must allocate every line exactly once",
              );
            const lines = d.lines.map((l) => {
              const allocation = p.lines.find((v) => v.line_no === l.lineNo);
              if (!allocation)
                throw httpError(422, "Missing payer line allocation");
              const planPays = Math.round(allocation.plan_pays * 100);
              if (planPays > l.eligibleAmount)
                throw httpError(
                  422,
                  "Payer allocation exceeds eligible amount",
                );
              return {
                ...l,
                planPays,
                memberPays: l.eligibleAmount - planPays,
                normalMemberPays: 0,
              };
            });
            return {
              planId: p.plan_id,
              lines,
              planPaysTotal: lines.reduce((sum, l) => sum + l.planPays, 0),
            };
          });
          if (
            d.lines.some(
              (l, i) =>
                d.payers.reduce((sum, p) => sum + p.lines[i]!.planPays, 0) !==
                l.planPays,
            )
          )
            throw httpError(
              422,
              "Payer allocations must sum to the approved plan payment",
            );
        } else
          d.payers = claim.context.planIds.map((planId, i) => ({
            planId,
            lines: d.lines.map((l) => ({
              ...l,
              planPays: i === 0 ? l.planPays : 0,
              memberPays: i === 0 ? l.memberPays : l.eligibleAmount,
            })),
            planPaysTotal: i === 0 ? d.planPaysTotal : 0,
          }));
        d.trace.push({
          rule: "MANUAL_OVERRIDE",
          stage: 4,
          fired: true,
          outcome: b.to_outcome,
          inputs: { userId: req.actor!.userId },
          durationMs: 0,
        });
        const rows = await tx
          .select()
          .from(s.insurancePlans)
          .where(inArray(s.insurancePlans.planId, claim.context.planIds));
        await saveDecision(tx, claim.id, d, claim.patientId, rows);
        await tx.insert(s.overrides).values({
          claimId: claim.id,
          userId: req.actor!.userId!,
          fromOutcome: a.outcome,
          toOutcome: b.to_outcome,
          reason: b.reason,
        });
        await audit(tx, req.actor!, "update", `claim:${claim.id}`, b.reason);
        return {
          id: claim.id,
          status: d.suggestedStatus,
          decision: schemas.decisionWire(d, true),
        };
      }),
  );
}
