import { z } from "zod";

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
export const centsSchema = z
  .number()
  .int()
  .nonnegative()
  .max(1_000_000_000_000);
const selector = {
  codes: z.array(z.string()).min(1).optional(),
  category: z.string().min(1).optional(),
};
const selected = (v: { codes?: string[]; category?: string }) =>
  !!(v.codes?.length || v.category);
export const periodSchema = z.enum([
  "calendar_year",
  "rolling_12m",
  "rolling_days",
  "per_accident",
]);
export const coverageRuleSchema = z
  .strictObject({
    ...selector,
    covered: z.boolean(),
    reason: z.string().optional(),
    allowedAmount: centsSchema.optional(),
  })
  .refine(selected, "A codes or category selector is required");
export const frequencyRuleSchema = z
  .strictObject({
    ...selector,
    maxUnits: z.number().int().nonnegative(),
    period: periodSchema,
    rollingDays: z.number().int().positive().optional(),
    minDaysBetween: z.number().int().positive().optional(),
  })
  .refine(selected, "A selector is required")
  .refine(
    (v) => v.period !== "rolling_days" || !!v.rollingDays,
    "rollingDays is required",
  );
export const necessityRuleSchema = z
  .strictObject({
    ...selector,
    mode: z.enum(["diagnosis_service_map", "protocol", "program_of_care"]),
    allowedDiagnoses: z.array(z.string()).optional(),
    hard: z.boolean().default(false),
    protocol: z.string().optional(),
    classifications: z.array(z.enum(["minor", "non_minor"])).optional(),
    maxUnits: z.number().int().positive().optional(),
    withinDays: z.number().int().positive().optional(),
    programs: z.array(z.string()).optional(),
    preApprovedIfClaimedWithinDays: z.number().int().nonnegative().optional(),
  })
  .refine(
    (v) =>
      v.mode !== "diagnosis_service_map" ||
      (!!v.allowedDiagnoses?.length && selected(v)),
    "Diagnosis map requires diagnoses and a selector",
  )
  .refine(
    (v) =>
      v.mode !== "program_of_care" ||
      v.preApprovedIfClaimedWithinDays !== undefined,
    "Pre-approval window is required",
  );
export const benefitMaximumSchema = z
  .strictObject({
    ...selector,
    amount: centsSchema,
    period: periodSchema,
    rollingDays: z.number().int().positive().optional(),
    incurredWithinDays: z.number().int().positive().optional(),
    incurredWithinMonths: z.number().int().positive().optional(),
  })
  .refine(selected, "A selector is required")
  .refine(
    (v) => v.period !== "rolling_days" || !!v.rollingDays,
    "rollingDays is required",
  );
export const planDefinitionSchema = z
  .strictObject({
    planId: z.string().min(1).max(64),
    version: z.number().int().positive(),
    payerId: z.string().min(1).max(64),
    layer: z.enum(["public", "private", "auto"]),
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullable(),
    codeSystem: z.enum(["SOMB", "PRIVATE_SCHEDULE", "AUTO_TREATMENT"]),
    benefitPeriod: z.enum(["calendar_year", "rolling_12m", "per_accident"]),
    filingLimitDays: z.number().int().nonnegative().optional(),
    deductible: z
      .strictObject({ individual: centsSchema, family: centsSchema })
      .nullable(),
    coinsurance: z.number().min(0).max(1).multipleOf(0.0001),
    outOfPocketMax: centsSchema.nullable(),
    copay: z
      .strictObject({
        primary: centsSchema,
        specialist: centsSchema,
        er: centsSchema,
      })
      .optional(),
    priorAuth: z.array(z.string()).default([]),
    coverage: z.array(coverageRuleSchema).default([]),
    frequency: z.array(frequencyRuleSchema).default([]),
    medicalNecessity: z.array(necessityRuleSchema).default([]),
    benefitMaximums: z.array(benefitMaximumSchema).default([]),
    cob: z
      .strictObject({
        role: z.enum(["primary_only", "standard", "secondary_only"]),
        order: z
          .array(z.enum(["public", "auto", "own", "birthday"]))
          .default(["public", "auto", "own", "birthday"]),
      })
      .optional(),
    accumulatorCarryover: z.boolean().default(false),
    retroFilingClock: z
      .enum(["service_date", "eligibility_notice_date"])
      .default("service_date"),
    tableSource: z
      .string()
      .default("Illustrative synthetic subset; not an authoritative fee guide"),
  })
  .refine(
    (p) => !p.effectiveTo || p.effectiveTo >= p.effectiveFrom,
    "Effective window is reversed",
  )
  .refine(
    (p) =>
      p.layer !== "public" ||
      (p.deductible === null &&
        p.coinsurance === 0 &&
        p.outOfPocketMax === null),
    "Public insured benefits must be first-dollar",
  );
export type PlanDefinition = z.infer<typeof planDefinitionSchema>;
export type Period = z.infer<typeof periodSchema>;
export type Selector = { codes?: string[]; category?: string };
export function versionFor(
  plans: PlanDefinition[],
  planId: string,
  date: string,
): PlanDefinition | null {
  const found = plans.filter(
    (p) =>
      p.planId === planId &&
      p.effectiveFrom <= date &&
      (!p.effectiveTo || p.effectiveTo >= date),
  );
  return found.length === 1 ? found[0]! : null;
}
