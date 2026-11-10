import type { ClaimContext, CoverageRecord } from "../../types.js";
import type { PlanDefinition } from "../../plans/schema.js";

/** A partial comparison is deliberate: unresolved ties require a human. */
export function cobOrder(
  claim: ClaimContext,
  plans: PlanDefinition[],
  coverage: CoverageRecord[],
): string[] | null {
  if (claim.planIds.length < 2) return [...claim.planIds];
  const plan = (id: string) => plans.find((p) => p.planId === id);
  const member = (id: string) => coverage.find((c) => c.planId === id);
  const order = plan(claim.planIds[0]!)?.cob?.order ?? [
    "public",
    "auto",
    "own",
    "birthday",
  ];
  const compare = (a: string, b: string): number => {
    const ap = plan(a),
      bp = plan(b),
      ac = member(a),
      bc = member(b);
    if (!ap || !bp || !ac || !bc) return 0;
    if (ap.cob?.role === "secondary_only" && bp.cob?.role !== "secondary_only")
      return 1;
    if (bp.cob?.role === "secondary_only" && ap.cob?.role !== "secondary_only")
      return -1;
    for (const rule of order) {
      if (
        rule === "public" &&
        ap.layer !== bp.layer &&
        (ap.layer === "public" || bp.layer === "public")
      )
        return ap.layer === "public" ? -1 : 1;
      if (
        rule === "auto" &&
        claim.dateOfLoss &&
        ap.layer !== bp.layer &&
        (ap.layer === "auto" || bp.layer === "auto")
      )
        return ap.layer === "auto" ? -1 : 1;
      if (
        rule === "own" &&
        ac.relationship !== bc.relationship &&
        (ac.relationship === "self" || bc.relationship === "self")
      )
        return ac.relationship === "self" ? -1 : 1;
      if (
        rule === "birthday" &&
        ac.relationship === "child" &&
        bc.relationship === "child" &&
        ac.subscriberBirthday &&
        bc.subscriberBirthday
      ) {
        const birth = ac.subscriberBirthday
          .slice(5)
          .localeCompare(bc.subscriberBirthday.slice(5));
        if (birth) return birth;
        const duration = ac.effectiveDate.localeCompare(bc.effectiveDate);
        if (duration) return duration;
      }
    }
    return 0;
  };
  for (let i = 0; i < claim.planIds.length; i++)
    for (let j = i + 1; j < claim.planIds.length; j++)
      if (!compare(claim.planIds[i]!, claim.planIds[j]!)) return null;
  return [...claim.planIds].sort(compare);
}
