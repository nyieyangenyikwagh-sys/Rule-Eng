import { readFileSync } from "node:fs";
import {
  planDefinitionSchema,
  type ClaimContext,
  type CoverageRecord,
  type EvaluationInput,
  type PlanDefinition,
  type PriorLine,
} from "../src/index.js";
export const plans = [
  "ahcip",
  "greenshield",
  "auto-section-b",
  "auto-care-first",
].map((n) =>
  planDefinitionSchema.parse(
    JSON.parse(readFileSync(`examples/plans/${n}.json`, "utf8")),
  ),
);
export const publicPlan = plans[0]!,
  privatePlan = plans[1]!,
  sectionB = plans[2]!,
  careFirst = plans[3]!;
export const now = new Date("2026-10-13T18:00:00Z");
export function makeClaim(overrides: Partial<ClaimContext> = {}): ClaimContext {
  return {
    province: "AB",
    providerBillingNumber: "123456",
    serviceDate: "2026-10-01",
    healthCardNumber: "123456789",
    patientProvince: "AB",
    patientId: "12",
    planIds: ["AHCIP"],
    receivedDate: "2026-10-13",
    today: "2026-10-13",
    lines: [
      { serviceCode: "03.03A", diagnosisCode: "J06.9", units: 1, amount: 8500 },
    ],
    ...overrides,
  };
}
export function coverage(
  planId = "AHCIP",
  overrides: Partial<CoverageRecord> = {},
): CoverageRecord {
  return {
    planId,
    effectiveDate: "2020-01-01",
    terminationDate: null,
    lastVerifiedAt: now.toISOString(),
    lastEligibility: { eligible: true, reasonCode: null },
    relationship: "self",
    ...overrides,
  };
}
export function input(
  plan: PlanDefinition = publicPlan,
  ctx: Partial<ClaimContext> = {},
  extra: Partial<EvaluationInput> = {},
): EvaluationInput {
  return {
    claim: makeClaim({
      planIds: [plan.planId],
      ...(plan.layer === "public"
        ? {}
        : {
            lines: [
              {
                serviceCode: "PHYSIO-INIT",
                diagnosisCode: "M54.5",
                units: 1,
                amount: 60000,
              },
            ],
          }),
      ...ctx,
    }),
    plans: [plan],
    coverage: [coverage(plan.planId)],
    history: [],
    ...extra,
  };
}
export function prior(overrides: Partial<PriorLine> = {}): PriorLine {
  return {
    claimId: "99",
    patientId: "12",
    planId: "GREENSHIELD",
    planVersion: 1,
    providerBillingNumber: "654321",
    serviceCode: "PHYSIO-FU",
    serviceDate: "2026-09-01",
    units: 1,
    allowedUnits: 1,
    amount: 10000,
    planPays: 8000,
    status: "submitted",
    ...overrides,
  };
}
export const noLimits = (p: PlanDefinition = privatePlan): PlanDefinition => ({
  ...p,
  frequency: [],
  benefitMaximums: [],
  medicalNecessity: [],
});
