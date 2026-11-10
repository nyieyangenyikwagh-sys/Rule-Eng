import { z } from "zod";
import {
  isoDateSchema,
  planDefinitionSchema,
  type Decision,
  type ClaimContext,
  type PriorLine,
  type Accumulator,
} from "@alberta-rules/core";
export const idSchema = z.number().int().positive();
export const idParams = z.strictObject({
  id: z.coerce.number().int().positive(),
});
export const dollars = z
  .number()
  .nonnegative()
  .max(10_000_000)
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-7,
    "Money must have at most two decimal places",
  );
const code = z.string().min(1).max(12);
export const lineSchema = z.strictObject({
  service_code: code,
  diagnosis_code: z.string().min(1).max(10),
  units: z.number().int().min(1).max(999).default(1),
  amount: dollars,
  service_date: isoDateSchema.optional(),
  prior_auth_number: z.string().min(1).max(100).optional(),
  prior_auth_status: z.enum(["requested", "approved", "denied"]).optional(),
  program_of_care: z.string().max(100).optional(),
});
export const statusSchema = z.enum([
  "draft",
  "submitted",
  "paid",
  "denied",
  "rejected",
  "pended",
  "appeal_pending",
  "closed",
]);
export const accumulatorWire = z.strictObject({
  individual_deductible_met: dollars.default(0),
  family_deductible_met: dollars.default(0),
  oop_met: dollars.default(0),
  benefit_used: z.record(z.string(), dollars).default({}),
});
export const priorLineWire = z.strictObject({
  claim_id: z.string().optional(),
  patient_id: idSchema,
  plan_id: z.string().min(1),
  plan_version: idSchema.optional(),
  provider_billing_number: z.string().max(32),
  service_code: code,
  service_date: isoDateSchema,
  units: z.number().int().positive(),
  allowed_units: z.number().int().nonnegative(),
  amount: dollars,
  plan_pays: dollars,
  status: statusSchema,
  date_of_loss: isoDateSchema.optional(),
  deductible_applied: dollars.optional(),
  member_pays: dollars.optional(),
});
export const evaluateSchema = z
  .strictObject({
    patient_id: idSchema,
    plan_id: idSchema,
    plan_ids: z.array(idSchema).min(1).max(5).optional(),
    province: z.string().min(2).max(8),
    provider_billing_number: z.string().max(32),
    service_date: isoDateSchema,
    received_date: isoDateSchema.optional(),
    date_of_loss: isoDateSchema.nullable().optional(),
    injury_classification: z
      .enum(["minor", "non_minor", "unknown"])
      .default("unknown"),
    lines: z.array(lineSchema).min(1).max(50),
    history: z
      .strictObject({
        lines: z.array(priorLineWire).max(10000),
        accumulators: z.record(z.string(), accumulatorWire).default({}),
      })
      .nullable()
      .optional(),
    prior_accumulators: z
      .record(z.string(), accumulatorWire)
      .nullable()
      .optional(),
  })
  .refine(
    (v) =>
      !v.plan_ids ||
      (new Set(v.plan_ids).size === v.plan_ids.length &&
        v.plan_ids.includes(v.plan_id)),
    "plan_ids must be unique and include plan_id",
  );
export type EvaluateBody = z.infer<typeof evaluateSchema>;
export const insuranceSchema = z
  .strictObject({
    payer_id: z.string().min(1),
    member_id: z.string().min(1).max(100),
    health_card_number: z.string().max(32).nullable().optional(),
    group_number: z.string().max(100).optional(),
    effective_date: isoDateSchema,
    termination_date: isoDateSchema.nullable().default(null),
    priority: z.enum(["primary", "secondary"]).default("primary"),
    relationship: z.enum(["self", "spouse", "child"]).optional(),
    subscriber_birthday: isoDateSchema.optional(),
  })
  .refine(
    (v) => !v.termination_date || v.termination_date >= v.effective_date,
    "Termination precedes coverage",
  );
export const patientSchema = z.strictObject({
  first_name: z.string().min(2).max(100),
  last_name: z.string().min(2).max(100),
  dob: isoDateSchema,
  gender: z.enum(["female", "male", "other", "unknown"]),
  province: z.string().length(2).default("AB"),
  email: z.email().optional(),
  phone: z.string().max(32).optional(),
  insurance: z.union([insuranceSchema, z.array(insuranceSchema).min(1).max(5)]),
});
export const planWireSchema = planDefinitionSchema;
export const registerSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(12).max(128),
  role: z.enum(["admin", "biller", "analyst"]).default("biller"),
});
export const loginSchema = z.strictObject({
  username: z.email(),
  password: z.string().min(1).max(128),
});
export const verifySchema = z
  .strictObject({
    patient_insurance_id: idSchema,
    source_reference: z.string().min(3).max(200),
    eligible: z.boolean(),
    reason_code: z.string().min(1).max(100).nullable().default(null),
    deductible: z
      .strictObject({
        individual: dollars,
        family: dollars,
        met: dollars,
      })
      .optional(),
    copay: z
      .strictObject({
        primary: dollars,
        specialist: dollars,
        er: dollars,
      })
      .optional(),
    coinsurance: z.number().min(0).max(1).optional(),
    prior_auth_required: z
      .array(z.string().min(1).max(100))
      .max(100)
      .optional(),
  })
  .refine((value) => value.eligible || value.reason_code, {
    message: "An ineligible response requires a reason code",
    path: ["reason_code"],
  });
export const coverageUpdateSchema = z
  .strictObject({
    effective_date: isoDateSchema,
    termination_date: isoDateSchema.nullable(),
    eligibility_notice_date: isoDateSchema.optional(),
    member_id: z.string().min(1).max(100).optional(),
    reason: z.string().min(10).max(1000),
  })
  .refine(
    (v) => !v.termination_date || v.termination_date >= v.effective_date,
    "Termination precedes coverage",
  );
export const reasonSchema = z.strictObject({
  reason: z.string().min(10).max(1000),
});
export const overrideSchema = z.strictObject({
  to_outcome: z.enum(["ACCEPT", "DENY"]),
  payers: z
    .array(
      z.strictObject({
        plan_id: z.string().min(1),
        lines: z
          .array(z.strictObject({ line_no: idSchema, plan_pays: dollars }))
          .min(1)
          .max(50),
      }),
    )
    .min(1)
    .max(5)
    .optional(),
  reason: z.string().min(10).max(1000),
  lines: z
    .array(
      z.strictObject({
        line_no: idSchema,
        plan_pays: dollars,
        member_pays: dollars,
      }),
    )
    .min(1)
    .max(50)
    .optional(),
});
export function snake(value: unknown): any {
  if (Array.isArray(value)) return value.map(snake);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()),
        snake(v),
      ]),
    );
  return value;
}
const amountOut = z.number().nonnegative();
const reasonOut = z.strictObject({ code: z.string(), message: z.string() });
const lineOut = z.strictObject({
  line_no: idSchema,
  outcome: z.enum(["payable", "partial", "denied", "pended"]),
  eligible_amount: amountOut,
  deductible_applied: amountOut,
  coinsurance_amount: amountOut,
  plan_pays: amountOut,
  member_pays: amountOut,
  denied_amount: amountOut,
  allowed_units: z.number().int().nonnegative(),
  reasons: z.array(reasonOut),
  review_prompts: z.array(z.string()),
  plan_version: idSchema.optional(),
  normal_member_pays: amountOut.optional(),
});
export const decisionResponseSchema = z.strictObject({
  outcome: z.enum(["ACCEPT", "PARTIAL", "PEND", "DENY", "REJECT"]),
  primary_reason_code: z.string().nullable(),
  errors: z.array(reasonOut),
  billed_amount: amountOut,
  plan_pays_total: amountOut,
  member_pays_total: amountOut,
  suggested_status: statusSchema,
  plan_versions_used: z.array(
    z.strictObject({ plan_id: z.string(), version: idSchema }),
  ),
  engine_version: z.string(),
  review_prompts: z.array(z.string()),
  lines: z.array(lineOut),
  payers: z.array(
    z.strictObject({
      plan_id: z.string(),
      plan_pays_total: amountOut,
      lines: z.array(lineOut),
    }),
  ),
  trace: z
    .array(
      z.strictObject({
        rule: z.string(),
        stage: z.number().int(),
        fired: z.boolean(),
        outcome: z.string(),
        inputs: z.record(z.string(), z.unknown()),
        duration_ms: z.number().nonnegative(),
        line_no: idSchema.optional(),
        plan_id: z.string().optional(),
      }),
    )
    .optional(),
});
export function decisionWire(d: Decision, trace = false) {
  const monetary = [
    "eligibleAmount",
    "deductibleApplied",
    "coinsuranceAmount",
    "planPays",
    "memberPays",
    "deniedAmount",
  ] as const;
  const line = (l: Decision["lines"][number]) =>
    snake({
      ...l,
      normalMemberPays:
        l.normalMemberPays === undefined ? undefined : l.normalMemberPays / 100,
      ...Object.fromEntries(monetary.map((k) => [k, l[k] / 100])),
    });
  return {
    ...snake({
      outcome: d.outcome,
      primaryReasonCode: d.primaryReasonCode,
      errors: d.errors,
      billedAmount: d.billedAmount / 100,
      planPaysTotal: d.planPaysTotal / 100,
      memberPaysTotal: d.memberPaysTotal / 100,
      suggestedStatus: d.suggestedStatus,
      planVersionsUsed: d.planVersionsUsed,
      engineVersion: d.engineVersion,
      reviewPrompts: d.reviewPrompts,
    }),
    lines: d.lines.map(line),
    payers: d.payers.map((p) => ({
      plan_id: p.planId,
      plan_pays_total: p.planPaysTotal / 100,
      lines: p.lines.map(line),
    })),
    ...(trace ? { trace: snake(d.trace) } : {}),
  };
}
export function contextFromWire(
  body: EvaluateBody,
  patientProvince: string,
  healthCardNumber: string | null,
  planIds: string[],
  today: string,
): ClaimContext {
  return {
    patientId: String(body.patient_id),
    planIds,
    province: body.province,
    providerBillingNumber: body.provider_billing_number,
    serviceDate: body.service_date,
    receivedDate: body.received_date ?? today,
    today,
    dateOfLoss: body.date_of_loss ?? undefined,
    injuryClassification: body.injury_classification,
    patientProvince,
    healthCardNumber,
    lines: body.lines.map((l) => ({
      serviceCode: l.service_code,
      diagnosisCode: l.diagnosis_code,
      units: l.units,
      amount: Math.round(l.amount * 100),
      serviceDate: l.service_date,
      priorAuthNumber: l.prior_auth_number,
      priorAuthStatus: l.prior_auth_status,
      programOfCare: l.program_of_care,
    })),
  };
}
export function accumulatorFromWire(
  a: z.infer<typeof accumulatorWire>,
): Accumulator {
  return {
    individualDeductibleMet: Math.round(a.individual_deductible_met * 100),
    familyDeductibleMet: Math.round(a.family_deductible_met * 100),
    oopMet: Math.round(a.oop_met * 100),
    benefitUsed: Object.fromEntries(
      Object.entries(a.benefit_used).map(([k, v]) => [k, Math.round(v * 100)]),
    ),
  };
}
export function historyFromWire(h: z.infer<typeof priorLineWire>): PriorLine {
  return {
    claimId: h.claim_id,
    patientId: String(h.patient_id),
    planId: h.plan_id,
    planVersion: h.plan_version,
    providerBillingNumber: h.provider_billing_number,
    serviceCode: h.service_code,
    serviceDate: h.service_date,
    units: h.units,
    allowedUnits: h.allowed_units,
    amount: Math.round(h.amount * 100),
    planPays: Math.round(h.plan_pays * 100),
    status: h.status,
    dateOfLoss: h.date_of_loss,
    deductibleApplied: Math.round((h.deductible_applied ?? 0) * 100),
    memberPays: Math.round((h.member_pays ?? 0) * 100),
  };
}
