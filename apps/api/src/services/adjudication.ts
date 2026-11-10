import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  assertEligible,
  edmontonDate,
  evaluateClaim,
  getEngine,
  GreenShieldEngine,
  transition,
  type ClaimContext,
  type CoverageRecord,
  type Decision,
  type PriorLine,
  type ClaimStatus,
} from "@alberta-rules/core";
import type { QueryDatabase, Transaction } from "../db/client.js";
import * as s from "../db/schema.js";
import {
  accumulatorFromWire,
  contextFromWire,
  decisionWire,
  historyFromWire,
  type EvaluateBody,
} from "../schemas.js";
import { httpError } from "./security.js";
export interface Actor {
  userId?: number;
  apiKeyId?: number;
  role?: "admin" | "biller" | "analyst";
  scopes?: string[];
  ip: string;
}
export async function audit(
  db: QueryDatabase,
  actor: Actor,
  action: string,
  resource: string,
  reason?: string,
) {
  await db.insert(s.auditLogs).values({
    userId: actor.userId,
    apiKeyId: actor.apiKeyId,
    action,
    resource,
    reason,
    ipAddress: actor.ip,
  });
}
export async function patientHistory(
  db: QueryDatabase,
  patientId: number,
  excludeId?: number,
): Promise<PriorLine[]> {
  const records = await db
    .select()
    .from(s.claims)
    .where(
      excludeId
        ? and(eq(s.claims.patientId, patientId), ne(s.claims.id, excludeId))
        : eq(s.claims.patientId, patientId),
    )
    .orderBy(asc(s.claims.serviceDate), asc(s.claims.id));
  if (!records.length) return [];
  const adjudications = await db
    .select()
    .from(s.claimAdjudications)
    .where(
      inArray(
        s.claimAdjudications.claimId,
        records.map((c) => c.id),
      ),
    )
    .orderBy(desc(s.claimAdjudications.seq));
  return records.flatMap((c) => {
    const latest = adjudications.find((a) => a.claimId === c.id);
    if (!latest) return [];
    const ctx = c.context;
    const payers = latest.decision.payers.length
      ? latest.decision.payers
      : ctx.planIds.map((planId) => ({
          planId,
          lines: latest.decision.lines,
          planPaysTotal: 0,
        }));
    return payers.flatMap((p) =>
      ctx.lines.map((l, i) => {
        const r = p.lines[i];
        const version = latest.decision.planVersionsUsed.find(
          (v) => v.planId === p.planId,
        );
        return {
          claimId: String(c.id),
          patientId: String(patientId),
          planId: p.planId,
          planVersion: r?.planVersion ?? version?.version,
          providerBillingNumber: c.providerBillingNumber,
          serviceCode: l.serviceCode,
          serviceDate: l.serviceDate ?? c.serviceDate,
          units: l.units,
          allowedUnits:
            !r || r.outcome === "denied" || r.outcome === "pended"
              ? 0
              : r.allowedUnits,
          amount: l.amount,
          planPays: r?.planPays ?? 0,
          status:
            c.status === "paid" || c.status === "closed"
              ? c.status
              : latest.decision.suggestedStatus,
          dateOfLoss: c.dateOfLoss ?? undefined,
          deductibleApplied: r?.deductibleApplied ?? 0,
          memberPays: r?.normalMemberPays ?? r?.memberPays ?? 0,
        };
      }),
    );
  });
}
export async function evaluateRequest(
  db: QueryDatabase,
  body: EvaluateBody,
  now: Date,
  guard: boolean,
  excludeId?: number,
) {
  getEngine(body.province);
  const [patient] = await db
    .select()
    .from(s.patients)
    .where(eq(s.patients.id, body.patient_id));
  if (!patient) throw httpError(404, "Patient not found");
  const planIds = body.plan_ids ?? [body.plan_id];
  const planRows = await db
    .select()
    .from(s.insurancePlans)
    .where(inArray(s.insurancePlans.id, planIds));
  if (planRows.length !== planIds.length)
    throw httpError(404, "Plan not found");
  const insurance = await db
    .select()
    .from(s.patientInsurances)
    .where(
      and(
        eq(s.patientInsurances.patientId, body.patient_id),
        inArray(s.patientInsurances.planId, planIds),
      ),
    );
  const coverage: CoverageRecord[] = insurance.map((ins) => ({
    ...ins,
    planId: planRows.find((p) => p.id === ins.planId)!.planId,
    relationship: ins.relationship ?? undefined,
    subscriberBirthday: ins.subscriberBirthday ?? undefined,
    eligibilityNoticeDate: ins.eligibilityNoticeDate ?? undefined,
  }));
  if (guard)
    for (const plan of planRows)
      assertEligible(
        coverage.find((c) => c.planId === plan.planId) ?? null,
        now,
      );
  else if (coverage.length !== planIds.length)
    throw httpError(404, "Plan is not linked to patient");
  const plans = (
    await db
      .select()
      .from(s.planVersions)
      .where(inArray(s.planVersions.planId, planIds))
  ).map((p) => p.definition);
  const ctx = contextFromWire(
    body,
    patient.province,
    insurance.find(
      (i) => planRows.find((p) => p.id === i.planId)?.layer === "public",
    )?.healthCardNumber ??
      insurance[0]?.healthCardNumber ??
      null,
    planIds.map((id) => planRows.find((p) => p.id === id)!.planId),
    edmontonDate(now),
  );
  if (
    ctx.receivedDate > ctx.today ||
    ctx.serviceDate > ctx.today ||
    ctx.serviceDate > ctx.receivedDate ||
    ctx.lines.some(
      (l) =>
        (l.serviceDate ?? ctx.serviceDate) > ctx.today ||
        (l.serviceDate ?? ctx.serviceDate) > ctx.receivedDate,
    )
  )
    throw httpError(
      422,
      "Service and received dates must not be future dates; service must precede receipt",
    );
  if (body.history?.lines.some((h) => h.patient_id !== body.patient_id))
    throw httpError(422, "History must belong to this patient");
  const history = body.history
    ? body.history.lines.map(historyFromWire)
    : await patientHistory(db, body.patient_id, excludeId);
  const accumulators = Object.fromEntries(
    Object.entries({
      ...body.history?.accumulators,
      ...body.prior_accumulators,
    }).map(([k, v]) => [k, accumulatorFromWire(v)]),
  );
  const decision = evaluateClaim({
    claim: ctx,
    coverage,
    plans,
    history,
    accumulators,
  });
  return { decision, ctx, plans, planRows };
}
export async function lockPatient(tx: Transaction, patientId: number) {
  // A patient-row lock also serializes the first claim, before an accumulator row exists.
  await tx
    .select({ id: s.patients.id })
    .from(s.patients)
    .where(eq(s.patients.id, patientId))
    .for("update");
  await tx
    .select()
    .from(s.accumulators)
    .where(eq(s.accumulators.patientId, patientId))
    .for("update");
}
export async function moveStatus(
  db: QueryDatabase,
  claimId: number,
  from: ClaimStatus,
  to: ClaimStatus,
  reason: string | null,
  now: Date,
) {
  const entry = transition(from, to, reason, now.toISOString());
  await db.insert(s.claimStatusHistory).values({ claimId, ...entry });
  await db
    .update(s.claims)
    .set({
      status: to,
      ...(to === "denied" || to === "rejected"
        ? { denialReasonCode: reason }
        : {}),
    })
    .where(eq(s.claims.id, claimId));
}
export async function saveDecision(
  tx: Transaction,
  claimId: number,
  decision: Decision,
  patientId: number,
  planRows: { id: number; planId: string }[],
) {
  const [previous] = await tx
    .select()
    .from(s.claimAdjudications)
    .where(eq(s.claimAdjudications.claimId, claimId))
    .orderBy(desc(s.claimAdjudications.seq))
    .limit(1);
  const [adjudication] = await tx
    .insert(s.claimAdjudications)
    .values({
      claimId,
      seq: (previous?.seq ?? 0) + 1,
      supersedesId: previous?.id,
      outcome: decision.outcome,
      decision,
      inputSnapshot: {
        claim: (
          await tx.select().from(s.claims).where(eq(s.claims.id, claimId))
        )[0]!.context,
        plans: (
          await tx
            .select()
            .from(s.planVersions)
            .where(
              inArray(
                s.planVersions.planId,
                planRows.map((p) => p.id),
              ),
            )
        ).map((p) => p.definition),
        coverage: decision.coverageSnapshot,
        history: await patientHistory(tx, patientId, claimId),
      },
      trace: decision.trace,
      engineVersion: decision.engineVersion,
    })
    .returning();
  if (decision.lines.length)
    await tx.insert(s.claimLineResults).values(
      decision.lines.map((l) => ({
        adjudicationId: adjudication!.id,
        lineNo: l.lineNo,
        outcome: l.outcome,
        eligibleAmount: l.eligibleAmount,
        planPays: l.planPays,
        memberPays: l.memberPays,
        deductibleApplied: l.deductibleApplied,
        coinsuranceAmount: l.coinsuranceAmount,
        reasons: l.reasons,
        result: l,
      })),
    );
  // Pended decisions are provisional and do not consume durable benefits.
  if (decision.outcome !== "PEND" && decision.outcome !== "REJECT")
    for (const [periodKey, a] of Object.entries(decision.accumulatorUpdates)) {
      const plan = planRows.find((p) => periodKey.startsWith(`${p.planId}:`));
      if (!plan) continue;
      await tx
        .insert(s.accumulators)
        .values({ patientId, planId: plan.id, periodKey, ...a })
        .onConflictDoUpdate({
          target: [
            s.accumulators.patientId,
            s.accumulators.planId,
            s.accumulators.periodKey,
          ],
          set: { ...a, version: sql`${s.accumulators.version}+1` },
        });
    }
  for (const f of decision.flags)
    await tx
      .insert(s.claimFlags)
      .values({ claimId: Number(f.claimId), flag: f.flag });
  return adjudication!;
}
export async function createClaim(
  tx: Transaction,
  body: EvaluateBody,
  now: Date,
  actor: Actor,
) {
  await lockPatient(tx, body.patient_id);
  if (body.history || body.prior_accumulators)
    throw httpError(
      422,
      "Caller-supplied history is supported only for dry-run evaluation",
    );
  const { decision, ctx, plans, planRows } = await evaluateRequest(
    tx,
    body,
    now,
    true,
  );
  await audit(tx, actor, "read", `patient:${body.patient_id}`);
  const engine =
    plans[0]?.layer === "private"
      ? new GreenShieldEngine()
      : getEngine(ctx.province);
  const [claim] = await tx
    .insert(s.claims)
    .values({
      patientId: body.patient_id,
      planId: body.plan_id,
      province: ctx.province,
      providerBillingNumber: ctx.providerBillingNumber,
      serviceDate: ctx.serviceDate,
      receivedDate: ctx.receivedDate,
      dateOfLoss: ctx.dateOfLoss,
      billedAmount: decision.billedAmount,
      coverageSnapshot: decision.coverageSnapshot,
      status: "draft",
      context: ctx,
      submission:
        decision.outcome === "REJECT" ? null : engine.formatSubmission(ctx),
    })
    .returning();
  await tx.insert(s.claimLines).values(
    ctx.lines.map((l, i) => ({
      claimId: claim!.id,
      lineNo: i + 1,
      serviceCode: l.serviceCode,
      diagnosisCode: l.diagnosisCode,
      units: l.units,
      amount: l.amount,
      serviceDate: l.serviceDate ?? ctx.serviceDate,
      priorAuthNumber: l.priorAuthNumber,
    })),
  );
  await moveStatus(tx, claim!.id, "draft", "submitted", null, now);
  if (decision.suggestedStatus !== "submitted")
    await moveStatus(
      tx,
      claim!.id,
      "submitted",
      decision.suggestedStatus,
      decision.primaryReasonCode,
      now,
    );
  await saveDecision(tx, claim!.id, decision, body.patient_id, planRows);
  await audit(tx, actor, "create", `claim:${claim!.id}`);
  if (decision.outcome === "REJECT")
    return {
      status: 422,
      body: {
        message: "Claim rejected by rule engine",
        errors: decision.errors,
        claim_id: claim!.id,
      },
    };
  return {
    status: 201,
    body: {
      id: claim!.id,
      status: decision.suggestedStatus,
      province: ctx.province,
      billed_amount: decision.billedAmount / 100,
      denial_reason_code: decision.primaryReasonCode,
      lines: decisionWire(decision).lines,
      decision: decisionWire(decision),
    },
  };
}
export function wireFromContext(
  c: ClaimContext,
  patientId: number,
  planId: number,
  planIds: number[],
): EvaluateBody {
  return {
    patient_id: patientId,
    plan_id: planId,
    plan_ids: planIds,
    province: c.province,
    provider_billing_number: c.providerBillingNumber,
    service_date: c.serviceDate,
    received_date: c.receivedDate,
    date_of_loss: c.dateOfLoss,
    injury_classification: c.injuryClassification ?? "unknown",
    lines: c.lines.map((l) => ({
      service_code: l.serviceCode,
      diagnosis_code: l.diagnosisCode,
      units: l.units,
      amount: l.amount / 100,
      service_date: l.serviceDate,
      prior_auth_number: l.priorAuthNumber,
      prior_auth_status: l.priorAuthStatus,
      program_of_care: l.programOfCare,
    })),
  };
}
