ALTER TABLE claim_adjudications ADD COLUMN input_snapshot jsonb;
--> statement-breakpoint
UPDATE claim_adjudications a SET input_snapshot = jsonb_build_object('claim', c.context, 'coverage', c.coverage_snapshot) FROM claims c WHERE c.id = a.claim_id;
--> statement-breakpoint
ALTER TABLE claim_adjudications ALTER COLUMN input_snapshot SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION protect_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Records in % are append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER immutable_adjudication BEFORE UPDATE OR DELETE ON claim_adjudications FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
--> statement-breakpoint
CREATE TRIGGER immutable_line_result BEFORE UPDATE OR DELETE ON claim_line_results FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
--> statement-breakpoint
CREATE TRIGGER immutable_plan_version BEFORE UPDATE OR DELETE ON plan_versions FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
--> statement-breakpoint
CREATE TRIGGER immutable_status_history BEFORE UPDATE OR DELETE ON claim_status_history FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
--> statement-breakpoint
CREATE TRIGGER immutable_audit_log BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
--> statement-breakpoint
ALTER TABLE claim_lines ADD CONSTRAINT valid_line_money CHECK (amount >= 0 AND units > 0);
--> statement-breakpoint
ALTER TABLE claim_line_results ADD CONSTRAINT conserved_line_money CHECK (plan_pays >= 0 AND member_pays >= 0 AND eligible_amount = plan_pays + member_pays);
--> statement-breakpoint
ALTER TABLE accumulators ADD CONSTRAINT nonnegative_accumulator CHECK (individual_deductible_met >= 0 AND family_deductible_met >= 0 AND oop_met >= 0);
--> statement-breakpoint
ALTER TABLE patient_insurances ADD CONSTRAINT coverage_window CHECK (termination_date IS NULL OR termination_date >= effective_date);
--> statement-breakpoint
ALTER TABLE plan_versions ADD CONSTRAINT plan_window CHECK (effective_to IS NULL OR effective_to >= effective_from);
