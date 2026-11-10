// Demonstration data only. No entry is an authoritative fee or clinical recommendation.
export const AHS_SERVICE_CODES: Record<string, string> = {
  "03.03A": "Office visit",
  "03.04A": "Comprehensive assessment",
  "03.05A": "Consultation",
  "03.08A": "Hospital visit",
  "13.99A": "Other service",
};
export const SERVICE_CODES_BY_PROVINCE: Record<
  string,
  Record<string, string>
> = {
  AB: AHS_SERVICE_CODES,
};
export const ICD10CA_CODES = new Set([
  "J06.9",
  "E11.9",
  "I10",
  "M54.5",
  "R51",
  "Z00.0",
  "F41.1",
  "S13.4",
  "S33.5",
]);
export const PRIVATE_CODES = [
  "PHYSIO-INIT",
  "PHYSIO-FU",
  "CHIRO",
  "MASSAGE",
  "MRI",
  "27447",
  "DRUG",
];
export const AUTO_CODES = [
  "PHYSIO-INIT",
  "PHYSIO-FU",
  "CHIRO",
  "MASSAGE",
  "ASSESSMENT",
];
export function categories(code: string): string[] {
  if (code in AHS_SERVICE_CODES) return ["insured_physician_service"];
  if (code.startsWith("PHYSIO-"))
    return ["physio", "paramedical", "medical_rehab"];
  if (["CHIRO", "MASSAGE"].includes(code))
    return [code.toLowerCase(), "paramedical", "medical_rehab"];
  if (code === "ASSESSMENT") return ["medical_rehab"];
  return code === "DRUG" ? ["drug"] : ["diagnostic"];
}
export const PROVINCE_CONFIG = {
  AB: {
    billingNumberRe: /^\d{6}$/,
    filingLimitDays: 90,
    healthCardRe: /^\d{9}$/,
  },
  ON: {
    billingNumberRe: /^\d{6}$/,
    filingLimitDays: 183,
    healthCardRe: /^\d{10}[A-Z]{2}$/,
  },
} as const;
