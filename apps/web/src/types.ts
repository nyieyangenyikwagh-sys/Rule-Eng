export type Page = "overview" | "adjudicate" | "patients" | "claims" | "rules";

export interface Coverage {
  id: number;
  patient_id: number;
  plan_id: number;
  payer_id?: string;
  plan_name?: string;
  member_id: string;
  priority: "primary" | "secondary";
  effective_date: string;
  termination_date: string | null;
  last_verified_at: string | null;
  eligibility_source_reference?: string | null;
  last_eligibility?: Eligibility | null;
}

export interface Eligibility {
  eligible: boolean;
  member_id?: string;
  effective_date?: string;
  termination_date?: string | null;
  reason?: string;
  verified_at?: string;
  patient_insurance_id?: number;
  source_reference?: string;
}

export interface Patient {
  id: number;
  first_name: string;
  last_name: string;
  dob: string;
  gender: string;
  province: string;
  email?: string | null;
  phone?: string | null;
  insurance: Coverage[];
}

export interface Plan {
  id: number;
  plan_id: string;
  payer_id: string;
  name: string;
  layer: "public" | "private" | "auto" | string;
  plan_type: string;
  versions?: Record<string, unknown>[];
}

export interface Rule {
  id: string;
  stage: number;
  description: string;
}

export type Outcome = "ACCEPT" | "PARTIAL" | "PEND" | "DENY" | "REJECT";

export interface DecisionLine {
  line_no: number;
  outcome: string;
  eligible_amount: number;
  plan_pays: number;
  member_pays: number;
  denied_amount: number;
  deductible_applied: number;
  coinsurance_amount: number;
  allowed_units: number;
  reasons: { code: string; message: string }[];
  review_prompts: string[];
}

export interface Decision {
  outcome: Outcome;
  primary_reason_code: string | null;
  errors: { code: string; message: string }[];
  billed_amount: number;
  plan_pays_total: number;
  member_pays_total: number;
  suggested_status: string;
  plan_versions_used: { plan_id: string; version: number }[];
  engine_version: string;
  review_prompts: string[];
  lines: DecisionLine[];
  trace?: {
    rule: string;
    stage: number;
    fired: boolean;
    outcome: string;
    duration_ms: number;
    line_no?: number;
    plan_id?: string;
  }[];
}

export interface ClaimSummary {
  id: number;
  patient_id: number;
  patient_name: string;
  plan_id: number;
  plan_code: string | null;
  plan_name: string | null;
  status: string;
  outcome: Outcome | null;
  billed_amount: number;
  plan_pays_total: number;
  service_date: string;
  provider_billing_number: string;
  denial_reason_code: string | null;
  created_at: string;
}

export interface ClaimDetail {
  id: number;
  patient_id: number;
  status: string;
  province: string;
  billed_amount: number;
  denial_reason_code: string | null;
  decision: Decision | null;
  adjudications: {
    id: number;
    seq: number;
    created_at: string;
    decision: Decision;
  }[];
  status_history: {
    id: number;
    from_status: string;
    to_status: string;
    reason_code: string | null;
    created_at: string;
  }[];
  flags: {
    id: number;
    flag: string;
    created_at: string;
    cleared_at: string | null;
  }[];
}

export interface ClaimInput {
  patient_id: number;
  plan_id: number;
  province: string;
  provider_billing_number: string;
  service_date: string;
  received_date: string;
  injury_classification: "minor" | "non_minor" | "unknown";
  date_of_loss?: string;
  lines: {
    service_code: string;
    diagnosis_code: string;
    units: number;
    amount: number;
    prior_auth_number?: string;
    prior_auth_status?: "requested" | "approved" | "denied";
    program_of_care?: string;
  }[];
}
