import type {
  Accumulator,
  ClaimContext,
  Decision,
  EvaluationInput,
  LineResult,
  Outcome,
  PriorLine,
  RuleError,
  RuleTraceEntry,
} from "./types.js";
import { emptyAccumulator } from "./types.js";
import {
  type PlanDefinition,
  type Selector,
  versionFor,
} from "./plans/schema.js";
import { categories } from "./reference/codes.js";
import { addDays, addMonths, daysBetween, windowStart } from "./dates.js";
import { RULES, REFERENCE_RULE_IDS } from "./rules/reference/index.js";
import { costShare } from "./rules/extensions/money.js";
import { cobOrder } from "./rules/extensions/cob.js";
import { getEngine } from "./provincial/index.js";

export const ENGINE_VERSION = "1.0.0";
export function matches(selector: Selector, code: string): boolean {
  return !!(
    selector.codes?.includes(code) ||
    (selector.category && categories(code).includes(selector.category))
  );
}
export function accumulatorKey(
  plan: PlanDefinition,
  date: string,
  loss?: string,
): string {
  const period =
    plan.benefitPeriod === "calendar_year"
      ? date.slice(0, 4)
      : plan.benefitPeriod === "per_accident"
        ? (loss ?? "unknown")
        : date;
  return `${plan.planId}:${plan.accumulatorCarryover ? "carry" : plan.version}:${period}`;
}
function initialLine(lineNo: number, billed: number): LineResult {
  return {
    lineNo,
    outcome: "payable",
    eligibleAmount: billed,
    deductibleApplied: 0,
    coinsuranceAmount: 0,
    planPays: 0,
    memberPays: 0,
    deniedAmount: 0,
    allowedUnits: 0,
    reasons: [],
    reviewPrompts: [],
  };
}
function resultOutcome(lines: LineResult[]): Outcome {
  if (lines.some((l) => l.outcome === "pended")) return "PEND";
  if (lines.every((l) => l.outcome === "denied")) return "DENY";
  if (lines.some((l) => l.outcome !== "payable")) return "PARTIAL";
  return "ACCEPT";
}
export function evaluateClaim(input: EvaluationInput): Decision {
  const { claim: ctx, plans, coverage } = input;
  getEngine(ctx.province);
  const history = (input.history ?? []).filter(
    (h) => h.patientId === ctx.patientId,
  );
  const trace: RuleTraceEntry[] = [];
  const record = (
    rule: string,
    stage: number,
    fired: boolean,
    outcome: string,
    inputs: Record<string, unknown>,
    lineNo?: number,
    planId?: string,
  ) => {
    // Timing is collected at the API boundary; deterministic core traces have no wall-clock I/O.
    trace.push({
      rule,
      stage,
      fired,
      outcome,
      inputs,
      durationMs: 0,
      ...(lineNo ? { lineNo } : {}),
      ...(planId ? { planId } : {}),
    });
  };
  const errors: RuleError[] = [];
  RULES.forEach((rule, i) => {
    // Retro filing relief is applied per plan below, never by changing the service date.
    let found = rule(ctx, plans);
    if (REFERENCE_RULE_IDS[i] === "R005" && found.length) {
      const coveredByRelief = ctx.planIds.every((id) => {
        const cov = coverage.find((c) => c.planId === id);
        return ctx.lines.every((l) => {
          const p = versionFor(plans, id, l.serviceDate ?? ctx.serviceDate);
          return (
            p?.retroFilingClock === "eligibility_notice_date" &&
            cov?.eligibilityNoticeDate &&
            daysBetween(cov.eligibilityNoticeDate, ctx.receivedDate) <=
              (p.filingLimitDays ?? 90)
          );
        });
      });
      if (coveredByRelief) found = [];
    }
    errors.push(...found);
    record(
      REFERENCE_RULE_IDS[i]!,
      1,
      found.length > 0,
      found.length ? "REJECT" : "pass",
      {
        lineCount: ctx.lines.length,
        errorCount: found.length,
      },
    );
  });
  const decision: Decision = {
    outcome: "ACCEPT",
    primaryReasonCode: null,
    errors,
    lines: [],
    billedAmount: ctx.lines.reduce((s, l) => s + l.amount * l.units, 0),
    planPaysTotal: 0,
    memberPaysTotal: 0,
    suggestedStatus: "submitted",
    coverageSnapshot: structuredClone(coverage),
    planVersionsUsed: [],
    trace,
    engineVersion: ENGINE_VERSION,
    reviewPrompts: [],
    payers: [],
    accumulatorUpdates: {},
    flags: [],
  };
  if (errors.length)
    return {
      ...decision,
      outcome: "REJECT",
      primaryReasonCode: errors[0]!.code,
      suggestedStatus: "rejected",
    };
  const order = cobOrder(ctx, plans, coverage);
  if (!order || coverage.some((c) => c.primaryPending)) {
    const code = order ? "COB_PRIMARY_PENDING" : "COB_ORDER_UNDETERMINED";
    const message = order
      ? "Primary payer has not adjudicated"
      : "Payer order requires review";
    record("R014", 3, true, "PEND", { planCount: ctx.planIds.length });
    return {
      ...decision,
      outcome: "PEND",
      primaryReasonCode: code,
      errors: [{ code, message }],
      suggestedStatus: "pended",
      reviewPrompts: [
        "Confirm primary and secondary coverage; attach primary decision",
      ],
    };
  }
  const paidByLine = ctx.lines.map(() => 0);
  const maximumEligible = ctx.lines.map(() => 0);
  const consumed: PriorLine[] = [];
  const within = (
    h: PriorLine,
    date: string,
    period: Parameters<typeof windowStart>[1],
    rollingDays?: number,
  ) =>
    h.serviceDate >= windowStart(date, period, ctx.dateOfLoss, rollingDays) &&
    h.serviceDate <= date &&
    (period !== "per_accident" || h.dateOfLoss === ctx.dateOfLoss);
  const existing = (plan: PlanDefinition, date: string): Accumulator => {
    const key = accumulatorKey(plan, date, ctx.dateOfLoss);
    const supplied =
      input.accumulators?.[key] ?? input.accumulators?.[plan.planId];
    const acc = supplied ? structuredClone(supplied) : emptyAccumulator();
    for (const h of [...(supplied ? [] : history), ...consumed])
      if (
        h.planId === plan.planId &&
        h.status !== "rejected" &&
        h.status !== "denied" &&
        h.status !== "pended" &&
        within(h, date, plan.benefitPeriod) &&
        (plan.accumulatorCarryover || h.planVersion === plan.version)
      ) {
        acc.individualDeductibleMet += h.deductibleApplied ?? 0;
        acc.familyDeductibleMet += h.deductibleApplied ?? 0;
        acc.oopMet += h.memberPays ?? 0;
      }
    for (const rule of plan.benefitMaximums) {
      const benefitKey = rule.category ?? rule.codes!.join(",");
      acc.benefitUsed[benefitKey] =
        (supplied?.benefitUsed[benefitKey] ?? 0) +
        [...(supplied ? [] : history), ...consumed]
          .filter(
            (h) =>
              h.planId === plan.planId &&
              !["rejected", "denied", "pended"].includes(h.status) &&
              matches(rule, h.serviceCode) &&
              within(h, date, rule.period, rule.rollingDays),
          )
          .reduce((sum, h) => sum + h.planPays, 0);
    }
    decision.accumulatorUpdates[key] = acc;
    return acc;
  };
  const chronology = ctx.lines
    .map((l, i) => ({ l, i, date: l.serviceDate ?? ctx.serviceDate }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.i - b.i);
  for (const planId of order) {
    const cov = coverage.find((c) => c.planId === planId);
    const family = plans.filter((p) => p.planId === planId);
    const auto = family.some((p) => p.layer === "auto");
    const resolved = ctx.lines.map((l) =>
      versionFor(
        plans,
        planId,
        auto ? (ctx.dateOfLoss ?? "") : (l.serviceDate ?? ctx.serviceDate),
      ),
    );
    const lineResults = ctx.lines.map((l, i) =>
      initialLine(i + 1, l.amount * l.units),
    );
    const staged: PriorLine[] = [];
    for (const { l, i, date } of chronology) {
      const line = lineResults[i]!;
      const plan = resolved[i];
      const billed = l.amount * l.units;
      const emit = (
        rule: string,
        stage: number,
        code?: string,
        message?: string,
        outcome: "denied" | "pended" | "partial" = "denied",
        inputs: Record<string, unknown> = {},
      ) => {
        record(
          rule,
          stage,
          !!code,
          code ? outcome : "pass",
          inputs,
          i + 1,
          planId,
        );
        if (code) {
          line.reasons.push({ code, message: message! });
          line.outcome = outcome;
          if (outcome === "denied") {
            line.eligibleAmount = 0;
            line.deniedAmount = billed;
            line.allowedUnits = 0;
          }
          if (outcome === "pended") {
            line.eligibleAmount = 0;
            line.allowedUnits = 0;
            line.reviewPrompts.push(
              "Attach clinical notes",
              "Confirm coverage and treatment plan",
            );
          }
        }
      };
      if (auto && !ctx.dateOfLoss) {
        emit(
          "R016",
          2,
          "DATE_OF_LOSS_REQUIRED",
          "Date of loss is required",
          "pended",
        );
        continue;
      }
      if (!plan) {
        emit(
          "R006",
          2,
          "PLAN_VERSION_UNKNOWN",
          "No unique plan version for the applicable date",
          "pended",
        );
        continue;
      }
      line.planVersion = plan.version;
      if (
        !decision.planVersionsUsed.some(
          (p) => p.planId === planId && p.version === plan.version,
        )
      )
        decision.planVersionsUsed.push({ planId, version: plan.version });
      if (
        !cov ||
        date < cov.effectiveDate ||
        (cov.terminationDate && date > cov.terminationDate)
      ) {
        emit(
          "R006",
          2,
          "COVERAGE_PERIOD",
          "Service date outside coverage period",
        );
        continue;
      }
      emit("R006", 2, undefined, undefined, "denied", {
        serviceDate: date,
        effectiveFrom: cov.effectiveDate,
        terminationDate: cov.terminationDate,
      });
      const coverageRule =
        plan.coverage.find((r) => matches(r, l.serviceCode) && !r.covered) ??
        plan.coverage.find((r) => matches(r, l.serviceCode));
      if (!coverageRule?.covered) {
        emit(
          "R007",
          2,
          coverageRule?.reason ?? "NOT_A_BENEFIT",
          "Service is not a covered benefit",
        );
        continue;
      }
      emit("R007", 2, undefined, undefined, "denied", {
        serviceCode: l.serviceCode,
      });
      if (
        plan.priorAuth.some(
          (v) => v === l.serviceCode || categories(l.serviceCode).includes(v),
        ) &&
        (!l.priorAuthNumber ||
          l.priorAuthStatus === "denied" ||
          l.priorAuthStatus === "requested")
      ) {
        emit(
          "R008",
          2,
          "PRIOR_AUTH_REQUIRED",
          "Prior authorization is required",
          l.priorAuthStatus === "requested" ? "pended" : "denied",
        );
        continue;
      }
      emit("R008", 2);
      if (auto && ctx.dateOfLoss && date < ctx.dateOfLoss) {
        emit("R016", 2, "SERVICE_BEFORE_LOSS", "Service predates the accident");
        continue;
      }
      emit("R016", 2, undefined, undefined, "denied", {
        dateOfLoss: ctx.dateOfLoss ?? null,
        version: plan.version,
      });
      if (input.history === null) {
        emit(
          "R015",
          3,
          "HISTORY_UNAVAILABLE",
          "Required history is unavailable",
          "pended",
        );
        continue;
      }
      const duplicate = [...history, ...staged].some(
        (h) =>
          h.status !== "rejected" &&
          h.providerBillingNumber === ctx.providerBillingNumber &&
          h.serviceCode === l.serviceCode &&
          h.serviceDate === date &&
          h.units === l.units,
      );
      if (duplicate) {
        emit("R015", 3, "DUPLICATE_CLAIM", "Identical service already billed");
        continue;
      }
      emit("R015", 3);
      let units = l.units;
      let interval = false;
      for (const r of plan.frequency.filter((r) => matches(r, l.serviceCode))) {
        const previous = [...history, ...staged].filter(
          (h) =>
            h.planId === planId &&
            matches(r, h.serviceCode) &&
            h.allowedUnits > 0 &&
            !["rejected", "denied", "pended"].includes(h.status) &&
            within(h, date, r.period, r.rollingDays),
        );
        if (
          r.minDaysBetween &&
          previous.some(
            (h) => daysBetween(h.serviceDate, date) < r.minDaysBetween!,
          )
        )
          interval = true;
        units = Math.min(
          units,
          Math.max(
            0,
            r.maxUnits - previous.reduce((sum, h) => sum + h.allowedUnits, 0),
          ),
        );
      }
      if (interval) {
        emit(
          "R012",
          3,
          "FREQUENCY_INTERVAL",
          "Services are too close together",
        );
        continue;
      }
      if (units < l.units)
        emit(
          "R012",
          3,
          "FREQUENCY_EXCEEDED",
          "Frequency limit exceeded",
          units ? "partial" : "denied",
          { requestedUnits: l.units, allowedUnits: units },
        );
      else
        emit("R012", 3, undefined, undefined, "denied", {
          requestedUnits: l.units,
          allowedUnits: units,
        });
      if (!units) continue;
      for (const r of plan.medicalNecessity) {
        if ((r.codes || r.category) && !matches(r, l.serviceCode)) continue;
        let ok = true;
        if (r.mode === "diagnosis_service_map")
          ok = !!r.allowedDiagnoses?.includes(l.diagnosisCode);
        if (r.mode === "protocol") {
          const visits = [...history, ...staged]
            .filter(
              (h) =>
                h.planId === planId &&
                h.dateOfLoss === ctx.dateOfLoss &&
                h.serviceDate <= date &&
                !["denied", "pended", "rejected"].includes(h.status),
            )
            .reduce((s, h) => s + h.allowedUnits, 0);
          ok =
            !!ctx.injuryClassification &&
            ctx.injuryClassification !== "unknown" &&
            !!r.classifications?.includes(ctx.injuryClassification) &&
            (r.maxUnits === undefined || visits + units <= r.maxUnits) &&
            (r.withinDays === undefined ||
              (!!ctx.dateOfLoss &&
                daysBetween(ctx.dateOfLoss, date) <= r.withinDays));
        }
        if (r.mode === "program_of_care")
          ok =
            !!ctx.dateOfLoss &&
            daysBetween(ctx.dateOfLoss, ctx.receivedDate) >= 0 &&
            daysBetween(ctx.dateOfLoss, ctx.receivedDate) <=
              r.preApprovedIfClaimedWithinDays! &&
            !!l.programOfCare &&
            !!r.programs?.includes(l.programOfCare);
        if (!ok) {
          emit(
            "R013",
            3,
            r.hard ? "NECESSITY_MISMATCH" : "NECESSITY_REVIEW",
            "Medical necessity requires review",
            r.hard ? "denied" : "pended",
            { mode: r.mode },
          );
          break;
        }
      }
      if (line.outcome === "denied" || line.outcome === "pended") continue;
      emit("R013", 3);
      const maxima = plan.benefitMaximums.filter((r) =>
        matches(r, l.serviceCode),
      );
      if (
        maxima.some(
          (r) =>
            ctx.dateOfLoss &&
            ((r.incurredWithinMonths &&
              date > addMonths(ctx.dateOfLoss, r.incurredWithinMonths)) ||
              (r.incurredWithinDays &&
                date > addDays(ctx.dateOfLoss, r.incurredWithinDays))),
        )
      ) {
        emit(
          "R017",
          3,
          "TIME_LIMIT_EXCEEDED",
          "Treatment incurred past the time limit",
        );
        continue;
      }
      line.allowedUnits = units;
      line.eligibleAmount =
        Math.min(l.amount, coverageRule.allowedAmount ?? l.amount) * units;
      line.deniedAmount = billed - line.eligibleAmount;
      if (line.deniedAmount > 0 && line.outcome === "payable")
        line.outcome = "partial";
      staged.push({
        patientId: ctx.patientId,
        planId,
        planVersion: plan.version,
        providerBillingNumber: ctx.providerBillingNumber,
        serviceCode: l.serviceCode,
        serviceDate: date,
        units: l.units,
        allowedUnits: units,
        amount: l.amount,
        planPays: 0,
        status: "submitted",
        dateOfLoss: ctx.dateOfLoss,
      });
      for (const h of history)
        if (
          h.claimId &&
          h.planId === planId &&
          h.serviceDate > date &&
          plan.frequency.some(
            (r) =>
              matches(r, h.serviceCode) &&
              matches(r, l.serviceCode) &&
              within(
                { ...h, serviceDate: date },
                h.serviceDate,
                r.period,
                r.rollingDays,
              ),
          )
        ) {
          if (!decision.flags.some((f) => f.claimId === h.claimId))
            decision.flags.push({
              claimId: h.claimId,
              flag: "REPROCESS_CANDIDATE",
            });
        }
    }
    // Monetary accumulators are consumed in caller line order; frequency reservations above use service-date order.
    const currentPaid: { date: string; code: string; paid: number }[] = [];
    for (let i = 0; i < ctx.lines.length; i++) {
      const l = ctx.lines[i]!,
        line = lineResults[i]!,
        plan = resolved[i],
        date = l.serviceDate ?? ctx.serviceDate;
      if (!plan || line.outcome === "denied" || line.outcome === "pended")
        continue;
      const acc = existing(plan, date);
      const money = costShare(line.eligibleAmount, plan, acc);
      let maxPayment = money.planPays;
      for (const r of plan.benefitMaximums.filter((r) =>
        matches(r, l.serviceCode),
      )) {
        const key = r.category ?? r.codes!.join(",");
        const priorPaid = history
          .filter(
            (h) =>
              h.planId === planId &&
              matches(r, h.serviceCode) &&
              !["rejected", "denied", "pended"].includes(h.status) &&
              within(h, date, r.period, r.rollingDays),
          )
          .reduce((s, h) => s + h.planPays, 0);
        const current = currentPaid
          .filter(
            (h) =>
              matches(r, h.code) &&
              h.date >=
                windowStart(date, r.period, ctx.dateOfLoss, r.rollingDays) &&
              h.date <= date,
          )
          .reduce((s, h) => s + h.paid, 0);
        const supplied =
          input.accumulators?.[accumulatorKey(plan, date, ctx.dateOfLoss)] ??
          input.accumulators?.[planId];
        maxPayment = Math.min(
          maxPayment,
          Math.max(
            0,
            r.amount - (supplied?.benefitUsed[key] ?? priorPaid) - current,
          ),
        );
      }
      const capped = maxPayment < money.planPays;
      if (capped) {
        line.reasons.push({
          code: "MAX_REACHED",
          message: "Benefit maximum reached",
        });
        line.deniedAmount += money.planPays - maxPayment;
        line.eligibleAmount -= money.planPays - maxPayment;
        line.outcome =
          maxPayment > 0 || money.memberPays > 0 ? "partial" : "denied";
      }
      record(
        "R017",
        3,
        capped,
        capped ? line.outcome : "pass",
        { normalBenefit: money.planPays, allowedBenefit: maxPayment },
        i + 1,
        planId,
      );
      maximumEligible[i] = Math.max(maximumEligible[i]!, line.eligibleAmount);
      line.planPays = Math.min(
        maxPayment,
        Math.max(0, maximumEligible[i]! - paidByLine[i]!),
      );
      line.memberPays = line.eligibleAmount - line.planPays;
      line.normalMemberPays = money.memberPays;
      line.deductibleApplied = money.deductibleApplied;
      line.coinsuranceAmount = money.coinsuranceAmount;
      // OOP is the normal plan's member cost share, excluding denied expense and another payer's contribution.
      acc.individualDeductibleMet += money.deductibleApplied;
      acc.familyDeductibleMet += money.deductibleApplied;
      acc.oopMet += money.memberPays;
      for (const r of plan.benefitMaximums.filter((r) =>
        matches(r, l.serviceCode),
      )) {
        const key = r.category ?? r.codes!.join(",");
        acc.benefitUsed[key] = (acc.benefitUsed[key] ?? 0) + line.planPays;
      }
      currentPaid.push({ date, code: l.serviceCode, paid: line.planPays });
      paidByLine[i]! += line.planPays;
      if (line.outcome === "denied") line.allowedUnits = 0;
      consumed.push({
        patientId: ctx.patientId,
        planId,
        planVersion: plan.version,
        providerBillingNumber: ctx.providerBillingNumber,
        serviceCode: l.serviceCode,
        serviceDate: date,
        units: l.units,
        allowedUnits: line.allowedUnits,
        amount: l.amount,
        planPays: line.planPays,
        memberPays: money.memberPays,
        deductibleApplied: money.deductibleApplied,
        status: "submitted",
        dateOfLoss: ctx.dateOfLoss,
      });
      record(
        "R011",
        3,
        false,
        "calculated",
        {
          eligible: line.eligibleAmount,
          deductibleApplied: line.deductibleApplied,
          coinsuranceAmount: line.coinsuranceAmount,
          planPays: line.planPays,
        },
        i + 1,
        planId,
      );
      record(
        "R014",
        3,
        false,
        "calculated",
        { paymentOrder: order.indexOf(planId) + 1, planPays: line.planPays },
        i + 1,
        planId,
      );
    }
    decision.payers.push({
      planId,
      lines: lineResults,
      planPaysTotal: lineResults.reduce((s, l) => s + l.planPays, 0),
    });
  }
  decision.lines = ctx.lines.map((l, i) => {
    const payerLines = decision.payers.map((p) => p.lines[i]!);
    const successes = payerLines.filter(
      (p) => p.outcome === "payable" || p.outcome === "partial",
    );
    const pending = payerLines.some((p) => p.outcome === "pended");
    const eligible = Math.max(0, ...payerLines.map((p) => p.eligibleAmount));
    const planPays = paidByLine[i]!;
    const billed = l.amount * l.units;
    const outcome =
      pending && planPays < billed
        ? "pended"
        : successes.length
          ? eligible < billed
            ? "partial"
            : "payable"
          : "denied";
    return {
      ...initialLine(i + 1, billed),
      outcome,
      eligibleAmount: eligible,
      planPays,
      memberPays: Math.max(0, eligible - planPays),
      deniedAmount: pending ? 0 : billed - eligible,
      deductibleApplied: payerLines[0]?.deductibleApplied ?? 0,
      coinsuranceAmount: payerLines[0]?.coinsuranceAmount ?? 0,
      allowedUnits: Math.max(0, ...payerLines.map((p) => p.allowedUnits)),
      reasons: (outcome === "payable" ? successes : payerLines).flatMap(
        (p) => p.reasons,
      ),
      reviewPrompts: [...new Set(payerLines.flatMap((p) => p.reviewPrompts))],
    };
  });
  decision.outcome = resultOutcome(decision.lines);
  decision.errors = decision.lines.flatMap((l) => l.reasons);
  decision.primaryReasonCode = decision.errors[0]?.code ?? null;
  decision.planPaysTotal = decision.lines.reduce((s, l) => s + l.planPays, 0);
  decision.memberPaysTotal = decision.lines.reduce(
    (s, l) => s + l.memberPays,
    0,
  );
  decision.suggestedStatus =
    decision.outcome === "DENY"
      ? "denied"
      : decision.outcome === "PEND"
        ? "pended"
        : "submitted";
  decision.reviewPrompts = [
    ...new Set(decision.lines.flatMap((l) => l.reviewPrompts)),
  ];
  return decision;
}
