import type { ClaimContext, RuleError } from "../../types.js";
import {
  PROVINCE_CONFIG,
  ICD10CA_CODES,
  SERVICE_CODES_BY_PROVINCE,
  PRIVATE_CODES,
  AUTO_CODES,
} from "../../reference/codes.js";
import { addDays } from "../../dates.js";
import { versionFor, type PlanDefinition } from "../../plans/schema.js";
export type ValidationRule = (
  ctx: ClaimContext,
  plans?: PlanDefinition[],
) => RuleError[];
const config = (province: string) =>
  PROVINCE_CONFIG[province as keyof typeof PROVINCE_CONFIG];
const resolved = (ctx: ClaimContext, plans: PlanDefinition[], date: string) =>
  ctx.planIds
    .map((id) => {
      const auto = plans.some((p) => p.planId === id && p.layer === "auto");
      return versionFor(plans, id, auto ? (ctx.dateOfLoss ?? date) : date);
    })
    .filter((p): p is PlanDefinition => p !== null);
export const r001RequiredFields: ValidationRule = (ctx) => [
  ...(!ctx.lines.length
    ? [{ code: "R001", message: "Claim has no service lines" }]
    : []),
  ...(!ctx.providerBillingNumber
    ? [{ code: "R001", message: "Missing provider billing number" }]
    : []),
];
export const r002BillingNumber: ValidationRule = (ctx) =>
  config(ctx.province) &&
  (ctx.providerBillingNumber.length !== 6 ||
    !config(ctx.province).billingNumberRe.test(ctx.providerBillingNumber))
    ? [{ code: "R002", message: `Billing number invalid for ${ctx.province}` }]
    : [];
export const r003DiagnosisCodes: ValidationRule = (ctx) =>
  ctx.lines
    .filter((l) => !ICD10CA_CODES.has(l.diagnosisCode))
    .map((l) => ({
      code: "R003",
      message: `Unknown ICD-10-CA code ${l.diagnosisCode}`,
    }));
export const r004ServiceCodes: ValidationRule = (ctx, plans = []) =>
  ctx.lines.flatMap((l) => {
    const selected = resolved(ctx, plans, l.serviceDate ?? ctx.serviceDate);
    const systems = selected.length
      ? selected.map((p) => p.codeSystem)
      : plans
          .filter((p) => ctx.planIds.includes(p.planId))
          .map((p) => p.codeSystem);
    if (!systems.length) systems.push("SOMB");
    const valid = systems.some((s) =>
      s === "SOMB"
        ? l.serviceCode in (SERVICE_CODES_BY_PROVINCE[ctx.province] ?? {})
        : l.serviceCode in (SERVICE_CODES_BY_PROVINCE[ctx.province] ?? {}) ||
          (s === "PRIVATE_SCHEDULE" ? PRIVATE_CODES : AUTO_CODES).includes(
            l.serviceCode,
          ),
    );
    return valid
      ? []
      : [
          {
            code: "R004",
            message: `Unknown ${systems.every((s) => s === "SOMB") ? "AHCIP SOMB" : "service"} code ${l.serviceCode}`,
          },
        ];
  });
export const r005TimelyFiling: ValidationRule = (ctx, plans = []) =>
  ctx.lines.flatMap((l) => {
    const date = l.serviceDate ?? ctx.serviceDate;
    const selected = resolved(ctx, plans, date);
    const limit = selected.length
      ? Math.max(
          ...selected.map(
            (p) =>
              p.filingLimitDays ?? config(ctx.province)?.filingLimitDays ?? 90,
          ),
        )
      : (config(ctx.province)?.filingLimitDays ?? 90);
    return date < addDays(ctx.receivedDate, -limit)
      ? [{ code: "R005", message: "Past the timely-filing limit" }]
      : [];
  });
export const r009HealthCard: ValidationRule = (ctx, plans = []) => {
  if (
    plans.length &&
    !plans.some((p) => ctx.planIds.includes(p.planId) && p.layer === "public")
  )
    return [];
  const cfg = config(ctx.province);
  const length = ctx.province === "AB" ? 9 : 12;
  return cfg &&
    (!ctx.healthCardNumber ||
      ctx.healthCardNumber.length !== length ||
      !cfg.healthCardRe.test(ctx.healthCardNumber))
    ? [{ code: "R009", message: `Invalid ${ctx.province} health card` }]
    : [];
};
export const r010ResidencyRouting: ValidationRule = (ctx) =>
  ctx.patientProvince !== ctx.province
    ? [
        {
          code: "R010",
          message: `Patient (${ctx.patientProvince}) cannot be billed to ${ctx.province}`,
        },
      ]
    : [];
export const RULES = [
  r001RequiredFields,
  r002BillingNumber,
  r003DiagnosisCodes,
  r004ServiceCodes,
  r005TimelyFiling,
  r009HealthCard,
  r010ResidencyRouting,
];
export const REFERENCE_RULE_IDS = [
  "R001",
  "R002",
  "R003",
  "R004",
  "R005",
  "R009",
  "R010",
];
export const runRules = (
  ctx: ClaimContext,
  plans?: PlanDefinition[],
): RuleError[] => RULES.flatMap((r) => r(ctx, plans));
