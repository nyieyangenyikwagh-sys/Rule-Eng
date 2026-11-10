CREATE TABLE "accumulators" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"period_key" text NOT NULL,
	"individual_deductible_met" bigint DEFAULT 0 NOT NULL,
	"family_deductible_met" bigint DEFAULT 0 NOT NULL,
	"oop_met" bigint DEFAULT 0 NOT NULL,
	"benefit_used" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);

--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);

--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"api_key_id" integer,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"reason" text,
	"ip_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "claim_adjudications" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"supersedes_id" integer,
	"outcome" text NOT NULL,
	"decision" jsonb NOT NULL,
	"trace" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "claim_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"flag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);

--> statement-breakpoint
CREATE TABLE "claim_line_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"adjudication_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"outcome" text NOT NULL,
	"eligible_amount" bigint NOT NULL,
	"plan_pays" bigint NOT NULL,
	"member_pays" bigint NOT NULL,
	"deductible_applied" bigint NOT NULL,
	"coinsurance_amount" bigint NOT NULL,
	"reasons" jsonb NOT NULL,
	"result" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "claim_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"service_code" text NOT NULL,
	"diagnosis_code" text NOT NULL,
	"units" integer NOT NULL,
	"amount" bigint NOT NULL,
	"service_date" text NOT NULL,
	"prior_auth_number" text
);

--> statement-breakpoint
CREATE TABLE "claim_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"reason_code" text,
	"created_at" timestamp with time zone NOT NULL
);

--> statement-breakpoint
CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"province" text NOT NULL,
	"provider_billing_number" text NOT NULL,
	"service_date" text NOT NULL,
	"received_date" text NOT NULL,
	"date_of_loss" text,
	"billed_amount" bigint NOT NULL,
	"coverage_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"denial_reason_code" text,
	"context" jsonb NOT NULL,
	"submission" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"key" text NOT NULL,
	"body_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);

--> statement-breakpoint
CREATE TABLE "insurance_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"name" text NOT NULL,
	"layer" text NOT NULL,
	"plan_type" text DEFAULT 'demo' NOT NULL,
	CONSTRAINT "insurance_plans_plan_id_unique" UNIQUE("plan_id"),
	CONSTRAINT "insurance_plans_payer_id_unique" UNIQUE("payer_id")
);

--> statement-breakpoint
CREATE TABLE "overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"claim_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"from_outcome" text NOT NULL,
	"to_outcome" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "patient_insurances" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"member_id" text NOT NULL,
	"health_card_number" text,
	"group_number" text,
	"effective_date" text NOT NULL,
	"termination_date" text,
	"priority" text DEFAULT 'primary' NOT NULL,
	"relationship" text,
	"subscriber_birthday" text,
	"eligibility_notice_date" text,
	"last_verified_at" timestamp with time zone,
	"last_eligibility" jsonb
);

--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"dob" text NOT NULL,
	"gender" text NOT NULL,
	"province" text DEFAULT 'AB' NOT NULL,
	"email" text,
	"phone" text
);

--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"version" integer NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"definition" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "provincial_rules" (
	"province" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL
);

--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"hashed_password" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

--> statement-breakpoint
ALTER TABLE "accumulators" ADD CONSTRAINT "accumulators_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "accumulators" ADD CONSTRAINT "accumulators_plan_id_insurance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."insurance_plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claim_adjudications" ADD CONSTRAINT "claim_adjudications_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claim_flags" ADD CONSTRAINT "claim_flags_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claim_line_results" ADD CONSTRAINT "claim_line_results_adjudication_id_claim_adjudications_id_fk" FOREIGN KEY ("adjudication_id") REFERENCES "public"."claim_adjudications"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_plan_id_insurance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."insurance_plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "overrides" ADD CONSTRAINT "overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "patient_insurances" ADD CONSTRAINT "patient_insurances_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "patient_insurances" ADD CONSTRAINT "patient_insurances_plan_id_insurance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."insurance_plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_insurance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."insurance_plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "accumulator_key" ON "accumulators" USING btree ("patient_id","plan_id","period_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_adjudication_sequence" ON "claim_adjudications" USING btree ("claim_id","seq");
--> statement-breakpoint
CREATE INDEX "claim_lines_claim" ON "claim_lines" USING btree ("claim_id");
--> statement-breakpoint
CREATE INDEX "claims_patient_date" ON "claims" USING btree ("patient_id","service_date");
--> statement-breakpoint
CREATE INDEX "claims_provider_date" ON "claims" USING btree ("provider_billing_number","service_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_owner_key" ON "idempotency_keys" USING btree ("owner","key");
--> statement-breakpoint
CREATE UNIQUE INDEX "patient_plan_unique" ON "patient_insurances" USING btree ("patient_id","plan_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "plan_version_unique" ON "plan_versions" USING btree ("plan_id","version");