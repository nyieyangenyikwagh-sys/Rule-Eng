import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ALLOWED_TRANSITIONS,
  AHSEngine,
  assertEligible,
  costShare,
  emptyAccumulator,
  evaluateClaim,
  runRules,
  mockPayer,
  transition,
  versionFor,
  cobOrder,
  edmontonDate,
  addDays,
  type ClaimStatus,
} from "../src/index.js";
import {
  makeClaim,
  input,
  coverage,
  prior,
  publicPlan,
  privatePlan,
  sectionB,
  careFirst,
  now,
  noLimits,
} from "./fixtures.js";

describe("Reference parity and validation (T-001–T-018)", () => {
  it("T-001 valid Alberta claim", () =>
    expect(runRules(makeClaim())).toEqual([]));
  it("T-002 invalid billing number", () =>
    expect(runRules(makeClaim({ providerBillingNumber: "ABC" }))[0]?.code).toBe(
      "R002",
    ));
  it("T-003 residency routing", () =>
    expect(runRules(makeClaim({ patientProvince: "ON" }))[0]?.code).toBe(
      "R010",
    ));
  it("T-004 unknown service", () =>
    expect(
      runRules(
        makeClaim({
          lines: [
            {
              serviceCode: "Z999",
              diagnosisCode: "J06.9",
              units: 1,
              amount: 8500,
            },
          ],
        }),
      )[0]?.code,
    ).toBe("R004"));
  it("T-005 Ontario-shaped PHN", () =>
    expect(
      runRules(makeClaim({ healthCardNumber: "1234567890AB" }))[0]?.code,
    ).toBe("R009"));
  it("T-006 verify, format, submit, paid", () => {
    assertEligible(coverage(), now);
    const ctx = makeClaim();
    expect(runRules(ctx)).toEqual([]);
    expect(new AHSEngine().formatSubmission(ctx)).toMatch(
      /^AHCIP\|123456\|2026-10-01/,
    );
    expect(
      transition("draft", "submitted", null, now.toISOString()).toStatus,
    ).toBe("submitted");
    expect(
      transition("submitted", "paid", null, now.toISOString()).toStatus,
    ).toBe("paid");
  });
  it("T-007 no lines", () =>
    expect(runRules(makeClaim({ lines: [] }))[0]?.code).toBe("R001"));
  it("T-008 missing billing number", () =>
    expect(runRules(makeClaim({ providerBillingNumber: "" }))[0]?.code).toBe(
      "R001",
    ));
  it.each([
    ["T-009", "12345"],
    ["T-010", "1234567"],
  ])("%s billing length", (_id, value) =>
    expect(runRules(makeClaim({ providerBillingNumber: value }))[0]?.code).toBe(
      "R002",
    ),
  );
  it("T-011 unknown diagnosis", () =>
    expect(
      runRules(
        makeClaim({
          lines: [
            {
              serviceCode: "03.03A",
              diagnosisCode: "UNKNOWN",
              units: 1,
              amount: 1,
            },
          ],
        }),
      )[0]?.code,
    ).toBe("R003"));
  it("T-012 Ontario code", () =>
    expect(
      runRules(
        makeClaim({
          lines: [
            {
              serviceCode: "A001",
              diagnosisCode: "J06.9",
              units: 1,
              amount: 1,
            },
          ],
        }),
      )[0]?.code,
    ).toBe("R004"));
  it("T-013 exactly 90 days", () =>
    expect(runRules(makeClaim({ serviceDate: "2026-07-15" }))).toEqual([]));
  it("T-014 91 days", () =>
    expect(runRules(makeClaim({ serviceDate: "2026-07-14" }))[0]?.code).toBe(
      "R005",
    ));
  it.each([
    ["T-015", "12345678"],
    ["T-016", "1234567890"],
    ["T-017", "123456789\n"],
  ])("%s PHN length", (_id, value) =>
    expect(runRules(makeClaim({ healthCardNumber: value }))[0]?.code).toBe(
      "R009",
    ),
  );
  it("T-018 fixed aggregate order", () =>
    expect(
      runRules(
        makeClaim({
          providerBillingNumber: "BAD",
          healthCardNumber: "BAD",
          patientProvince: "ON",
          lines: [
            { serviceCode: "BAD", diagnosisCode: "BAD", units: 1, amount: 1 },
          ],
        }),
      ).map((e) => e.code),
    ).toEqual(["R002", "R003", "R004", "R009", "R010"]));
});
describe("Eligibility and coverage", () => {
  it("T-019 no insurance", () =>
    expect(() => assertEligible(null, now)).toThrow("No verified coverage"));
  it("T-020 never verified", () =>
    expect(() =>
      assertEligible(coverage("AHCIP", { lastVerifiedAt: null }), now),
    ).toThrow("No verified coverage"));
  it("T-021 stale at 25 hours", () =>
    expect(() =>
      assertEligible(
        coverage("AHCIP", {
          lastVerifiedAt: new Date(+now - 25 * 3600000).toISOString(),
        }),
        now,
      ),
    ).toThrow("stale"));
  it("T-022 fresh at 23 hours", () =>
    expect(
      assertEligible(
        coverage("AHCIP", {
          lastVerifiedAt: new Date(+now - 23 * 3600000).toISOString(),
        }),
        now,
      ).eligible,
    ).toBe(true));
  it("T-023 terminated and out of network", () => {
    for (const [member, reason] of [
      ["TERM-9", "COVERAGE_TERMINATED"],
      ["OON-9", "OUT_OF_NETWORK"],
    ]) {
      const result = mockPayer(member!, publicPlan);
      expect(result.reasonCode).toBe(reason);
      expect(() =>
        assertEligible(coverage("AHCIP", { lastEligibility: result }), now),
      ).toThrow("not eligible");
    }
  });
  it("T-025 service outside coverage dates", () => {
    for (const cov of [
      coverage("AHCIP", { effectiveDate: "2026-10-02" }),
      coverage("AHCIP", { terminationDate: "2026-09-30" }),
    ])
      expect(
        evaluateClaim(input(publicPlan, {}, { coverage: [cov] }))
          .primaryReasonCode,
      ).toBe("COVERAGE_PERIOD");
  });
  it("T-026 unlisted benefit defaults to deny", () =>
    expect(
      evaluateClaim(input({ ...publicPlan, coverage: [] })).primaryReasonCode,
    ).toBe("NOT_A_BENEFIT"));
  it("T-027 private cannot pay insured public service", () =>
    expect(
      evaluateClaim(input(privatePlan, { lines: makeClaim().lines }))
        .primaryReasonCode,
    ).toBe("INSURED_BY_AHCIP"));
  it("T-028 missing authorization", () =>
    expect(
      evaluateClaim(
        input(privatePlan, {
          lines: [
            {
              serviceCode: "MRI",
              diagnosisCode: "M54.5",
              units: 1,
              amount: 10000,
            },
          ],
        }),
      ).primaryReasonCode,
    ).toBe("PRIOR_AUTH_REQUIRED"));
  it("T-029 requested authorization pends", () =>
    expect(
      evaluateClaim(
        input(privatePlan, {
          lines: [
            {
              serviceCode: "MRI",
              diagnosisCode: "M54.5",
              units: 1,
              amount: 10000,
              priorAuthStatus: "requested",
            },
          ],
        }),
      ).outcome,
    ).toBe("PEND"));
  it("T-030 auto missing date of loss", () =>
    expect(evaluateClaim(input(sectionB)).primaryReasonCode).toBe(
      "DATE_OF_LOSS_REQUIRED",
    ));
  it("T-031 treatment before accident", () =>
    expect(
      evaluateClaim(input(sectionB, { dateOfLoss: "2026-10-02" }))
        .primaryReasonCode,
    ).toBe("SERVICE_BEFORE_LOSS"));
  it("T-032 treatment after 24 months", () =>
    expect(
      evaluateClaim(
        input(
          { ...sectionB, medicalNecessity: [] },
          { dateOfLoss: "2024-09-30" },
        ),
      ).primaryReasonCode,
    ).toBe("TIME_LIMIT_EXCEEDED"));
});
describe("Cost sharing", () => {
  it("T-033 deductible swallows $85", () =>
    expect(
      costShare(8500, privatePlan, {
        ...emptyAccumulator(),
        individualDeductibleMet: 12000,
      }),
    ).toMatchObject({ planPays: 0, memberPays: 8500 }));
  it("T-034 $600 leaves $176 plan / $424 member", () =>
    expect(
      costShare(60000, privatePlan, {
        ...emptyAccumulator(),
        individualDeductibleMet: 12000,
      }),
    ).toMatchObject({ planPays: 17600, memberPays: 42400 }));
  it("T-035 OOP remaining $50", () =>
    expect(
      costShare(100000, privatePlan, {
        ...emptyAccumulator(),
        individualDeductibleMet: 50000,
        oopMet: 295000,
      }),
    ).toMatchObject({ planPays: 95000, memberPays: 5000 }));
  it("T-036 public first dollar", () =>
    expect(costShare(8500, publicPlan, emptyAccumulator()).planPays).toBe(
      8500,
    ));
  it("T-037 family deductible satisfied", () =>
    expect(
      costShare(10000, privatePlan, {
        ...emptyAccumulator(),
        familyDeductibleMet: 150000,
      }).deductibleApplied,
    ).toBe(0));
  it("T-038 two lines consume deductible in line order", () => {
    const d = evaluateClaim(
      input(noLimits(), {
        lines: [
          {
            serviceCode: "PHYSIO-INIT",
            diagnosisCode: "M54.5",
            units: 1,
            amount: 40000,
          },
          {
            serviceCode: "PHYSIO-FU",
            diagnosisCode: "M54.5",
            units: 1,
            amount: 40000,
          },
        ],
      }),
    );
    expect(d.lines.map((l) => l.deductibleApplied)).toEqual([40000, 10000]);
    expect(d.planPaysTotal).toBe(24000);
  });
  it("T-039 odd cents half up", () => {
    const r = costShare(
      103,
      { ...privatePlan, deductible: null },
      emptyAccumulator(),
    );
    expect(r.coinsuranceAmount).toBe(21);
    expect(r.planPays + r.memberPays).toBe(103);
  });
  it("T-040 random money conservation", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000000 }),
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 500000 }),
        fc.integer({ min: 0, max: 400000 }),
        (eligible, basis, met, oop) => {
          const r = costShare(
            eligible,
            { ...privatePlan, coinsurance: basis / 10000 },
            {
              ...emptyAccumulator(),
              individualDeductibleMet: met,
              oopMet: oop,
            },
          );
          expect(r.planPays + r.memberPays).toBe(eligible);
          expect(r.planPays).toBeGreaterThanOrEqual(0);
          expect(r.memberPays).toBeGreaterThanOrEqual(0);
          expect(r.planPays).toBeLessThanOrEqual(eligible);
        },
      ),
      { numRuns: 1000 },
    ));
  it("T-041 amount equals remaining deductible", () =>
    expect(
      costShare(38000, privatePlan, {
        ...emptyAccumulator(),
        individualDeductibleMet: 12000,
      }),
    ).toMatchObject({
      deductibleApplied: 38000,
      coinsuranceAmount: 0,
      planPays: 0,
    }));
});
describe("Frequency and duplicates", () => {
  const p = { ...privatePlan, deductible: null, benefitMaximums: [] };
  it("T-042 exactly at visit limit", () =>
    expect(
      evaluateClaim(
        input(p, {}, { history: [prior({ units: 19, allowedUnits: 19 })] }),
      ).outcome,
    ).toBe("ACCEPT"));
  it("T-043 partial units", () => {
    const d = evaluateClaim(
      input(
        p,
        {
          lines: [
            {
              serviceCode: "PHYSIO-INIT",
              diagnosisCode: "M54.5",
              units: 2,
              amount: 10000,
            },
          ],
        },
        { history: [prior({ units: 19, allowedUnits: 19 })] },
      ),
    );
    expect(d.outcome).toBe("PARTIAL");
    expect(d.lines[0]?.allowedUnits).toBe(1);
    expect(d.planPaysTotal).toBe(8000);
  });
  it("T-044 no units left", () =>
    expect(
      evaluateClaim(
        input(p, {}, { history: [prior({ units: 20, allowedUnits: 20 })] }),
      ).outcome,
    ).toBe("DENY"));
  it("T-045 January resets frequency", () =>
    expect(
      evaluateClaim(
        input(
          p,
          {
            serviceDate: "2027-01-01",
            receivedDate: "2027-01-01",
            today: "2027-01-01",
          },
          {
            history: [
              prior({ serviceDate: "2026-12-31", units: 20, allowedUnits: 20 }),
            ],
          },
        ),
      ).outcome,
    ).toBe("ACCEPT"));
  it("T-046 rolling oldest falls out", () =>
    expect(
      evaluateClaim(
        input(
          {
            ...p,
            frequency: [
              {
                category: "physio",
                maxUnits: 1,
                period: "rolling_days",
                rollingDays: 30,
              },
            ],
          },
          {},
          { history: [prior({ serviceDate: "2026-09-01" })] },
        ),
      ).outcome,
    ).toBe("ACCEPT"));
  it("T-047 late earlier visit keeps place, later claim flagged", () => {
    const d = evaluateClaim(
      input(
        {
          ...p,
          frequency: [
            { category: "physio", maxUnits: 1, period: "calendar_year" },
          ],
        },
        {},
        { history: [prior({ serviceDate: "2026-10-02" })] },
      ),
    );
    expect(d.outcome).toBe("ACCEPT");
    expect(d.flags).toEqual([{ claimId: "99", flag: "REPROCESS_CANDIDATE" }]);
  });
  it("T-048 duplicate exact service", () =>
    expect(
      evaluateClaim(
        input(
          p,
          {},
          {
            history: [
              prior({
                providerBillingNumber: "123456",
                serviceCode: "PHYSIO-INIT",
                serviceDate: "2026-10-01",
              }),
            ],
          },
        ),
      ).primaryReasonCode,
    ).toBe("DUPLICATE_CLAIM"));
});
describe("Necessity", () => {
  const mapped = {
    ...noLimits(),
    medicalNecessity: [
      {
        mode: "diagnosis_service_map" as const,
        category: "physio",
        allowedDiagnoses: ["M54.5"],
        hard: false,
      },
    ],
  };
  it("T-049 matching diagnosis", () =>
    expect(evaluateClaim(input(mapped)).outcome).toBe("ACCEPT"));
  it("T-050 soft mismatch pends with prompts", () => {
    const d = evaluateClaim(
      input(mapped, {
        lines: [
          {
            serviceCode: "PHYSIO-INIT",
            diagnosisCode: "J06.9",
            units: 1,
            amount: 10000,
          },
        ],
      }),
    );
    expect(d.outcome).toBe("PEND");
    expect(d.reviewPrompts.length).toBeGreaterThan(0);
  });
  it("T-051 hard mismatch denies", () =>
    expect(
      evaluateClaim(
        input(
          {
            ...mapped,
            medicalNecessity: mapped.medicalNecessity.map((r) => ({
              ...r,
              hard: true,
            })),
          },
          {
            lines: [
              {
                serviceCode: "PHYSIO-INIT",
                diagnosisCode: "J06.9",
                units: 1,
                amount: 10000,
              },
            ],
          },
        ),
      ).primaryReasonCode,
    ).toBe("NECESSITY_MISMATCH"));
  it("T-052 unknown injury classification", () =>
    expect(
      evaluateClaim(
        input(sectionB, {
          dateOfLoss: "2026-09-28",
          injuryClassification: "unknown",
        }),
      ).outcome,
    ).toBe("PEND"));
  const care = (receivedDate: string) =>
    input(careFirst, {
      dateOfLoss: "2027-01-01",
      serviceDate: "2027-01-02",
      receivedDate,
      today: receivedDate,
      lines: [
        {
          serviceCode: "PHYSIO-INIT",
          diagnosisCode: "S13.4",
          units: 1,
          amount: 10000,
          programOfCare: "DEMO-MSK",
        },
      ],
    });
  it("T-053 Care-First day 84 preapproved", () =>
    expect(evaluateClaim(care(addDays("2027-01-01", 84))).outcome).toBe(
      "ACCEPT",
    ));
  it("T-054 Care-First day 85 pends", () =>
    expect(evaluateClaim(care(addDays("2027-01-01", 85))).outcome).toBe(
      "PEND",
    ));
});
describe("Coordination", () => {
  const p1 = { ...noLimits(), planId: "ONE" },
    p2 = { ...noLimits(), planId: "TWO" };
  const ctx = makeClaim({ planIds: ["ONE", "TWO"] });
  it("T-055 own before dependent", () =>
    expect(
      cobOrder(
        ctx,
        [p1, p2],
        [
          coverage("ONE", { relationship: "spouse" }),
          coverage("TWO", { relationship: "self" }),
        ],
      ),
    ).toEqual(["TWO", "ONE"]));
  it("T-056 earlier parent birthday", () =>
    expect(
      cobOrder(
        ctx,
        [p1, p2],
        [
          coverage("ONE", {
            relationship: "child",
            subscriberBirthday: "1980-09-01",
          }),
          coverage("TWO", {
            relationship: "child",
            subscriberBirthday: "1982-03-01",
          }),
        ],
      ),
    ).toEqual(["TWO", "ONE"]));
  it("T-057 birthday tie, longer held", () =>
    expect(
      cobOrder(
        ctx,
        [p1, p2],
        [
          coverage("ONE", {
            relationship: "child",
            subscriberBirthday: "1980-03-01",
            effectiveDate: "2020-01-01",
          }),
          coverage("TWO", {
            relationship: "child",
            subscriberBirthday: "1982-03-01",
            effectiveDate: "2019-01-01",
          }),
        ],
      ),
    ).toEqual(["TWO", "ONE"]));
  it("T-058 auto before private", () =>
    expect(
      cobOrder(
        makeClaim({
          dateOfLoss: "2026-01-01",
          planIds: ["GREENSHIELD", "AB_AUTO"],
        }),
        [privatePlan, sectionB],
        [coverage("GREENSHIELD"), coverage("AB_AUTO")],
      ),
    ).toEqual(["AB_AUTO", "GREENSHIELD"]));
  it("T-059 secondary never exceeds remainder", () => {
    const d = evaluateClaim(
      input(
        p1,
        { planIds: ["ONE", "TWO"] },
        {
          plans: [p1, p2],
          coverage: [
            coverage("ONE"),
            coverage("TWO", { relationship: "spouse" }),
          ],
          accumulators: {
            ONE: { ...emptyAccumulator(), individualDeductibleMet: 12000 },
            TWO: { ...emptyAccumulator(), individualDeductibleMet: 50000 },
          },
        },
      ),
    );
    expect(d.payers.map((p) => p.planPaysTotal)).toEqual([17600, 42400]);
    expect(d.planPaysTotal).toBe(60000);
    expect(d.memberPaysTotal).toBe(0);
  });
  it("T-060 unknown payer order", () =>
    expect(
      evaluateClaim(
        input(
          p1,
          { planIds: ["ONE", "TWO"] },
          { plans: [p1, p2], coverage: [coverage("ONE"), coverage("TWO")] },
        ),
      ).primaryReasonCode,
    ).toBe("COB_ORDER_UNDETERMINED"));
});
describe("Regimes and plan changes", () => {
  it("T-061 Dec 31 loss is Section B", () =>
    expect(
      versionFor([sectionB, careFirst], "AB_AUTO", "2026-12-31")?.version,
    ).toBe(1));
  it("T-062 Jan 1 loss is Care-First", () =>
    expect(
      versionFor([sectionB, careFirst], "AB_AUTO", "2027-01-01")?.version,
    ).toBe(2));
  it("T-063 2027 service of 2026 loss remains Section B", () => {
    const d = evaluateClaim(
      input(
        sectionB,
        {
          dateOfLoss: "2026-12-28",
          serviceDate: "2027-01-05",
          receivedDate: "2027-01-05",
          today: "2027-01-05",
          injuryClassification: "minor",
        },
        { plans: [sectionB, careFirst] },
      ),
    );
    expect(d.planVersionsUsed).toEqual([{ planId: "AB_AUTO", version: 1 }]);
    expect(d.outcome).toBe("ACCEPT");
  });
  it("T-064 mixed dates use a single auto regime", () => {
    const d = evaluateClaim(
      input(
        sectionB,
        {
          dateOfLoss: "2026-12-28",
          serviceDate: "2026-12-30",
          receivedDate: "2027-01-05",
          today: "2027-01-05",
          injuryClassification: "minor",
          lines: [
            {
              serviceCode: "PHYSIO-INIT",
              diagnosisCode: "S13.4",
              units: 1,
              amount: 10000,
              serviceDate: "2026-12-30",
            },
            {
              serviceCode: "PHYSIO-FU",
              diagnosisCode: "S13.4",
              units: 1,
              amount: 10000,
              serviceDate: "2027-01-05",
            },
          ],
        },
        { plans: [sectionB, careFirst] },
      ),
    );
    expect(d.planVersionsUsed).toEqual([{ planId: "AB_AUTO", version: 1 }]);
    expect(d.lines).toHaveLength(2);
  });
  it("T-065 missing classification", () =>
    expect(
      evaluateClaim(input(sectionB, { dateOfLoss: "2026-09-28" }))
        .primaryReasonCode,
    ).toBe("NECESSITY_REVIEW"));
  it("T-066 cap reached mid-claim", () => {
    const d = evaluateClaim(
      input(
        sectionB,
        {
          dateOfLoss: "2026-09-28",
          injuryClassification: "minor",
          lines: [
            {
              serviceCode: "PHYSIO-INIT",
              diagnosisCode: "S13.4",
              units: 1,
              amount: 140000,
            },
          ],
        },
        {
          accumulators: {
            AB_AUTO: {
              ...emptyAccumulator(),
              benefitUsed: { medical_rehab: 4890000 },
            },
          },
        },
      ),
    );
    expect(d.outcome).toBe("PARTIAL");
    expect(d.planPaysTotal).toBe(110000);
    expect(d.lines[0]?.deniedAmount).toBe(30000);
  });
  it("T-067 July version boundary per line", () => {
    const p1 = { ...noLimits(), effectiveTo: "2026-06-30" },
      p2 = { ...noLimits(), version: 2, effectiveFrom: "2026-07-01" };
    const d = evaluateClaim(
      input(
        p1,
        {
          serviceDate: "2026-06-30",
          receivedDate: "2026-07-02",
          lines: [
            {
              serviceCode: "PHYSIO-INIT",
              diagnosisCode: "M54.5",
              units: 1,
              amount: 10000,
              serviceDate: "2026-06-30",
            },
            {
              serviceCode: "PHYSIO-FU",
              diagnosisCode: "M54.5",
              units: 1,
              amount: 10000,
              serviceDate: "2026-07-01",
            },
          ],
        },
        { plans: [p1, p2] },
      ),
    );
    expect(d.planVersionsUsed.map((p) => p.version)).toEqual([1, 2]);
  });
  it("T-068 carryover on vs off", () => {
    for (const carry of [true, false]) {
      const p = {
        ...noLimits(),
        version: 2,
        effectiveFrom: "2026-07-01",
        accumulatorCarryover: carry,
      };
      const d = evaluateClaim(
        input(
          p,
          {},
          {
            history: [
              prior({
                planVersion: 1,
                serviceDate: "2026-06-01",
                deductibleApplied: 40000,
                memberPays: 40000,
              }),
            ],
          },
        ),
      );
      expect(d.lines[0]?.deductibleApplied).toBe(carry ? 10000 : 50000);
    }
  });
  it("T-071 Edmonton date near midnight", () =>
    expect(edmontonDate(new Date("2026-10-14T05:30:00Z"))).toBe("2026-10-13"));
});
describe("Status transitions", () => {
  it("T-073 every legal transition produces a history record", () => {
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS))
      for (const to of tos)
        expect(
          transition(from as ClaimStatus, to, "REASON", now.toISOString()),
        ).toEqual({
          fromStatus: from,
          toStatus: to,
          reasonCode: "REASON",
          createdAt: now.toISOString(),
        });
  });
  it("T-074 illegal transitions fail", () => {
    expect(() =>
      transition("paid", "submitted", null, now.toISOString()),
    ).toThrow("Illegal transition");
    expect(() => transition("draft", "paid", null, now.toISOString())).toThrow(
      "Illegal transition",
    );
  });
  it("T-075 rejected may resubmit", () =>
    expect(
      transition("rejected", "submitted", null, now.toISOString()).toStatus,
    ).toBe("submitted"));
  it("T-076 rejection stores reason", () =>
    expect(
      transition("submitted", "rejected", "R002", now.toISOString()).reasonCode,
    ).toBe("R002"));
  it("T-077 closed and paid terminal", () => {
    expect(ALLOWED_TRANSITIONS.closed.size).toBe(0);
    expect(ALLOWED_TRANSITIONS.paid.size).toBe(0);
  });
});
