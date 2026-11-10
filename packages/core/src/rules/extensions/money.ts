import type { Accumulator } from "../../types.js";
import type { PlanDefinition } from "../../plans/schema.js";

/** BigInt intermediate makes half-up cent rounding exact for basis-point rates. */
export function roundCoinsurance(cents: number, rate: number): number {
  return Number(
    (BigInt(cents) * BigInt(Math.round(rate * 10000)) + 5000n) / 10000n,
  );
}
export function costShare(
  eligible: number,
  plan: PlanDefinition,
  acc: Accumulator,
) {
  const remaining =
    !plan.deductible || acc.familyDeductibleMet >= plan.deductible.family
      ? 0
      : Math.max(0, plan.deductible.individual - acc.individualDeductibleMet);
  const deductibleApplied = Math.min(eligible, remaining);
  const coinsuranceAmount = roundCoinsurance(
    eligible - deductibleApplied,
    plan.coinsurance,
  );
  const memberPays = Math.min(
    deductibleApplied + coinsuranceAmount,
    plan.outOfPocketMax === null
      ? eligible
      : Math.max(0, plan.outOfPocketMax - acc.oopMet),
  );
  return {
    deductibleApplied,
    coinsuranceAmount,
    memberPays,
    planPays: eligible - memberPays,
  };
}
