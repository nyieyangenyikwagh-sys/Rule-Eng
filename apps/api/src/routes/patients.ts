import { eq, desc, ilike, or, inArray } from "drizzle-orm";
import { z } from "zod";
import type { EligibilitySnapshot } from "@alberta-rules/core";
import { httpError } from "../services/security.js";
import { audit, lockPatient } from "../services/adjudication.js";
import * as s from "../db/schema.js";
import * as schemas from "../schemas.js";
import type { RoutesContext } from "./context.js";
export function registerPatientsRoutes(context: RoutesContext) {
  const { app, db, now, any, write, admin, secure } = context;
  app.get(
    "/api/v1/patients",
    {
      preHandler: any,
      schema: {
        ...secure,
        querystring: z.strictObject({
          q: z.string().max(100).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        summary: "List patients and coverage summaries",
        tags: ["Patients"],
      },
    },
    async (req) =>
      db.transaction(async (tx) => {
        const query = req.query.q?.trim();
        const rows = await tx
          .select()
          .from(s.patients)
          .where(
            query
              ? or(
                  ilike(s.patients.firstName, `%${query}%`),
                  ilike(s.patients.lastName, `%${query}%`),
                  ilike(s.patients.email, `%${query}%`),
                )
              : undefined,
          )
          .orderBy(desc(s.patients.id))
          .limit(req.query.limit)
          .offset(req.query.offset);
        const ids = rows.map((row) => row.id);
        const coverage = ids.length
          ? await tx
              .select({
                id: s.patientInsurances.id,
                patientId: s.patientInsurances.patientId,
                planId: s.patientInsurances.planId,
                memberId: s.patientInsurances.memberId,
                priority: s.patientInsurances.priority,
                effectiveDate: s.patientInsurances.effectiveDate,
                terminationDate: s.patientInsurances.terminationDate,
                lastVerifiedAt: s.patientInsurances.lastVerifiedAt,
                eligibilitySourceReference:
                  s.patientInsurances.eligibilitySourceReference,
                payerId: s.insurancePlans.payerId,
                planName: s.insurancePlans.name,
              })
              .from(s.patientInsurances)
              .innerJoin(
                s.insurancePlans,
                eq(s.insurancePlans.id, s.patientInsurances.planId),
              )
              .where(inArray(s.patientInsurances.patientId, ids))
          : [];
        await audit(tx, req.actor!, "read", "patient:list");
        return rows.map((patient) =>
          schemas.snake({
            ...patient,
            insurance: coverage.filter((item) => item.patientId === patient.id),
          }),
        );
      }),
  );
  app.post(
    "/api/v1/patients",
    {
      preHandler: write,
      schema: {
        ...secure,
        body: schemas.patientSchema,
        summary: "Create a patient and coverage record",
        tags: ["Patients"],
      },
    },
    async (req, reply) => {
      if (req.body.dob > now().toISOString().slice(0, 10))
        throw httpError(422, "Date of birth must not be in the future");
      const result = await db.transaction(async (tx) => {
        const b = req.body;
        const [p] = await tx
          .insert(s.patients)
          .values({
            firstName: b.first_name,
            lastName: b.last_name,
            dob: b.dob,
            gender: b.gender,
            province: b.province,
            email: b.email,
            phone: b.phone,
          })
          .returning();
        const rows = [];
        for (const ins of Array.isArray(b.insurance)
          ? b.insurance
          : [b.insurance]) {
          const [plan] = await tx
            .select()
            .from(s.insurancePlans)
            .where(eq(s.insurancePlans.payerId, ins.payer_id));
          if (!plan) throw httpError(404, "Unknown payer");
          const [row] = await tx
            .insert(s.patientInsurances)
            .values({
              patientId: p!.id,
              planId: plan.id,
              memberId: ins.member_id,
              healthCardNumber: ins.health_card_number,
              groupNumber: ins.group_number,
              effectiveDate: ins.effective_date,
              terminationDate: ins.termination_date,
              priority: ins.priority,
              relationship: ins.relationship,
              subscriberBirthday: ins.subscriber_birthday,
            })
            .returning();
          rows.push(row);
        }
        await audit(tx, req.actor!, "create", `patient:${p!.id}`);
        return schemas.snake({ ...p, insurance: rows });
      });
      return reply.code(201).send(result);
    },
  );
  app.get(
    "/api/v1/patients/:id",
    {
      preHandler: any,
      schema: {
        ...secure,
        params: schemas.idParams,
        summary: "Read a patient and coverage",
        tags: ["Patients"],
      },
    },
    async (req) =>
      db.transaction(async (tx) => {
        const [p] = await tx
          .select()
          .from(s.patients)
          .where(eq(s.patients.id, req.params.id));
        if (!p) throw httpError(404, "Patient not found");
        const insurance = await tx
          .select()
          .from(s.patientInsurances)
          .where(eq(s.patientInsurances.patientId, p.id));
        await audit(tx, req.actor!, "read", `patient:${p.id}`);
        return schemas.snake({ ...p, insurance });
      }),
  );
  app.post(
    "/api/v1/insurance/verify",
    {
      preHandler: write,
      schema: {
        ...secure,
        body: schemas.verifySchema,
        summary: "Record an eligibility response received from a payer",
        tags: ["Insurance"],
      },
    },
    async (req) => {
      const body = req.body;
      return db.transaction(async (tx) => {
        const [insurance] = await tx
          .select()
          .from(s.patientInsurances)
          .where(eq(s.patientInsurances.id, body.patient_insurance_id))
          .for("update");
        if (!insurance) throw httpError(404, "Insurance not found");
        const snapshot: EligibilitySnapshot = {
          eligible: body.eligible,
          reasonCode: body.reason_code,
          deductible: body.deductible,
          copay: body.copay,
          coinsurance: body.coinsurance,
          priorAuthRequired: body.prior_auth_required,
        };
        const verifiedAt = now().toISOString();
        await tx
          .update(s.patientInsurances)
          .set({
            lastEligibility: snapshot,
            lastVerifiedAt: verifiedAt,
            eligibilitySourceReference: body.source_reference,
          })
          .where(eq(s.patientInsurances.id, insurance.id));
        await audit(
          tx,
          req.actor!,
          "update",
          `patient:${insurance.patientId}`,
          `Eligibility source ${body.source_reference}`,
        );
        return {
          ...schemas.snake(snapshot),
          patient_insurance_id: insurance.id,
          source_reference: body.source_reference,
          verified_at: verifiedAt,
        };
      });
    },
  );
  app.patch(
    "/api/v1/insurance/:id",
    {
      preHandler: admin,
      schema: {
        ...secure,
        params: schemas.idParams,
        body: schemas.coverageUpdateSchema,
        summary: "Change coverage dates and flag affected claims",
        tags: ["Insurance"],
      },
    },
    async (req) =>
      db.transaction(async (tx) => {
        const [original] = await tx
          .select()
          .from(s.patientInsurances)
          .where(eq(s.patientInsurances.id, req.params.id));
        if (!original) throw httpError(404, "Insurance not found");
        await lockPatient(tx, original.patientId);
        const b = req.body;
        const [updated] = await tx
          .update(s.patientInsurances)
          .set({
            effectiveDate: b.effective_date,
            terminationDate: b.termination_date,
            eligibilityNoticeDate: b.eligibility_notice_date,
            memberId: b.member_id ?? original.memberId,
            lastVerifiedAt: null,
            lastEligibility: null,
            eligibilitySourceReference: null,
          })
          .where(eq(s.patientInsurances.id, req.params.id))
          .returning();
        const claims = await tx
          .select()
          .from(s.claims)
          .where(eq(s.claims.patientId, original.patientId));
        const flags = [];
        for (const c of claims) {
          const [plan] = await tx
            .select()
            .from(s.insurancePlans)
            .where(eq(s.insurancePlans.id, original.planId));
          if (!c.context.planIds.includes(plan!.planId)) continue;
          const newlyCovered = c.context.lines.some((l) => {
            const date = l.serviceDate ?? c.serviceDate;
            return (
              date >= b.effective_date &&
              (!b.termination_date || date <= b.termination_date) &&
              (date < original.effectiveDate ||
                !!(original.terminationDate && date > original.terminationDate))
            );
          });
          const removed = c.context.lines.some((l) => {
            const date = l.serviceDate ?? c.serviceDate;
            return (
              date >= original.effectiveDate &&
              (!original.terminationDate || date <= original.terminationDate) &&
              (date < b.effective_date ||
                !!(b.termination_date && date > b.termination_date))
            );
          });
          const flag =
            removed && c.status === "paid"
              ? "RECOVERY_REVIEW"
              : newlyCovered || removed
                ? "REPROCESS_CANDIDATE"
                : null;
          if (flag) {
            await tx.insert(s.claimFlags).values({ claimId: c.id, flag });
            flags.push({ claim_id: c.id, flag });
          }
        }
        await audit(
          tx,
          req.actor!,
          "update",
          `patient:${original.patientId}`,
          b.reason,
        );
        return { insurance: schemas.snake(updated), flags };
      }),
  );
}
