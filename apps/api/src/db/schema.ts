import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type {
  ClaimStatus,
  Decision,
  EligibilitySnapshot,
  PlanDefinition,
  Accumulator,
  ClaimContext,
  LineResult,
} from "@alberta-rules/core";
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });
const money = (name: string) => bigint(name, { mode: "number" });
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  hashedPassword: text("hashed_password").notNull(),
  role: text("role").$type<"admin" | "biller" | "analyst">().notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: time("created_at").defaultNow().notNull(),
    expiresAt: time("expires_at").notNull(),
    lastUsedAt: time("last_used_at"),
    revokedAt: time("revoked_at"),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(t.tokenHash),
    index("auth_sessions_user").on(t.userId),
  ],
);
export const patients = pgTable("patients", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dob: text("dob").notNull(),
  gender: text("gender").notNull(),
  province: text("province").default("AB").notNull(),
  email: text("email"),
  phone: text("phone"),
});
export const insurancePlans = pgTable("insurance_plans", {
  id: serial("id").primaryKey(),
  planId: text("plan_id").notNull().unique(),
  payerId: text("payer_id").notNull().unique(),
  name: text("name").notNull(),
  layer: text("layer").notNull(),
  planType: text("plan_type").default("configured").notNull(),
});
export const planVersions = pgTable(
  "plan_versions",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => insurancePlans.id),
    version: integer("version").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    definition: jsonb("definition").$type<PlanDefinition>().notNull(),
  },
  (t) => [uniqueIndex("plan_version_unique").on(t.planId, t.version)],
);
export const patientInsurances = pgTable(
  "patient_insurances",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patients.id),
    planId: integer("plan_id")
      .notNull()
      .references(() => insurancePlans.id),
    memberId: text("member_id").notNull(),
    healthCardNumber: text("health_card_number"),
    groupNumber: text("group_number"),
    effectiveDate: text("effective_date").notNull(),
    terminationDate: text("termination_date"),
    priority: text("priority")
      .$type<"primary" | "secondary">()
      .default("primary")
      .notNull(),
    relationship: text("relationship").$type<"self" | "spouse" | "child">(),
    subscriberBirthday: text("subscriber_birthday"),
    eligibilityNoticeDate: text("eligibility_notice_date"),
    lastVerifiedAt: time("last_verified_at"),
    lastEligibility: jsonb("last_eligibility").$type<EligibilitySnapshot>(),
    eligibilitySourceReference: text("eligibility_source_reference"),
  },
  (t) => [uniqueIndex("patient_plan_unique").on(t.patientId, t.planId)],
);
export const claims = pgTable(
  "claims",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patients.id),
    planId: integer("plan_id")
      .notNull()
      .references(() => insurancePlans.id),
    province: text("province").notNull(),
    providerBillingNumber: text("provider_billing_number").notNull(),
    serviceDate: text("service_date").notNull(),
    receivedDate: text("received_date").notNull(),
    dateOfLoss: text("date_of_loss"),
    billedAmount: money("billed_amount").notNull(),
    coverageSnapshot: jsonb("coverage_snapshot").notNull(),
    status: text("status").$type<ClaimStatus>().notNull(),
    denialReasonCode: text("denial_reason_code"),
    context: jsonb("context").$type<ClaimContext>().notNull(),
    submission: text("submission"),
    createdAt: time("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("claims_patient_date").on(t.patientId, t.serviceDate),
    index("claims_provider_date").on(t.providerBillingNumber, t.serviceDate),
  ],
);
export const claimLines = pgTable(
  "claim_lines",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id")
      .notNull()
      .references(() => claims.id),
    lineNo: integer("line_no").notNull(),
    serviceCode: text("service_code").notNull(),
    diagnosisCode: text("diagnosis_code").notNull(),
    units: integer("units").notNull(),
    amount: money("amount").notNull(),
    serviceDate: text("service_date").notNull(),
    priorAuthNumber: text("prior_auth_number"),
  },
  (t) => [index("claim_lines_claim").on(t.claimId)],
);
export const claimStatusHistory = pgTable("claim_status_history", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id")
    .notNull()
    .references(() => claims.id),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  reasonCode: text("reason_code"),
  createdAt: time("created_at").notNull(),
});
export const claimAdjudications = pgTable(
  "claim_adjudications",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id")
      .notNull()
      .references(() => claims.id),
    seq: integer("seq").notNull(),
    supersedesId: integer("supersedes_id"),
    outcome: text("outcome").notNull(),
    decision: jsonb("decision").$type<Decision>().notNull(),
    inputSnapshot: jsonb("input_snapshot").notNull(),
    trace: jsonb("trace").notNull(),
    engineVersion: text("engine_version").notNull(),
    createdAt: time("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("claim_adjudication_sequence").on(t.claimId, t.seq)],
);
export const claimLineResults = pgTable("claim_line_results", {
  id: serial("id").primaryKey(),
  adjudicationId: integer("adjudication_id")
    .notNull()
    .references(() => claimAdjudications.id),
  lineNo: integer("line_no").notNull(),
  outcome: text("outcome").notNull(),
  eligibleAmount: money("eligible_amount").notNull(),
  planPays: money("plan_pays").notNull(),
  memberPays: money("member_pays").notNull(),
  deductibleApplied: money("deductible_applied").notNull(),
  coinsuranceAmount: money("coinsurance_amount").notNull(),
  reasons: jsonb("reasons").notNull(),
  result: jsonb("result").$type<LineResult>().notNull(),
});
export const accumulators = pgTable(
  "accumulators",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patients.id),
    planId: integer("plan_id")
      .notNull()
      .references(() => insurancePlans.id),
    periodKey: text("period_key").notNull(),
    individualDeductibleMet: money("individual_deductible_met")
      .notNull()
      .default(0),
    familyDeductibleMet: money("family_deductible_met").notNull().default(0),
    oopMet: money("oop_met").notNull().default(0),
    benefitUsed: jsonb("benefit_used")
      .$type<Accumulator["benefitUsed"]>()
      .notNull()
      .default({}),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("accumulator_key").on(t.patientId, t.planId, t.periodKey),
  ],
);
export const claimFlags = pgTable("claim_flags", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id")
    .notNull()
    .references(() => claims.id),
  flag: text("flag").notNull(),
  createdAt: time("created_at").defaultNow().notNull(),
  clearedAt: time("cleared_at"),
});
export const overrides = pgTable("overrides", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id")
    .notNull()
    .references(() => claims.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  fromOutcome: text("from_outcome").notNull(),
  toOutcome: text("to_outcome").notNull(),
  reason: text("reason").notNull(),
  createdAt: time("created_at").defaultNow().notNull(),
});
// HIA access audit: identities and resource IDs only; never clinical payloads or PHNs.
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  apiKeyId: integer("api_key_id"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  reason: text("reason"),
  ipAddress: text("ip_address").notNull(),
  createdAt: time("created_at").defaultNow().notNull(),
});
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  lastUsedAt: time("last_used_at"),
  revokedAt: time("revoked_at"),
});
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: serial("id").primaryKey(),
    owner: text("owner").notNull(),
    key: text("key").notNull(),
    bodyHash: text("body_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").notNull(),
    expiresAt: time("expires_at").notNull(),
  },
  (t) => [uniqueIndex("idempotency_owner_key").on(t.owner, t.key)],
);
export const provincialRules = pgTable("provincial_rules", {
  province: text("province").primaryKey(),
  config: jsonb("config").notNull(),
});
