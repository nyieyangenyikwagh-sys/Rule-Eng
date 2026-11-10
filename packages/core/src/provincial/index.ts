import type { ClaimContext } from "../types.js";
export interface ProvincialBillingEngine {
  verifyEligibilityFormat(card: string | null): boolean;
  formatSubmission(ctx: ClaimContext): string;
}
export class AHSEngine implements ProvincialBillingEngine {
  verifyEligibilityFormat(card: string | null) {
    return card !== null && card.length === 9 && /^\d{9}$/.test(card);
  }
  formatSubmission(ctx: ClaimContext) {
    return `AHCIP|${ctx.providerBillingNumber}|${ctx.serviceDate}|${ctx.lines.map((l) => `${l.serviceCode}:${l.units}:${(l.amount / 100).toFixed(2)}`).join("|")}`;
  }
}
export class GreenShieldEngine implements ProvincialBillingEngine {
  verifyEligibilityFormat(_card: string | null) {
    return true;
  }
  formatSubmission(ctx: ClaimContext) {
    return `GREENSHIELD|${ctx.providerBillingNumber}|${ctx.serviceDate}|${ctx.lines.length}`;
  }
}
const registry = new Map<string, ProvincialBillingEngine>([
  ["AB", new AHSEngine()],
]);
export function registerEngine(
  province: string,
  engine: ProvincialBillingEngine,
) {
  registry.set(province, engine);
}
export function getEngine(province: string): ProvincialBillingEngine {
  const engine = registry.get(province);
  if (!engine)
    throw Object.assign(new Error(`No billing engine for ${province}`), {
      statusCode: 400,
    });
  return engine;
}
