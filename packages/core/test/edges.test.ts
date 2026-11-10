import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonths,
  categories,
  cobOrder,
  emptyAccumulator,
  evaluateClaim,
  getEngine,
  GreenShieldEngine,
  AHSEngine,
  isoDateSchema,
  mockPayer,
  planDefinitionSchema,
  registerEngine,
  runRules,
  versionFor,
  windowStart,
  assertEligible,
} from "../src/index.js";
import {
  input,
  makeClaim,
  coverage,
  prior,
  noLimits,
  publicPlan,
  privatePlan,
  sectionB,
  careFirst,
  now,
} from "./fixtures.js";
describe("Additional boundary and failure-path coverage", () => {
  it("calendar arithmetic clamps leap days and month ends", () => {
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(windowStart("2026-10-01", "rolling_12m")).toBe("2025-10-02");
    expect(windowStart("2026-10-01", "per_accident")).toBe("2026-10-01");
    expect(windowStart("2026-10-01", "rolling_days")).toBe("2025-10-02");
  });
  it("invalid calendar dates and plan configurations fail closed", () => {
    expect(isoDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(isoDateSchema.safeParse("9999-99-99").success).toBe(false);
    for (const p of [
      { ...privatePlan, coverage: [{ covered: true }] },
      {
        ...privatePlan,
        frequency: [
          { category: "physio", maxUnits: 2, period: "rolling_days" },
        ],
      },
      {
        ...privatePlan,
        benefitMaximums: [
          { category: "physio", amount: 2, period: "rolling_days" },
        ],
      },
      { ...privatePlan, medicalNecessity: [{ mode: "diagnosis_service_map" }] },
      { ...privatePlan, medicalNecessity: [{ mode: "program_of_care" }] },
      { ...publicPlan, coinsurance: 0.2 },
      { ...privatePlan, effectiveTo: "2020-01-01" },
    ])
      expect(planDefinitionSchema.safeParse(p).success).toBe(false);
    expect(
      planDefinitionSchema.parse({
        ...privatePlan,
        benefitMaximums: [
          {
            category: "physio",
            amount: 1000,
            period: "rolling_days",
            rollingDays: 30,
          },
        ],
      }).benefitMaximums[0]?.rollingDays,
    ).toBe(30);
  });
  it("category data includes drugs, assessment and other paramedical services", () => {
    expect(categories("CHIRO")).toContain("paramedical");
    expect(categories("MASSAGE")).toContain("medical_rehab");
    expect(categories("ASSESSMENT")).toEqual(["medical_rehab"]);
    expect(categories("DRUG")).toEqual(["drug"]);
  });
  it("provincial registry can be extended and private card strategy accepts member IDs", () => {
    expect(new GreenShieldEngine().verifyEligibilityFormat(null)).toBe(true);
    expect(new AHSEngine().verifyEligibilityFormat(null)).toBe(false);
    expect(new AHSEngine().verifyEligibilityFormat("123456789")).toBe(true);
    expect(new AHSEngine().verifyEligibilityFormat("123456789\n")).toBe(false);
    registerEngine("DEMO", new GreenShieldEngine());
    expect(getEngine("DEMO").formatSubmission(makeClaim())).toMatch(
      /^GREENSHIELD/,
    );
    expect(() => getEngine("XX")).toThrow("No billing engine for XX");
  });
  it("mock payer covers PEND and INACT and carries exact private display values", () => {
    expect(mockPayer("PEND-1", privatePlan).reasonCode).toBe(
      "COVERAGE_PENDING",
    );
    expect(mockPayer("INACT-1", privatePlan).reasonCode).toBe("INACTIVE_PLAN");
    expect(mockPayer("OK", privatePlan).deductible).toEqual({
      individual: 500,
      family: 1500,
      met: 120,
    });
  });
  it("invalid and future verification timestamps are stale, exact 24h boundary passes", () => {
    for (const timestamp of ["invalid", new Date(+now + 1).toISOString()])
      expect(() =>
        assertEligible(coverage("AHCIP", { lastVerifiedAt: timestamp }), now),
      ).toThrow("stale");
    expect(
      assertEligible(
        coverage("AHCIP", {
          lastVerifiedAt: new Date(+now - 86400000).toISOString(),
        }),
        now,
      ).eligible,
    ).toBe(true);
  });
  it("reference-only rules preserve unknown-config behavior, orchestration fails closed", () => {
    expect(
      runRules(makeClaim({ province: "XX", patientProvince: "XX" })).map(
        (e) => e.code,
      ),
    ).toEqual(["R004"]);
    expect(() => evaluateClaim(input(publicPlan, { province: "XX" }))).toThrow(
      "No billing engine",
    );
    expect(
      runRules(
        makeClaim({
          province: "ON",
          patientProvince: "ON",
          healthCardNumber: "1234567890AB",
        }),
      ).map((e) => e.code),
    ).toEqual(["R004"]);
  });
  it("invalid private and auto service codes still reject", () => {
    for (const plan of [privatePlan, sectionB])
      expect(
        evaluateClaim(
          input(plan, {
            dateOfLoss: "2026-09-01",
            lines: [
              {
                serviceCode: "Z999",
                diagnosisCode: "M54.5",
                units: 1,
                amount: 1,
              },
            ],
          }),
        ).primaryReasonCode,
      ).toBe("R004");
  });
  it("unknown and ambiguous plan versions pend", () => {
    const expired = { ...publicPlan, effectiveTo: "2025-12-31" };
    expect(evaluateClaim(input(expired)).primaryReasonCode).toBe(
      "PLAN_VERSION_UNKNOWN",
    );
    expect(
      versionFor([publicPlan, publicPlan], "AHCIP", "2026-01-01"),
    ).toBeNull();
    expect(
      evaluateClaim(input(publicPlan, {}, { coverage: [] })).primaryReasonCode,
    ).toBe("COVERAGE_PERIOD");
  });
  it("retroactive filing uses notice date only when configured and supplied", () => {
    const p = {
      ...publicPlan,
      retroFilingClock: "eligibility_notice_date" as const,
    };
    const ctx = { serviceDate: "2026-01-01" };
    expect(
      evaluateClaim(
        input(p, ctx, {
          coverage: [
            coverage("AHCIP", { eligibilityNoticeDate: "2026-10-01" }),
          ],
        }),
      ).outcome,
    ).toBe("ACCEPT");
    expect(evaluateClaim(input(p, ctx)).outcome).toBe("REJECT");
  });
  it("missing required history is a review, never an optimistic payment", () =>
    expect(
      evaluateClaim(input(privatePlan, {}, { history: null }))
        .primaryReasonCode,
    ).toBe("HISTORY_UNAVAILABLE"));
  it("authorization number permits treatment; denial or requested status cannot bypass it", () => {
    const line = {
      serviceCode: "MRI",
      diagnosisCode: "M54.5",
      units: 1,
      amount: 10000,
      priorAuthNumber: "APPROVAL-1",
    };
    expect(evaluateClaim(input(privatePlan, { lines: [line] })).outcome).toBe(
      "ACCEPT",
    );
    expect(
      evaluateClaim(
        input(privatePlan, { lines: [{ ...line, priorAuthStatus: "denied" }] }),
      ).outcome,
    ).toBe("DENY");
    expect(
      evaluateClaim(
        input(privatePlan, {
          lines: [{ ...line, priorAuthStatus: "requested" }],
        }),
      ).outcome,
    ).toBe("PEND");
  });
  it("frequency intervals are enforced, rejected services do not consume visits", () => {
    const p = {
      ...noLimits(),
      frequency: [
        {
          category: "physio",
          maxUnits: 20,
          period: "calendar_year" as const,
          minDaysBetween: 7,
        },
      ],
    };
    expect(
      evaluateClaim(
        input(p, {}, { history: [prior({ serviceDate: "2026-09-30" })] }),
      ).primaryReasonCode,
    ).toBe("FREQUENCY_INTERVAL");
    expect(
      evaluateClaim(
        input(
          p,
          {},
          {
            history: [prior({ serviceDate: "2026-09-30", status: "rejected" })],
          },
        ),
      ).outcome,
    ).toBe("ACCEPT");
  });
  it("in-claim frequency reservations follow service date while response preserves order", () => {
    const p = {
      ...noLimits(),
      frequency: [
        { category: "physio", maxUnits: 1, period: "calendar_year" as const },
      ],
    };
    const d = evaluateClaim(
      input(p, {
        lines: [
          {
            serviceCode: "PHYSIO-FU",
            diagnosisCode: "M54.5",
            units: 1,
            amount: 10000,
            serviceDate: "2026-10-02",
          },
          {
            serviceCode: "PHYSIO-INIT",
            diagnosisCode: "M54.5",
            units: 1,
            amount: 10000,
            serviceDate: "2026-10-01",
          },
        ],
      }),
    );
    expect(d.lines.map((l) => l.outcome)).toEqual(["denied", "payable"]);
  });
  it("allowed amount caps eligible expense", () => {
    const p = {
      ...publicPlan,
      coverage: [{ codes: ["03.03A"], covered: true, allowedAmount: 5000 }],
    };
    const d = evaluateClaim(input(p));
    expect(d.outcome).toBe("PARTIAL");
    expect(d.planPaysTotal).toBe(5000);
    expect(d.lines[0]?.deniedAmount).toBe(3500);
  });
  it("remaining maximum is consumed across lines and exhausted benefit denies", () => {
    const p = {
      ...noLimits(),
      deductible: null,
      coinsurance: 0,
      benefitMaximums: [
        {
          codes: ["PHYSIO-INIT", "PHYSIO-FU"],
          amount: 10000,
          period: "calendar_year" as const,
        },
      ],
    };
    const d = evaluateClaim(
      input(p, {
        lines: [
          {
            serviceCode: "PHYSIO-INIT",
            diagnosisCode: "M54.5",
            units: 1,
            amount: 15000,
          },
          {
            serviceCode: "PHYSIO-FU",
            diagnosisCode: "M54.5",
            units: 1,
            amount: 15000,
          },
        ],
      }),
    );
    expect(d.planPaysTotal).toBe(10000);
    expect(d.lines.map((l) => l.outcome)).toEqual(["partial", "denied"]);
  });
  it("prior maximum use is scoped to the selected benefit window and accident", () => {
    const p = {
      ...sectionB,
      medicalNecessity: [],
      benefitMaximums: [
        {
          category: "medical_rehab",
          amount: 10000,
          period: "per_accident" as const,
        },
      ],
    };
    const d = evaluateClaim(
      input(
        p,
        { dateOfLoss: "2026-09-01" },
        {
          history: [
            prior({
              planId: "AB_AUTO",
              dateOfLoss: "2026-09-01",
              planPays: 10000,
            }),
          ],
        },
      ),
    );
    expect(d.planPaysTotal).toBe(0);
    expect(d.outcome).toBe("DENY");
    const other = evaluateClaim(
      input(
        p,
        { dateOfLoss: "2026-09-01" },
        {
          history: [
            prior({
              planId: "AB_AUTO",
              dateOfLoss: "2026-01-01",
              planPays: 10000,
            }),
          ],
        },
      ),
    );
    expect(other.planPaysTotal).toBe(10000);
  });
  it("legacy day time limit is supported and boundary is inclusive", () => {
    const p = {
      ...sectionB,
      medicalNecessity: [],
      benefitMaximums: [
        {
          category: "medical_rehab",
          amount: 100000,
          period: "per_accident" as const,
          incurredWithinDays: 30,
        },
      ],
    };
    expect(evaluateClaim(input(p, { dateOfLoss: "2026-09-01" })).outcome).toBe(
      "ACCEPT",
    );
    expect(
      evaluateClaim(input(p, { dateOfLoss: "2026-08-31" })).primaryReasonCode,
    ).toBe("TIME_LIMIT_EXCEEDED");
  });
  it("nonmatching necessity selector is skipped; unknown programs and protocol excess pend", () => {
    const mapped = {
      ...noLimits(),
      medicalNecessity: [
        {
          mode: "diagnosis_service_map" as const,
          codes: ["MRI"],
          allowedDiagnoses: ["J06.9"],
          hard: false,
        },
      ],
    };
    expect(evaluateClaim(input(mapped)).outcome).toBe("ACCEPT");
    expect(
      evaluateClaim(
        input(sectionB, {
          dateOfLoss: "2026-09-01",
          injuryClassification: "non_minor",
        }),
      ).outcome,
    ).toBe("PEND");
    expect(
      evaluateClaim(
        input(
          sectionB,
          { dateOfLoss: "2026-09-01", injuryClassification: "minor" },
          {
            history: [
              prior({
                planId: "AB_AUTO",
                dateOfLoss: "2026-09-01",
                allowedUnits: 21,
                units: 21,
              }),
            ],
          },
        ),
      ).outcome,
    ).toBe("PEND");
    expect(
      evaluateClaim(
        input(careFirst, {
          dateOfLoss: "2027-01-01",
          serviceDate: "2027-01-02",
          receivedDate: "2027-01-02",
          today: "2027-01-02",
        }),
      ).outcome,
    ).toBe("PEND");
  });
  it("COB handles primary pending, public priority, secondary-only and missing metadata", () => {
    const a = { ...noLimits(), planId: "A" },
      b = { ...noLimits(), planId: "B" };
    const c = makeClaim({ planIds: ["A", "B"] });
    expect(cobOrder(c, [a, b], [coverage("A")])).toBeNull();
    expect(cobOrder(c, [a], [coverage("A"), coverage("B")])).toBeNull();
    expect(
      cobOrder(
        c,
        [{ ...a, cob: { role: "secondary_only", order: ["own"] } }, b],
        [coverage("A"), coverage("B")],
      ),
    ).toEqual(["B", "A"]);
    expect(
      cobOrder(
        c,
        [a, { ...b, cob: { role: "secondary_only", order: ["own"] } }],
        [coverage("A"), coverage("B")],
      ),
    ).toEqual(["A", "B"]);
    expect(
      cobOrder(
        makeClaim({ planIds: ["GREENSHIELD", "AHCIP"] }),
        [privatePlan, publicPlan],
        [coverage("GREENSHIELD"), coverage("AHCIP")],
      ),
    ).toEqual(["AHCIP", "GREENSHIELD"]);
    expect(
      cobOrder(
        makeClaim({ planIds: ["AHCIP", "GREENSHIELD"] }),
        [publicPlan, privatePlan],
        [coverage("GREENSHIELD"), coverage("AHCIP")],
      ),
    ).toEqual(["AHCIP", "GREENSHIELD"]);
    expect(
      evaluateClaim(
        input(a, {}, { coverage: [coverage("A", { primaryPending: true })] }),
      ).primaryReasonCode,
    ).toBe("COB_PRIMARY_PENDING");
  });
  it("birthday ties without distinct effective dates require review", () => {
    const a = { ...noLimits(), planId: "A", cob: undefined },
      b = { ...noLimits(), planId: "B" };
    expect(
      cobOrder(
        makeClaim({ planIds: ["A", "B"] }),
        [a, b],
        [
          coverage("A", {
            relationship: "child",
            subscriberBirthday: "1980-01-01",
          }),
          coverage("B", {
            relationship: "child",
            subscriberBirthday: "1981-01-01",
          }),
        ],
      ),
    ).toBeNull();
  });
  it("evaluation is deterministic and never mutates inputs", () => {
    const request = input(
      privatePlan,
      {},
      {
        accumulators: {
          GREENSHIELD: {
            ...emptyAccumulator(),
            individualDeductibleMet: 12000,
          },
        },
      },
    );
    const original = structuredClone(request);
    const first = evaluateClaim(request);
    expect(evaluateClaim(request)).toEqual(first);
    expect(request).toEqual(original);
  });
  it("rolling deductible is shared across distinct service dates", () => {
    const plan = { ...noLimits(), benefitPeriod: "rolling_12m" as const };
    const d = evaluateClaim(
      input(plan, {
        lines: [
          {
            serviceCode: "PHYSIO-INIT",
            diagnosisCode: "M54.5",
            units: 1,
            amount: 40000,
            serviceDate: "2026-10-01",
          },
          {
            serviceCode: "PHYSIO-FU",
            diagnosisCode: "M54.5",
            units: 1,
            amount: 40000,
            serviceDate: "2026-10-02",
          },
        ],
      }),
    );
    expect(d.lines.map((l) => l.deductibleApplied)).toEqual([40000, 10000]);
  });
  it("historical benefit usage remains in the accumulator projection", () => {
    const d = evaluateClaim(
      input(
        { ...privatePlan, deductible: null },
        {},
        { history: [prior({ planPays: 8000 })] },
      ),
    );
    expect(
      Object.values(d.accumulatorUpdates)[0]?.benefitUsed.paramedical,
    ).toBe(56000);
  });
});
