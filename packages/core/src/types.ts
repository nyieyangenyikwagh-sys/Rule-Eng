import type { PlanDefinition } from "./plans/schema.js";
export type IsoDate = string;
export type Cents = number;
export type Outcome = "ACCEPT" | "REJECT" | "DENY" | "PEND" | "PARTIAL";
export type ClaimStatus =
  | "draft"
  | "submitted"
  | "paid"
  | "denied"
  | "rejected"
  | "pended"
  | "appeal_pending"
  | "closed";
export interface RuleError {
  code: string;
  message: string;
}
export interface ClaimLineIn {
  serviceCode: string;
  diagnosisCode: string;
  units: number;
  amount: Cents;
  serviceDate?: IsoDate;
  priorAuthNumber?: string;
  priorAuthStatus?: "requested" | "approved" | "denied";
  programOfCare?: string;
}
export interface ClaimContext {
  province: string;
  providerBillingNumber: string;
  serviceDate: IsoDate;
  healthCardNumber: string | null;
  patientProvince: string;
  lines: ClaimLineIn[];
  patientId: string;
  planIds: string[];
  dateOfLoss?: IsoDate;
  receivedDate: IsoDate;
  today: IsoDate;
  injuryClassification?: "minor" | "non_minor" | "unknown";
}
export interface EligibilitySnapshot {
  eligible: boolean;
  reasonCode: string | null;
  copay?: PlanDefinition["copay"];
  deductible?: { individual: number; family: number; met: number };
  coinsurance?: number;
  priorAuthRequired?: string[];
}
export interface CoverageRecord {
  planId: string;
  effectiveDate: IsoDate;
  terminationDate: IsoDate | null;
  lastVerifiedAt: string | null;
  lastEligibility: EligibilitySnapshot | null;
  healthCardNumber?: string | null;
  relationship?: "self" | "spouse" | "child";
  subscriberBirthday?: IsoDate;
  priority?: "primary" | "secondary";
  eligibilityNoticeDate?: IsoDate;
  primaryPending?: boolean;
}
export interface PriorLine {
  claimId?: string;
  patientId: string;
  planId: string;
  planVersion?: number;
  providerBillingNumber: string;
  serviceCode: string;
  serviceDate: IsoDate;
  units: number;
  allowedUnits: number;
  amount: Cents;
  planPays: Cents;
  status: ClaimStatus;
  dateOfLoss?: IsoDate;
  deductibleApplied?: Cents;
  memberPays?: Cents;
  benefitUsed?: Record<string, number>;
}
export interface Accumulator {
  individualDeductibleMet: Cents;
  familyDeductibleMet: Cents;
  oopMet: Cents;
  benefitUsed: Record<string, Cents>;
}
export const emptyAccumulator = (): Accumulator => ({
  individualDeductibleMet: 0,
  familyDeductibleMet: 0,
  oopMet: 0,
  benefitUsed: {},
});
export interface RuleTraceEntry {
  rule: string;
  stage: number;
  fired: boolean;
  outcome: string;
  inputs: Record<string, unknown>;
  durationMs: number;
  lineNo?: number;
  planId?: string;
}
export interface LineResult {
  planVersion?: number;
  normalMemberPays?: Cents;
  lineNo: number;
  outcome: "payable" | "partial" | "denied" | "pended";
  eligibleAmount: Cents;
  deductibleApplied: Cents;
  coinsuranceAmount: Cents;
  planPays: Cents;
  memberPays: Cents;
  deniedAmount: Cents;
  allowedUnits: number;
  reasons: RuleError[];
  reviewPrompts: string[];
}
export interface PayerResult {
  planId: string;
  lines: LineResult[];
  planPaysTotal: Cents;
}
export interface Decision {
  outcome: Outcome;
  primaryReasonCode: string | null;
  errors: RuleError[];
  lines: LineResult[];
  billedAmount: Cents;
  planPaysTotal: Cents;
  memberPaysTotal: Cents;
  suggestedStatus: ClaimStatus;
  coverageSnapshot: CoverageRecord[];
  planVersionsUsed: { planId: string; version: number }[];
  trace: RuleTraceEntry[];
  engineVersion: string;
  reviewPrompts: string[];
  payers: PayerResult[];
  accumulatorUpdates: Record<string, Accumulator>;
  flags: { claimId: string; flag: "REPROCESS_CANDIDATE" | "RECOVERY_REVIEW" }[];
}
export interface EvaluationInput {
  claim: ClaimContext;
  plans: PlanDefinition[];
  coverage: CoverageRecord[];
  history: PriorLine[] | null;
  accumulators?: Record<string, Accumulator>;
}
export interface Clock {
  today(): IsoDate;
}
export interface ClaimHistoryPort {
  priorLines(
    patientId: string,
    from: IsoDate,
    to: IsoDate,
  ): Promise<PriorLine[]>;
}
export interface AccumulatorPort {
  get(patientId: string, planId: string, period: string): Promise<Accumulator>;
}
export interface PlanPort {
  versionFor(planId: string, onDate: IsoDate): Promise<PlanDefinition | null>;
}
