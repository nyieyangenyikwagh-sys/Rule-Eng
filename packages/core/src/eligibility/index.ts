import type { CoverageRecord, EligibilitySnapshot } from "../types.js";
import type { PlanDefinition } from "../plans/schema.js";
export class GuardError extends Error {
  statusCode = 422;
  constructor(
    public code: string,
    message: string,
    public payerReason?: string | null,
  ) {
    super(message);
  }
}
export function assertEligible(
  ins: CoverageRecord | null,
  now: Date,
): EligibilitySnapshot {
  if (!ins?.lastVerifiedAt || !ins.lastEligibility)
    throw new GuardError("G001", "No verified coverage for this patient/plan");
  const verified = Date.parse(ins.lastVerifiedAt);
  if (
    !Number.isFinite(verified) ||
    verified < now.getTime() - 24 * 3600000 ||
    verified > now.getTime()
  )
    throw new GuardError("G002", "Coverage verification is stale — re-verify");
  if (!ins.lastEligibility.eligible)
    throw new GuardError(
      "G003",
      "Patient is not eligible — claim blocked",
      ins.lastEligibility.reasonCode,
    );
  return structuredClone(ins.lastEligibility);
}
export function mockPayer(
  memberId: string,
  plan: PlanDefinition,
): EligibilitySnapshot {
  const codes: Record<string, string> = {
    TERM: "COVERAGE_TERMINATED",
    OON: "OUT_OF_NETWORK",
    PEND: "COVERAGE_PENDING",
    INACT: "INACTIVE_PLAN",
  };
  const prefix = Object.keys(codes).find((p) => memberId.startsWith(p));
  return {
    eligible: !prefix,
    reasonCode: prefix ? codes[prefix]! : null,
    copay: plan.copay,
    deductible: plan.deductible
      ? {
          individual: plan.deductible.individual / 100,
          family: plan.deductible.family / 100,
          met: 120,
        }
      : undefined,
    coinsurance: plan.coinsurance,
    priorAuthRequired: [...plan.priorAuth],
  };
}
