import type { ClaimStatus } from "../types.js";
export const ALLOWED_TRANSITIONS: Record<
  ClaimStatus,
  ReadonlySet<ClaimStatus>
> = {
  draft: new Set(["submitted"]),
  submitted: new Set(["paid", "denied", "rejected", "pended"]),
  pended: new Set(["paid", "denied", "rejected"]),
  denied: new Set(["appeal_pending"]),
  appeal_pending: new Set(["paid", "closed"]),
  rejected: new Set(["submitted"]),
  paid: new Set(),
  closed: new Set(),
};
export class TransitionError extends Error {
  statusCode = 409;
}
export function transition(
  from: ClaimStatus,
  to: ClaimStatus,
  reasonCode: string | null,
  createdAt: string,
) {
  if (!ALLOWED_TRANSITIONS[from].has(to))
    throw new TransitionError(`Illegal transition ${from} -> ${to}`);
  return { fromStatus: from, toStatus: to, reasonCode, createdAt };
}
