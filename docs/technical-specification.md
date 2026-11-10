# Alberta Insurance Rules Engine — Technical Documentation

*Project 3 · TypeScript · Alberta health and bodily-injury claim adjudication · Delivered as an API · v1.0 design and build guide*

> **How to read this document.** It is both a specification and a build guide. Everything tagged **\[Ref\]** comes straight from the attached AHS reference (the FastAPI "Canadian Health Claims Platform — Alberta / AHS Edition") and is re-implemented in TypeScript without changing behaviour. Everything tagged **\[Ext\]** is an extension the reference does not contain: deductibles, frequency limits, medical necessity, COB, bodily injury, plan versioning. Extensions are designed to slot into the reference's structure, never to replace it.

## Document control

| Field | Value |
| --- | --- |
| Document ID | AB-RULES-DOC-001 |
| Title | Alberta Insurance Rules Engine — Technical Documentation |
| Version | 1.1 |
| Status | Draft for review |
| Classification | Internal — design and build documentation (synthetic data only) |
| Last updated | 2026-10-13 |
| Document owner | Project owner |
| Review cycle | At every minor engine release, and whenever Alberta Health, a plan, or the Care-First regulations change |
| Companion source | AHS reference guide (FastAPI, Alberta edition), cited throughout as **\[Ref\]** |

### Revision history

| Version | Date | Change | Sections |
| --- | --- | --- | --- |
| 1.1 | 2026-10-13 | Added document control, executive summary, numbered requirements, use cases, rule specification cards, reason-code catalogue, API field reference, data dictionary, sequence flows, ADRs, non-functional specification, operations runbook, governance, risk register, traceability matrix, 85-case test catalogue, worked examples | Front matter, 19–33, Appendices C–D |
| 1.0 | 2026-10-13 | Initial design and build guide | 1–18, Appendices A–B |

## Executive summary

This project delivers a TypeScript rules engine, exposed as an HTTP API, that adjudicates Alberta health and bodily-injury claims and explains every decision. A calling application sends a claim; the engine returns one of five outcomes (`ACCEPT`, `PARTIAL`, `PEND`, `DENY`, `REJECT`) with line-level amounts and the rules that produced them.

It reproduces the attached AHS reference exactly where the reference defines behaviour, and extends it with the five areas the project brief requires: eligibility, coverage, deductibles, frequency limits and medical necessity, plus coordination of benefits, plan changes and retroactive eligibility.

| Dimension | Summary |
| --- | --- |
| Coverage layers | AHCIP public, private supplementary, automobile bodily injury (Section B and Care-First) |
| Checks | 3 guards (G001–G003) and 17 rules (R001–R017) |
| Plan data | Versioned JSON validated by Zod; four example definitions shipped |
| Interfaces | REST under `/api/v1`, JWT for people, API key for calling services |
| Quality bar | 85 planned automated tests, 95% core coverage gate |
| Delivery | Docker image on Render or Railway with Neon Postgres; core package kept npm-publishable |
| Safety stance | Fail closed on unknown input; `PEND` to a human for judgement; never accept when the engine is unreachable |

## Reader guide and conventions

| If you are… | Start with |
| --- | --- |
| A claims adjuster or product owner | Sections 1–2, 19–20, 22, 33 |
| A developer building the engine | Sections 3–10, 21, 24–26, 32 |
| A developer calling the API | Sections 11, 15.5, 23 |
| QA | Sections 14, 31, 32 |
| Operations or security | Sections 13, 15–16, 27–30 |

**Normative language.** MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119. A requirement written with MUST is a release blocker.

**Source tags.** **\[Ref\]** = taken from the AHS reference. **\[Ext\]** = project extension.

**Identifier scheme.**

| Prefix | Meaning | Example |
| --- | --- | --- |
| `FR-` / `NFR-` | Functional / non-functional requirement | FR-012 |
| `UC-` | Use case | UC-03 |
| `G` / `R` | Guard / rule | G002, R011 |
| `ADR-` | Architecture decision record | ADR-006 |
| `T-` | Test case | T-034 |
| `RSK-` | Risk | RSK-04 |
| `OPS-` | Operational procedure | OPS-03 |

**Units and formats.** Money is integer cents internally and decimal dollars on the wire. Dates are ISO `YYYY-MM-DD` in the `America/Edmonton` calendar. Timestamps are UTC ISO-8601.

## 1. Purpose and scope

### 1.1 What this is

A rules engine that takes a claim, the patient's coverage and the plan(s) that apply, and returns an adjudication decision: line-level amounts, a claim-level outcome, and an explanation of every rule that fired. It is built to be called by another application as a feature. The caller sends a claim; the engine answers *accept, reject, deny or pend, and here is exactly why*.

The engine is decision support for a claims adjuster. It never silently makes a judgement call a human should make (see medical necessity in section 9.6).

### 1.2 In scope

| Domain | What the engine covers |
| --- | --- |
| Alberta public health | AHCIP fee-for-service physician claims against the Schedule of Medical Benefits (SOMB) **\[Ref\]** |
| Private supplementary health | Plans such as Green Shield Canada (the reference's private layer): deductible, coinsurance, out-of-pocket maximum, frequency limits, coordination of benefits **\[Ref layer, Ext rules\]** |
| Bodily injury (auto) | Treatment and rehabilitation benefit claims after a motor-vehicle accident, under both the pre-2027 Section B regime and the Care-First regime for accidents on or after January 1, 2027 **\[Ext\]** |

### 1.3 Out of scope for v1

- Real payer connectivity or EDI transmission. All payer-facing behaviour is mocked, exactly as in the reference **\[Ref\]**.
- Moving money (payments, ERA/EOB posting). The reference has these modules; they are optional add-ons here (section 11.6).
- Fraud scoring, litigation or general-damages valuation, and WCB (work-related injuries are adjudicated by WCB, not by this engine).
- Authoritative fee schedules. Every code table in this document is a **representative subset for demonstration**, as the reference itself states. Load the real SOMB and fee guides before treating anything as billable.

### 1.4 Project checklist mapping

| Checklist item | Where it is specified |
| --- | --- |
| Create TypeScript rule engine | Sections 4, 5, 6, 8, 9 |
| Plan definitions (JSON / database) | Sections 7 and 12 |
| Eligibility rules | G001–G003, R006 (sections 8, 9.2) |
| Coverage rules | R007, R008, R016, R017 (section 9.3) |
| Deductible rules | R011 (section 9.4) |
| Frequency rules | R012, R015 (section 9.5) |
| Medical necessity rules | R013 (section 9.6) |
| Edge cases: plan changes, retroactive eligibility, COB | Section 10, R014 (section 9.7) |
| Comprehensive test suite (50+) | Section 14 (85 planned tests) |
| Detailed documentation | This document |
| Deploy as API | Sections 11 and 15 |

## 2. Domain background

### 2.1 Who is who in Alberta **\[Ref\]**

Getting these names right matters in code comments, API docs and interviews.

- **AHCIP** (Alberta Health Care Insurance Plan) is the *plan*. The code uses `payer_id = "AHCIP"`.
- **Alberta Health** is the ministry that administers the plan and publishes the fee schedule (the SOMB). Billing rules come from here.
- **Alberta Health Services (AHS)** is the operational health authority that delivers care. It is *not* the payer. The reference uses "AHS" informally for the engine; this document keeps that naming for continuity with the existing code (`AHSEngine`, `ahs_codes`) but never calls AHS the payer.

### 2.2 The three coverage layers

| Layer | Payer examples | Typical claim | Rule character |
| --- | --- | --- | --- |
| `public` | AHCIP | Physician visit, SOMB code | Format validation, filing window, residency. First-dollar: **no deductible or coinsurance** on insured services. |
| `private` | Green Shield Canada (reference), Alberta Blue Cross | Paramedical, drugs, other non-insured benefits | Deductible, coinsurance, annual maximums, frequency, COB |
| `auto` | Automobile insurer (Section B or Care-First) | Physio, chiropractic, massage, assessments after a collision | Date-of-loss regime routing, benefit caps, pre-approval windows, treatment protocols |

### 2.3 Bodily-injury regimes by date of loss **\[Ext\]**

The regime is chosen by the **date of the accident**, never by the service date or the date the claim was received.

|  | Accidents before Jan 1, 2027 | Accidents on or after Jan 1, 2027 |
| --- | --- | --- |
| Framework | Section B accident benefits of the standard owner's policy, alongside the tort system | Care-First: benefits paid regardless of fault, litigation largely replaced by a benefits tribunal |
| Medical / rehab | Capped (currently $50,000) and must be incurred within 2 years of the accident | Reasonable and necessary treatment; no fixed Section B cap |
| Treatment approval | Pre-approved treatment under the Diagnostic and Treatment Protocols for minor injuries | Treatment within a recognised "program of care" is pre-approved if the claim is made within 12 weeks of the accident |
| Disputes | Insurer decision, then courts | Alberta Automobile Care-First Tribunal |

> **Verify before relying on it.** Care-First regulations were still being finalised when this was written. Every number above lives in plan-definition JSON (section 7), not in code, precisely so it can be corrected without a release.

### 2.4 Alberta constants carried from the reference **\[Ref\]**

| Item | Alberta value | Why it matters |
| --- | --- | --- |
| Personal Health Number (PHN, tied to the ULI) | 9 numeric digits, `^\d{9}$`, no letters | Ontario's card is 10 digits plus 2 letters. An OHIP-shaped value must fail Alberta validation (R009). |
| Provider billing number | 6 digits, `^\d{6}$` | R002 |
| Timely filing (fee-for-service) | 90 days from service date | Ontario's is about 183 days. Wrong value = silently accepting claims AHCIP would reject. |
| Service codes | SOMB format `NN.NNX`, e.g. `03.03A` | Ontario `A001`-style codes must be rejected for Alberta |
| Diagnosis codes | ICD-10-CA (national, shared by provinces) | R003 |
| Privacy law | **Health Information Act (HIA)**, not PHIPA | Cite HIA in audit and compliance text |

## 3. Source-of-truth policy and traceability

### 3.1 Rules of engagement

1. **The reference wins.** Where the reference defines behaviour (rule IDs R001–R005, R009, R010; the province config; the status machine; the eligibility guard; error shapes), the TypeScript implementation reproduces it exactly, including boundary behaviour.
2. **Extensions are labelled.** Anything not in the reference is tagged **\[Ext\]** in this document and lives in clearly separate files so it can be reviewed against the reference.
3. **Reference quirks are decided, not inherited by accident.** Section 3.3 lists each one and the decision taken.
4. **Wire format follows the reference.** JSON field names stay `snake_case` (`service_code`, `provider_billing_number`, `patient_id`) so the engine can sit behind the existing Python platform or be called by the same clients. Internal TypeScript uses `camelCase` with an explicit mapper at the API boundary.

### 3.2 Traceability matrix

| Reference section | What is carried over | TypeScript location |
| --- | --- | --- |
| 7 Config | `DATABASE_URL`, `REDIS_URL` (optional), `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `ENVIRONMENT` | `apps/api/src/config.ts` |
| 8 Models | users, patients, insurance\_plans, patient\_insurances, claims, claim\_lines, claim\_status\_history, appeals, payments, provincial\_rules, audit\_logs | `apps/api/src/db/schema.ts` |
| 12 Eligibility | Cache with in-memory fallback, mock payer (TERM / OON / PEND / INACT), 24-hour guard, frozen coverage snapshot | `packages/core/src/eligibility/*`, `apps/api/src/services/cache.ts` |
| 13 Rule engine | `RuleError`, `ClaimContext`, `PROVINCE_CONFIG`, R001–R005, R009, R010, `run_rules` | `packages/core/src/rules/reference/*` |
| 13 Reference data | `AHS_SERVICE_CODES`, `ICD10CA_CODES` | `packages/core/src/reference/*` |
| 14 Claims + state machine | `ALLOWED_TRANSITIONS`, `transition()`, reject-on-error flow | `packages/core/src/status/*`, `apps/api/src/routes/claims.ts` |
| 18 Provincial strategy | `ProvincialBillingEngine`, `AHSEngine`, `GreenShieldEngine`, `get_engine` registry | `packages/core/src/provincial/*` |
| 19 main.py | `/api/v1` prefix, `/health` | `apps/api/src/server.ts` |
| 22 Tests | The five rule-engine tests and the claim happy path | `packages/core/test/reference-parity.test.ts` |
| 24 Deployment | Render + Neon, `$PORT` start command | Section 15 |

### 3.3 Reference quirks and the decision for each

| Quirk in the reference | Decision |
| --- | --- |
| R006, R007 and R008 are named in the "R001–R010" range but never defined | Defined here as extensions: R006 coverage period, R007 service covered, R008 prior authorization (the reference mock payer already returns `prior_auth_required`) |
| R002 and R009 are skipped when the province has no config entry, so an unknown province silently passes | The API fails closed with `400 No billing engine for <province>`, matching the reference's own `get_engine` behaviour, before any rule runs |
| R004 is hardcoded to Alberta codes (the reference says so and recommends a province lookup) | Implemented as `SERVICE_CODES_BY_PROVINCE`, keyed by province, as the reference recommends |
| Python `re.match` with `$` also accepts a trailing newline (`"123456789\n"`) | JavaScript `$` does not. The TypeScript behaviour is stricter, which is the correct intent. Inputs are never trimmed or normalised silently. |
| `date.today()` is implicit, so tests depend on the real clock | `today` is injected through a `Clock`; production uses the `America/Edmonton` calendar date |
| Amounts are floats (`85.0`) | The wire accepts decimal dollars as the reference does. Internally everything is **integer cents**; floats never enter a calculation. |
| Reference mock deductible shape (`individual`, `family`, `met`) and coinsurance `0.20` | Kept verbatim as the private-plan example. Coinsurance is the **member's** share. |
| The first rule error becomes the claim's `denial_reason_code` | Preserved: `primary_reason_code = errors[0].code`, and rule order is fixed (section 8.3) so this is deterministic |

## 4. Architecture

### 4.1 Design principles

1. **Pure core.** The rule engine is a function: `(claim, plan versions, coverage, history, clock) → decision`. No database, no network, no `Date.now()` inside it. This makes the 50+ tests fast and deterministic and keeps the option of publishing it as an NPM package later.
2. **Data-driven plans.** Benefit design (deductibles, limits, frequency, pre-approval windows, code lists) is JSON validated by Zod. Rule *code* is generic; rule *behaviour* comes from the plan.
3. **Explainable by construction.** Every rule returns a structured result with the inputs it looked at. The caller can show an adjuster the full trace.
4. **Fail safe.** If the engine cannot decide (missing history, unknown plan version), it returns `PEND` with a reason, never an optimistic accept.
5. **Humans decide the judgement calls.** Hard facts (format, dates, limits) produce `REJECT` or `DENY`. Anything needing clinical judgement produces `PEND`.

### 4.2 Layering **\[Ref convention\]**

```
apps/api/src/routes/*      thin HTTP handlers, no business logic
apps/api/src/services/*    orchestration: DB reads, cache, persistence
packages/core/src/*        pure engine: rules, calculators, state machine
apps/api/src/db/*          Drizzle schema + repositories  
```

### 4.3 Request flow for claim creation **\[Ref, extended\]**

```
Client --> Fastify route --> Zod validation (snake_case wire -> camelCase domain)
                |
                |-- Eligibility guard   G001-G003   (reference section 12)
                |-- Load plan versions by service date / date of loss
                |-- Load history: prior claims, accumulators   (ports)
                |-- Stage 1 validation  R001-R005, R009, R010  -> REJECT
                |-- Stage 2 coverage    R006-R008, R016        -> DENY
                |-- Stage 3 adjudication R015, R012, R013,
                |                        R017, R011, R014        -> PAYABLE / PARTIAL / DENY / PEND
                |-- Provincial engine   format_submission()
                '-- Status service      legal transition + history row
                        '--> PostgreSQL (+ Redis eligibility cache, memory fallback)
```

### 4.4 Ports: how the pure core gets data

The core declares interfaces; the API implements them against Postgres and tests implement them in memory.

```ts
export interface ClaimHistoryPort {
  priorLines(patientId: string, from: IsoDate, to: IsoDate): Promise<PriorLine[]>;
}
export interface AccumulatorPort {
  get(patientId: string, planId: string, period: BenefitPeriodKey): Promise<Accumulator>;
}
export interface PlanPort {
  versionFor(planId: string, onDate: IsoDate): Promise<PlanDefinition | null>;
}
export interface Clock { today(): IsoDate }   // America/Edmonton calendar date
```

### 4.5 Two ways to call it

| Mode | Endpoint | Persists? | Use when |
| --- | --- | --- | --- |
| **Evaluate** (dry run) | `POST /api/v1/evaluate` | No | The other app already owns claim storage and only wants the decision. History may be supplied in the request or read from the engine's own tables. |
| **Adjudicate** (full flow) | `POST /api/v1/claims` | Yes | The engine owns the claim lifecycle, as in the reference. |

## 5. Tech stack and repository layout

| Concern | Choice | Reason |
| --- | --- | --- |
| Runtime | Node.js 20 LTS, TypeScript 5 (strict) | Matches the project requirement |
| HTTP | Fastify | Fast, schema-first, first-class OpenAPI |
| Validation | Zod + `fastify-type-provider-zod` | One schema gives runtime validation, types and OpenAPI |
| Database | PostgreSQL 16 (reference), Drizzle ORM + drizzle-kit migrations | Typed SQL, simple migrations (replaces Alembic) |
| Cache | Redis 7 if `REDIS_URL` is set, else in-memory TTL map **\[Ref\]** | Same fallback behaviour as the reference |
| Auth | JWT with roles `admin / biller / analyst` **\[Ref\]**, plus API keys for service callers **\[Ext\]** | Section 13 |
| Tests | Vitest, `fastify.inject`, fast-check, Testcontainers (Postgres) | Section 14 |
| Logging | pino, with PHN redaction | Section 13 |
| Packaging | npm workspaces monorepo | `core` stays publishable |

```
ab-rules-engine/
├── packages/
│   └── core/                       # pure engine, zero I/O
│       ├── src/
│       │   ├── types.ts            # ClaimContext, RuleError, Decision ...
│       │   ├── clock.ts
│       │   ├── money.ts            # cents helpers, rounding
│       │   ├── dates.ts            # ISO-date arithmetic (UTC-safe)
│       │   ├── reference/          # [Ref] ahs-codes.ts, icd10ca.ts, province-config.ts
│       │   ├── plans/              # schema.ts (Zod), resolver.ts, examples/*.json
│       │   ├── rules/
│       │   │   ├── reference/      # r001..r005, r009, r010
│       │   │   └── ext/            # r006..r008, r011..r017
│       │   ├── eligibility/        # guard.ts, mock-payer.ts
│       │   ├── calc/               # deductible.ts, coinsurance.ts, cob.ts
│       │   ├── status/             # allowed-transitions.ts, transition.ts
│       │   ├── provincial/         # base.ts, ahs.ts, greenshield.ts, registry.ts
│       │   └── engine.ts           # evaluateClaim()
│       └── test/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── server.ts
│       │   ├── config.ts
│       │   ├── routes/             # auth, patients, insurance, plans, claims, evaluate ...
│       │   ├── services/           # cache.ts, eligibility.ts, adjudication.ts
│       │   ├── db/                 # schema.ts, repositories/
│       │   └── plugins/            # auth, audit, error-handler, rate-limit
│       └── test/
├── plans/                          # seed plan JSON (AHCIP, GREENSHIELD, AB_AUTO_*)
├── scripts/seed.ts
├── drizzle/                        # migrations
├── Dockerfile  docker-compose.yml  render.yaml
└── README.md
```

## 6. Domain model

The types below are the contract between the API and the core. Names mirror the reference's `ClaimContext`, `RuleError` and schema fields.

```ts
export type Province = 'AB' | 'ON';        // [Ref] AB first, ON as the second-province example
export type IsoDate = string;               // 'YYYY-MM-DD', Edmonton calendar date
export type Cents = number;                 // integer cents

export interface ClaimLineIn {              // [Ref] ClaimLineIn
  serviceCode: string;                      // SOMB e.g. '03.03A'
  diagnosisCode: string;                    // ICD-10-CA
  units: number;                            // default 1
  amount: Cents;                            // per unit; billed = sum(amount * units)
  serviceDate?: IsoDate;                    // [Ext] line-level date for multi-visit claims
}

export interface ClaimContext {              // [Ref] ClaimContext + [Ext] fields
  province: Province;
  providerBillingNumber: string;
  serviceDate: IsoDate;
  healthCardNumber: string | null;
  patientProvince: string;
  lines: ClaimLineIn[];
  // extensions
  patientId: string;
  planIds: string[];                        // all coverages in play, for COB
  dateOfLoss?: IsoDate;                     // required for auto claims
  receivedDate: IsoDate;                    // filing-clock end; defaults to today
  today: IsoDate;                           // injected by Clock
}

export interface RuleError { code: string; message: string }   // [Ref]

export type Outcome = 'ACCEPT' | 'REJECT' | 'DENY' | 'PEND' | 'PARTIAL';
export type LineOutcome = 'payable' | 'partial' | 'denied' | 'pended';

export interface LineResult {
  lineNo: number;
  outcome: LineOutcome;
  eligibleAmount: Cents;
  deductibleApplied: Cents;
  coinsuranceAmount: Cents;       // member share of coinsurance
  planPays: Cents;
  memberPays: Cents;
  reasons: RuleError[];
}

export interface Decision {
  outcome: Outcome;
  primaryReasonCode: string | null;    // errors[0].code, as in the reference
  errors: RuleError[];                 // stage 1 and any denial reasons
  lines: LineResult[];
  billedAmount: Cents;
  planPaysTotal: Cents;
  memberPaysTotal: Cents;
  suggestedStatus: ClaimStatus;        // maps to the reference state machine
  coverageSnapshot: unknown;           // frozen eligibility response [Ref]
  planVersionsUsed: { planId: string; version: number }[];
  trace: RuleTraceEntry[];             // one entry per rule evaluated
  engineVersion: string;
}
```

## 7. Plan definitions (JSON / database)

Plans are stored as versioned JSON. In the database they live in `plan_versions.definition` (jsonb); in the repo, seed copies live in `plans/*.json`. Both are validated by the same Zod schema on write, so a bad plan can never be saved.

### 7.1 Why versions

A plan changes over time: deductible increases on January 1, a benefit is added mid-year, Care-First replaces Section B on a fixed date. A claim is always adjudicated against the plan version **in force on the service date** (or the date of loss for regime routing), not the version in force today. This is the foundation of the plan-change edge case in section 10.

### 7.2 Schema (abridged)

```ts
export interface PlanDefinition {
  planId: string;
  version: number;
  payerId: 'AHCIP' | 'GREENSHIELD' | 'AB_AUTO_SECTION_B' | 'AB_CARE_FIRST';
  layer: 'public' | 'private' | 'auto';
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;           // null = open-ended
  codeSystem: 'SOMB' | 'PRIVATE_SCHEDULE' | 'AUTO_TREATMENT';
  benefitPeriod: 'calendar_year' | 'rolling_12m' | 'per_accident';
  filingLimitDays?: number;              // overrides province default when present
  deductible: { individual: Cents; family: Cents } | null;   // null on public plans
  coinsurance: number;                   // MEMBER share, 0..1
  outOfPocketMax: Cents | null;
  copay?: { primary: Cents; specialist: Cents; er: Cents };  // carried, display-only in v1
  priorAuth: string[];                   // [Ref] prior_auth_required
  coverage: CoverageRule[];
  frequency: FrequencyRule[];
  medicalNecessity: NecessityRule[];
  benefitMaximums: BenefitMaximum[];
  cob?: { role: 'primary_only' | 'standard' | 'secondary_only' };
  accumulatorCarryover?: boolean;        // on plan change, credit prior-version spend
}
```

### 7.3 Example: AHCIP (public layer)

```json
{
  "planId": "AHCIP", "version": 1, "payerId": "AHCIP", "layer": "public",
  "effectiveFrom": "2020-01-01", "effectiveTo": null,
  "codeSystem": "SOMB", "benefitPeriod": "calendar_year", "filingLimitDays": 90,
  "deductible": null, "coinsurance": 0, "outOfPocketMax": null,
  "priorAuth": [],
  "coverage": [{ "codes": ["03.03A","03.04A","03.05A","03.08A","13.99A"], "covered": true }],
  "frequency": [], "medicalNecessity": [], "benefitMaximums": [],
  "cob": { "role": "primary_only" }
}
```

The five codes are exactly the reference's `AHS_SERVICE_CODES`. Real coverage lists come from the SOMB.

### 7.4 Example: private supplementary plan (Green Shield layer)

Numbers are the reference mock payer's defaults: deductible 500 individual / 1500 family, coinsurance 0.20, out-of-pocket maximum 3000, prior auth for `MRI` and `27447`.

```json
{
  "planId": "GREENSHIELD", "version": 1, "payerId": "GREENSHIELD", "layer": "private",
  "effectiveFrom": "2024-01-01", "effectiveTo": null,
  "codeSystem": "PRIVATE_SCHEDULE", "benefitPeriod": "calendar_year",
  "deductible": { "individual": 50000, "family": 150000 },
  "coinsurance": 0.20, "outOfPocketMax": 300000,
  "copay": { "primary": 2500, "specialist": 5000, "er": 25000 },
  "priorAuth": ["MRI", "27447"],
  "coverage": [
    { "category": "paramedical", "covered": true },
    { "category": "insured_physician_service", "covered": false, "reason": "INSURED_BY_AHCIP" }
  ],
  "frequency": [
    { "category": "physio", "maxUnits": 20, "period": "calendar_year" }
  ],
  "medicalNecessity": [], "benefitMaximums": [
    { "category": "paramedical", "amount": 150000, "period": "calendar_year" }
  ],
  "cob": { "role": "standard" },
  "accumulatorCarryover": true
}
```

Money in plan JSON is in **cents** (50000 = $500.00). The mapper converts the reference's dollar figures once, at seed time.

### 7.5 Example: auto plan before and after Care-First

```json
{
  "planId": "AB_AUTO", "version": 1, "payerId": "AB_AUTO_SECTION_B", "layer": "auto",
  "effectiveFrom": "2000-01-01", "effectiveTo": "2026-12-31",
  "codeSystem": "AUTO_TREATMENT", "benefitPeriod": "per_accident",
  "deductible": null, "coinsurance": 0, "outOfPocketMax": null,
  "benefitMaximums": [
    { "category": "medical_rehab", "amount": 5000000, "period": "per_accident", "incurredWithinDays": 730 }
  ],
  "medicalNecessity": [{ "mode": "protocol", "protocol": "DTPR_MINOR_INJURY" }],
  "cob": { "role": "primary_only" }
}
```

```json
{
  "planId": "AB_AUTO", "version": 2, "payerId": "AB_CARE_FIRST", "layer": "auto",
  "effectiveFrom": "2027-01-01", "effectiveTo": null,
  "codeSystem": "AUTO_TREATMENT", "benefitPeriod": "per_accident",
  "deductible": null, "coinsurance": 0, "outOfPocketMax": null,
  "medicalNecessity": [
    { "mode": "program_of_care", "preApprovedIfClaimedWithinDays": 84 }
  ],
  "cob": { "role": "primary_only" }
}
```

Both versions share `planId: AB_AUTO`; the resolver picks the version whose `effectiveFrom`–`effectiveTo` window contains the **date of loss**. 84 days is the 12-week pre-approval window.

## 8. Evaluation pipeline and rule catalogue

### 8.1 The four stages

| Stage | Purpose | Rules | If it fires |
| --- | --- | --- | --- |
| 0. Guards | Is there verified, current, eligible coverage at all? | G001–G003 | Request blocked with HTTP 422. No claim is created. **\[Ref\]** |
| 1. Validation | Is the claim well-formed for Alberta? | R001–R005, R009, R010 | All stage-1 rules run and errors are aggregated. Any error → `REJECT`. **\[Ref\]** |
| 2. Eligibility and coverage | Was the patient covered on that date, and is this service a benefit? | R006, R007, R008, R016 | `DENY` (or `PEND` where noted) **\[Ext\]** |
| 3. Adjudication | Duplicates, limits, necessity, then the money | R015, R012, R013, R017, R011, R014 | Per-line outcome: payable, partial, denied or pended **\[Ext\]** |

Stages 2 and 3 only run when stage 1 is clean, because they depend on valid codes and dates.

### 8.2 Rule catalogue

| ID | Name | Stage | Source | Outcome when it fires |
| --- | --- | --- | --- | --- |
| G001 | No verified coverage for this patient/plan | 0 | Ref | Block (422) |
| G002 | Coverage verification older than 24 hours | 0 | Ref | Block (422) |
| G003 | Payer says not eligible | 0 | Ref | Block (422) |
| R001 | Required fields (service lines, billing number) | 1 | Ref | REJECT |
| R002 | Provider billing number format | 1 | Ref | REJECT |
| R003 | Diagnosis code is valid ICD-10-CA | 1 | Ref | REJECT |
| R004 | Service code is valid for the province's schedule | 1 | Ref | REJECT |
| R005 | Timely filing | 1 | Ref | REJECT |
| R009 | Health card format (PHN) | 1 | Ref | REJECT |
| R010 | Residency routing | 1 | Ref | REJECT |
| R006 | Service date inside coverage period | 2 | Ext | DENY |
| R007 | Service is a covered benefit | 2 | Ext | DENY (default-deny) |
| R008 | Prior authorization | 2 | Ext | DENY, or PEND if requested |
| R016 | Date-of-loss regime routing (auto) | 2 | Ext | DENY / PEND |
| R015 | Duplicate claim | 3 | Ext | DENY |
| R012 | Frequency limits | 3 | Ext | DENY or PARTIAL |
| R013 | Medical necessity | 3 | Ext | PEND (DENY only if plan says hard) |
| R017 | Benefit maximums and time limits | 3 | Ext | PARTIAL / DENY |
| R011 | Deductible, coinsurance, out-of-pocket max | 3 | Ext | Calculation, never rejects |
| R014 | Coordination of benefits | 3 | Ext | Calculation, or PEND if order unknown |

### 8.3 Fixed rule order

Stage-1 order is fixed to the reference's `RULES` list: **R001, R002, R003, R004, R005, R009, R010**. This matters because the reference stores `errors[0].code` as the claim's `denial_reason_code`. Changing the order would change which reason an adjuster sees. A test locks the order.

### 8.4 From decision to claim status **\[Ref, extended\]**

| Engine outcome | Status transitions applied |
| --- | --- |
| `REJECT` | `draft → submitted → rejected`, reason = `errors[0].code` (exactly the reference flow) |
| `DENY` | `draft → submitted → denied`, reason = first denial code |
| `PEND` | `draft → submitted → pended` **\[Ext\]** |
| `ACCEPT`, `PARTIAL` | `draft → submitted`; a later payment moves it to `paid` |

```ts
export const ALLOWED_TRANSITIONS: Record<ClaimStatus, ReadonlySet<ClaimStatus>> = {
  draft: new Set(['submitted']),
  submitted: new Set(['paid', 'denied', 'rejected', 'pended']),   // 'pended' is [Ext]
  pended: new Set(['paid', 'denied', 'rejected']),                // [Ext]
  denied: new Set(['appeal_pending']),
  appeal_pending: new Set(['paid', 'closed']),
  rejected: new Set(['submitted']),                               // after correction
  paid: new Set(),
  closed: new Set(),
};
// Illegal transition → HTTP 409 'Illegal transition X -> Y'   [Ref]
```

Every transition writes a `claim_status_history` row (`from_status`, `to_status`, `reason_code`, `created_at`).

### 8.5 Rule contracts

Stage-1 rules keep the reference's signature: a context in, a list of errors out.

```ts
export type ValidationRule = (ctx: ClaimContext) => RuleError[];

// Stage 2 and 3 rules also return a trace entry and may adjust line results.
export interface RuleInput {
  ctx: ClaimContext;
  plan: PlanDefinition;            // version resolved for the relevant date
  coverage: CoverageRecord;        // patient_insurance row (dates, member id)
  history: ClaimHistoryPort;
  accumulators: Accumulator;
  lines: LineResult[];             // mutated copy, passed down the pipeline
}
export type AdjudicationRule = (i: RuleInput) => Promise<RuleOutput>;
```

## 9. Rule specifications

### 9.1 Reference rules R001–R005, R009, R010 **\[Ref\]**

The province table is the same data as the reference, ported as-is. In production it is loaded from `provincial_rules.config` with this table as the in-code default, as the reference describes.

```ts
export const PROVINCE_CONFIG: Record<string, ProvinceConfig> = {
  AB: { billingNumberRe: /^\d{6}$/, filingLimitDays: 90,  healthCardRe: /^\d{9}$/ },        // AHCIP PHN
  ON: { billingNumberRe: /^\d{6}$/, filingLimitDays: 183, healthCardRe: /^\d{10}[A-Z]{2}$/ }, // OHIP
};

export const r001RequiredFields: ValidationRule = (ctx) => {
  const errors: RuleError[] = [];
  if (ctx.lines.length === 0) errors.push({ code: 'R001', message: 'Claim has no service lines' });
  if (!ctx.providerBillingNumber) errors.push({ code: 'R001', message: 'Missing provider billing number' });
  return errors;
};

export const r002BillingNumber: ValidationRule = (ctx) => {
  const cfg = PROVINCE_CONFIG[ctx.province];
  return cfg && !cfg.billingNumberRe.test(ctx.providerBillingNumber)
    ? [{ code: 'R002', message: `Billing number invalid for ${ctx.province}` }] : [];
};

export const r003DiagnosisCodes: ValidationRule = (ctx) =>
  ctx.lines.filter((l) => !ICD10CA_CODES.has(l.diagnosisCode))
    .map((l) => ({ code: 'R003', message: `Unknown ICD-10-CA code ${l.diagnosisCode}` }));

export const r004ServiceCodes: ValidationRule = (ctx) => {
  const codes = SERVICE_CODES_BY_PROVINCE[ctx.province] ?? {};   // reference's recommended fix
  return ctx.lines.filter((l) => !(l.serviceCode in codes))
    .map((l) => ({ code: 'R004', message: `Unknown AHCIP SOMB code ${l.serviceCode}` }));
};

export const r005TimelyFiling: ValidationRule = (ctx) => {
  const limit = PROVINCE_CONFIG[ctx.province]?.filingLimitDays ?? 90;
  return ctx.serviceDate < addDays(ctx.receivedDate, -limit)
    ? [{ code: 'R005', message: 'Past the timely-filing limit' }] : [];
};

export const r009HealthCard: ValidationRule = (ctx) => {
  const cfg = PROVINCE_CONFIG[ctx.province];
  return cfg && (!ctx.healthCardNumber || !cfg.healthCardRe.test(ctx.healthCardNumber))
    ? [{ code: 'R009', message: `Invalid ${ctx.province} health card` }] : [];
};

export const r010ResidencyRouting: ValidationRule = (ctx) =>
  ctx.patientProvince !== ctx.province
    ? [{ code: 'R010', message: `Patient (${ctx.patientProvince}) cannot be billed to ${ctx.province}` }] : [];

export const RULES = [r001RequiredFields, r002BillingNumber, r003DiagnosisCodes,
                       r004ServiceCodes, r005TimelyFiling, r009HealthCard, r010ResidencyRouting];
export const runRules = (ctx: ClaimContext): RuleError[] => RULES.flatMap((r) => r(ctx));
```

Behaviour notes that tests lock down:

- **R005 boundary.** The comparison is strict. A service exactly 90 days before the received date **passes**; 91 days **fails**. ISO date strings compare correctly as plain strings.
- **R009 and the strategy pattern.** R009 delegates to the provincial engine's `verifyEligibilityFormat`. For the public Alberta engine that is the 9-digit regex above. For the private-payer engine it returns `true`, because a private payer uses a member ID rather than a health card **\[Ref, section 18\]**.
- **R004 default.** A province with no code table yields an empty table, so every code is unknown. That is intentionally fail-closed.
- **Diagnosis codes for injuries.** The reference's seven ICD-10-CA codes (`J06.9 E11.9 I10 M54.5 R51 Z00.0 F41.1`) cannot describe a collision injury. Add injury codes such as `S13.4` (cervical sprain) and `S33.5` (lumbar sprain) from the CIHI-published ICD-10-CA tables **\[Ext\]**. The set stays data, not code.
- **Auto service codes.** SOMB codes do not describe physio or chiropractic visits. The `AUTO_TREATMENT` and `PRIVATE_SCHEDULE` code systems use clearly marked placeholder codes (for example `PHYSIO-INIT`) until real fee guides are loaded.

### 9.2 Eligibility: guards G001–G003 and rule R006

**Guards \[Ref\].** Messages are copied verbatim from the reference's `assert_eligible`.

```ts
const GUARD_MAX_AGE_HOURS = 24;

export function assertEligible(ins: PatientInsuranceRow | null, now: Date): EligibilitySnapshot {
  if (!ins?.lastVerifiedAt || !ins.lastEligibility)
    throw new GuardError('G001', 'No verified coverage for this patient/plan');
  if (ins.lastVerifiedAt < new Date(now.getTime() - GUARD_MAX_AGE_HOURS * 3_600_000))
    throw new GuardError('G002', 'Coverage verification is stale — re-verify');
  if (!ins.lastEligibility.eligible)
    throw new GuardError('G003', 'Patient is not eligible — claim blocked');
  return ins.lastEligibility;            // the frozen snapshot stored on the claim
}
```

**Mock payer \[Ref\].** `verifyEligibility` waits 200–600 ms to simulate payer latency, then inspects the member ID prefix:

| Prefix | Payer reason code |
| --- | --- |
| `TERM` | `COVERAGE_TERMINATED` |
| `OON` | `OUT_OF_NETWORK` |
| `PEND` | `COVERAGE_PENDING` |
| `INACT` | `INACTIVE_PLAN` |
| anything else | eligible, with the plan's copay / deductible / coinsurance / prior-auth list |

Results are cached under `eligibility:{patient_insurance_id}` for 3600 seconds. **`reverify` must delete the cache key first**, otherwise the stale cached answer short-circuits the re-check. This is called out as critical in the reference and has its own test.

**R006 — coverage period \[Ext\].** Fills the first of the reference's three unnamed rule slots.

- Fires when `serviceDate < patient_insurance.effective_date`, or `termination_date` is set and `serviceDate > termination_date`, or the date falls outside the resolved plan version's window.
- Outcome: `DENY`, code `COVERAGE_PERIOD`, message `Service date outside coverage period`.
- **Why both a guard and R006?** The guard is a point-in-time answer from the payer ("eligible as of now"). R006 is a date-of-service check against stored dates. A patient can be eligible today and not have been covered on the service date, and the reverse after a retroactive change (section 10.2).

### 9.3 Coverage: R007, R008, R016, R017 **\[Ext\]**

**R007 — service covered.** Match each line against the plan's `coverage` list by `codes` or `category`.

- No matching rule → `DENY` `NOT_A_BENEFIT` (**default-deny**: a benefit must be explicitly listed).
- Matching rule with `covered: false` → `DENY` with the rule's reason, e.g. `INSURED_BY_AHCIP` for a private plan asked to pay an AHCIP-insured physician service.

**R008 — prior authorization.** If the line's service code or category appears in `plan.priorAuth` (the reference mock returns `["MRI", "27447"]`) and the line carries no `prior_auth_number`: `DENY` `PRIOR_AUTH_REQUIRED`. If the caller sets `prior_auth_status: "requested"`, the outcome is `PEND` instead.

**R016 — date-of-loss routing (auto plans).**

1. `date_of_loss` is mandatory for `layer: auto`. Missing → `PEND` `DATE_OF_LOSS_REQUIRED`.
2. Resolve the plan version whose window contains the **date of loss** (section 2.3), and use it for the entire claim, whatever the service dates.
3. `serviceDate < dateOfLoss` → `DENY` `SERVICE_BEFORE_LOSS`.

**R017 — benefit maximums and time limits.** For each `benefitMaximums` entry:

- *Time limit:* if `incurredWithinDays` is set and `serviceDate > dateOfLoss + days` → `DENY` `TIME_LIMIT_EXCEEDED`.
- *Dollar maximum:* `remaining = max − alreadyPaid(period, category)`. If a line's payable amount exceeds `remaining`, pay up to `remaining` and deny the rest as `MAX_REACHED` (`PARTIAL`).
- The Section B example uses 730 days for "2 years", which drifts by a day across leap years. The final schema should use `incurredWithinMonths: 24` with calendar arithmetic. Treat 730 as a known simplification in the sample JSON.

### 9.4 Deductible, coinsurance and out-of-pocket maximum (R011) **\[Ext\]**

R011 is a calculation, not a rejection. It never returns an error. Public (`AHCIP`) plans have `deductible: null` and `coinsurance: 0`, so the plan simply pays the eligible amount.

**Algorithm, per line, in line order** (accumulators are updated after each line so the deductible is consumed in sequence):

1. `eligible` = billed amount, capped at the plan's allowed amount when the coverage rule defines one.
2. `dedRemaining = max(0, deductible.individual − accum.individualDeductibleMet)`. If `accum.familyDeductibleMet ≥ deductible.family`, `dedRemaining = 0` (family deductible satisfied).
3. `dedApplied = min(eligible, dedRemaining)`; `afterDed = eligible − dedApplied`.
4. `coinsMember = roundHalfUp(afterDed × coinsurance)`. Coinsurance is the **member's** share.
5. `planPays = afterDed − coinsMember`.
6. **Out-of-pocket cap:** `memberTotal = dedApplied + coinsMember`; `oopRemaining = max(0, outOfPocketMax − accum.oopMet)`. If `memberTotal > oopRemaining`, move the excess to the plan: `planPays += memberTotal − oopRemaining`.
7. `memberPays = eligible − planPays`.

**Invariants** (asserted by property-based tests): `planPays + memberPays = eligible`; every amount ≥ 0; `planPays ≤ eligible`; no cent is created or lost by rounding because the plan share is always the remainder.

| Case | Eligible | Deductible remaining | Other | Plan pays | Member pays |
| --- | --- | --- | --- | --- | --- |
| A. Deductible swallows the claim | $85.00 | $380.00 | — | $0.00 | $85.00 |
| B. Deductible then coinsurance | $600.00 | $380.00 | 20% member coinsurance | $176.00 | $424.00 |
| C. Out-of-pocket cap reached | $1,000.00 | $0.00 | OOP max $3,000, $2,950 already met | $950.00 | $50.00 |
| D. Public AHCIP | $85.00 | none | no deductible | $85.00 | $0.00 |

Case B uses the reference mock payer values: deductible $500 with $120 met leaves $380; the remaining $220 attracts 20% coinsurance ($44), so the plan pays $176. Copays are carried from the plan and returned for display, but are **not applied** in v1.

### 9.5 Frequency (R012) and duplicates (R015) **\[Ext\]**

**R012 rule shape:** `{ category | codes, maxUnits, period, rollingDays?, minDaysBetween? }` where `period` is `calendar_year`, `rolling_12m`, `rolling_days` or `per_accident`.

Algorithm per line:

1. Compute the window that contains the line's **service date** (not the received date).
2. `used` = units already adjudicated as payable for this patient in the window, from history, plus earlier lines of this claim.
3. `allowed = max(0, maxUnits − used)`.
4. If `units ≤ allowed` → no effect. If `0 < allowed < units` → `PARTIAL`: pay `allowed` units pro rata, deny the remainder `FREQUENCY_EXCEEDED`. If `allowed = 0` → `DENY` `FREQUENCY_EXCEEDED`.
5. If `minDaysBetween` is set and the previous service of the same type is closer than that → `DENY` `FREQUENCY_INTERVAL`.

**Ordering matters.** Lines are consumed in **service-date order**, not submission order. A late-submitted earlier visit must not lose its place to a later one. When a retroactive or late claim lands inside a window already consumed, the engine flags later claims in that window as `REPROCESS_CANDIDATE` (section 10.2) instead of rewriting history.

**R015 — duplicates.** Same patient, provider billing number, service code, service date and units already present on a claim that was not rejected → `DENY` `DUPLICATE_CLAIM`. Exact matches only in v1. This is separate from the `Idempotency-Key` header (section 11), which protects against a client retrying the *same request*; R015 protects against billing the same *service* twice.

### 9.6 Medical necessity (R013) **\[Ext\]**

This is the one area where the engine deliberately limits itself. **Clinical judgement belongs to a person.** R013 returns `PEND` with the questions the reviewer needs answered. It returns `DENY` only when the plan marks a rule `hard: true` for an objective impossibility.

Three configurable modes, which can be combined on one plan:

| Mode | Used for | Logic |
| --- | --- | --- |
| `diagnosis_service_map` | Private and public | Each service code or category lists the diagnoses it is appropriate for. A mismatch → `PEND` `NECESSITY_REVIEW` (or `DENY` if `hard`). Example: a physiotherapy code with a non-musculoskeletal diagnosis. |
| `protocol` | Pre-2027 auto | Injury classification (`minor`, `non_minor`, `unknown`) selects a treatment protocol with visit and time limits. Within protocol → pass. Beyond protocol, or classification `unknown` → `PEND`. |
| `program_of_care` | Care-First auto | Pre-approved if the claim is received within `preApprovedIfClaimedWithinDays` (84, i.e. 12 weeks) of the date of loss and the treatment belongs to a recognised program. Otherwise → `PEND` for insurer review. |

```ts
export function checkDiagnosisServiceMap(line: ClaimLineIn, rule: DxServiceRule): RuleResult {
  const ok = rule.allowedDiagnoses.includes(line.diagnosisCode);
  if (ok) return pass('R013');
  return rule.hard
    ? deny('R013', 'NECESSITY_MISMATCH', `Diagnosis ${line.diagnosisCode} not supported for ${line.serviceCode}`)
    : pend('R013', 'NECESSITY_REVIEW', { prompts: ['Attach clinical notes', 'Confirm diagnosis'] });
}
```

Every `PEND` includes `review_prompts` so the calling app can render a task for the adjuster rather than a dead end.

### 9.7 Coordination of benefits (R014) **\[Ext\]**

**Who pays first.** The first matching rule decides:

1. **Insured public service.** If the service is an AHCIP-insured physician service, AHCIP is the only payer. Private plans exclude it through R007 (`INSURED_BY_AHCIP`).
2. **Auto injury.** If the claim has a date of loss and the treatment relates to the accident, the auto plan is primary and a private plan is secondary.
3. **Own plan before dependent coverage.** A member's own plan is primary over coverage held as a spouse or dependent.
4. **Dependent child on two parents' plans.** Birthday rule: the parent whose birthday (month and day) falls earlier in the calendar year is primary. If equal, the plan in force longer is primary.
5. **Otherwise** → `PEND` `COB_ORDER_UNDETERMINED`.

The ordering is configuration, not hardcoded; plan documents govern in real life, so treat rules 3–4 as industry defaults to confirm against each plan.

**How the money splits.** The primary plan adjudicates as if it were alone. The secondary computes its own normal benefit against the same eligible amount, then pays no more than what is left:

```ts
const remaining = eligible - primaryPaid;                    // member responsibility after primary
const secondaryPays = Math.min(secondaryNormalBenefit, remaining);
// invariant: primaryPaid + secondaryPays <= eligible  (never more than 100% of the eligible expense)
```

Each plan's accumulators are updated separately. The decision lists one result per plan, in payment order.

## 10. Edge cases

Each scenario below has at least one named test in section 14.

### 10.1 Plan changes

| Scenario | Behaviour |
| --- | --- |
| New plan version mid-year (deductible raised July 1) | Each **line** resolves the version in force on its own service date. A claim with lines before and after July 1 uses two versions; `planVersionsUsed` lists both. |
| Deductible already partly met when the version changes | If `accumulatorCarryover: true`, prior-version spend is credited. If false, accumulators restart at the new version's `effectiveFrom`. |
| Member switches carrier mid-year | The new plan has its own accumulators. The caller may supply `prior_accumulators` so the new plan can honour a transferred deductible credit. |
| Coverage terminates mid-claim | Lines dated after termination fail R006; earlier lines still adjudicate. Outcome `PARTIAL`. |
| **Regime switch on Jan 1, 2027** | Version chosen by **date of loss**. A collision on Dec 20, 2026 stays under Section B for all treatment, including visits in 2027, and its time limit runs from the 2026 date. A collision on Jan 3, 2027 is Care-First from the first visit. |
| Billing-code set changes | `codeSystem` is part of the plan version, so historical claims keep validating against the codes valid on their dates. |

### 10.2 Retroactive eligibility

Coverage dates sometimes change after claims have been processed.

| Scenario | Behaviour |
| --- | --- |
| **Retroactive add** (coverage backdated) | Claims previously denied by R006 or G003 for that period are flagged `REPROCESS_CANDIDATE`. `POST /claims/{id}/reprocess` re-adjudicates against the new dates and writes a **new adjudication version**; the original stays on file. |
| **Retroactive termination** | Claims already paid inside the terminated range are flagged `RECOVERY_REVIEW`. The engine never claws back money automatically. |
| Timely-filing clock | Default is the reference behaviour: the clock runs from the **service date**. A plan may set `retroFilingClock: "eligibility_notice_date"` for cases where the member could not have known they were covered. |
| Accumulators after a retro change | Replayed chronologically from the earliest affected date so deductibles and frequency windows are consumed in the right order. |
| Snapshot vs. truth | The 24-hour eligibility snapshot is evidence of what the payer said *then*. It is never rewritten; reprocessing stores a fresh snapshot alongside it. |

### 10.3 Coordination of benefits

| Scenario | Behaviour |
| --- | --- |
| Primary denies the whole line | Secondary adjudicates the line on its own, unless the denial reason is that the claim was never submitted to the primary, in which case `PEND` `COB_PRIMARY_PENDING`. |
| Primary pays in part | Secondary pays `min(its normal benefit, remainder)`. |
| Primary payment reversed later | Secondary result is recalculated and flagged for review. |
| Order cannot be determined | `PEND` `COB_ORDER_UNDETERMINED`, never a guess. |
| Auto accident plus private plan | Auto primary, private secondary (rule 2 in section 9.7). |

### 10.4 Other boundary cases

- **Resubmission after rejection.** The reference allows `rejected → submitted` "after correction". The full rule pipeline reruns from stage 1.
- **Concurrency.** Two claims for the same member can arrive at once. Accumulator rows are read with `SELECT … FOR UPDATE` inside the adjudication transaction so both cannot consume the same remaining deductible.
- **Time zones.** The "day" for filing and windows is the `America/Edmonton` calendar date. A claim received at 11:30 pm Mountain Time is not filed "tomorrow" because UTC has rolled over.
- **Leap years and month ends.** Date arithmetic is done on UTC-anchored ISO dates with tested helpers, never with local-time `Date` math.
- **Money.** Negative amounts and non-positive units are rejected by Zod before the engine runs. Rounding is half-up to the cent and always leaves the remainder with the plan.
- **Multi-date claims.** Lines may carry their own `service_date`; filing and plan-version rules apply per line, while R001, R002, R009 and R010 apply once per claim.
- **Immutability.** Adjudications are append-only. Reprocessing creates a new row with `supersedes_id`; nothing is overwritten.

## 11. API specification

Base path `/api/v1` **\[Ref\]**. JSON on the wire uses `snake_case` **\[Ref\]**. Interactive Swagger UI at `/docs`, generated from the Zod schemas.

### 11.1 Endpoints

| Method and path | Purpose | Source | Roles |
| --- | --- | --- | --- |
| `GET /health` | Liveness, returns `{"status":"ok"}` | Ref | none |
| `POST /auth/register`, `POST /auth/login` | JWT auth (`admin`, `biller`, `analyst`) | Ref | none |
| `POST /patients` | Create patient with insurance | Ref | admin, biller |
| `POST /insurance/verify`, `POST /insurance/reverify` | Eligibility check; reverify clears the cache first | Ref | admin, biller |
| **`POST /evaluate`** | **Dry-run adjudication, nothing persisted. The main integration endpoint.** | Ext | service key, admin, biller |
| `POST /claims` | Adjudicate and persist; returns 201 or 422 | Ref | admin, biller |
| `GET /claims/{id}` | Fetch claim, lines, decision | Ref | any |
| `POST /claims/{id}/status` | Manual transition, 409 if illegal | Ref | admin, biller |
| `POST /claims/{id}/reprocess` | Re-adjudicate after a coverage or plan change | Ext | admin |
| `POST /claims/{id}/override` | Adjuster overrides a `PEND` or `DENY`, reason mandatory, audited | Ext | admin |
| `GET /plans`, `GET /plans/{id}`, `POST /plans`, `POST /plans/{id}/versions` | Plan definitions, validated by Zod on write | Ext | read: any; write: admin |
| `GET /rules` | Rule catalogue with IDs, stages and descriptions | Ext | any |

### 11.2 Evaluate: request

```json
{
  "patient_id": 12,
  "plan_id": 2,
  "province": "AB",
  "provider_billing_number": "123456",
  "service_date": "2026-10-01",
  "date_of_loss": null,
  "lines": [
    { "service_code": "03.03A", "diagnosis_code": "J06.9", "units": 1, "amount": 85.0 }
  ],
  "history": null,
  "prior_accumulators": null
}
```

`history` is optional. When `null`, the engine reads the patient's prior lines and accumulators from its own tables. When the calling app owns that data, it can pass it in and the engine stays fully stateless. `?trace=true` adds the per-rule trace.

### 11.3 Evaluate: responses

**Accepted with member cost share** (private plan, deductible partly met):

```json
{
  "outcome": "ACCEPT",
  "primary_reason_code": null,
  "billed_amount": 600.00,
  "plan_pays_total": 176.00,
  "member_pays_total": 424.00,
  "suggested_status": "submitted",
  "lines": [{
    "line_no": 1, "outcome": "payable", "eligible_amount": 600.00,
    "deductible_applied": 380.00, "coinsurance_amount": 44.00,
    "plan_pays": 176.00, "member_pays": 424.00, "reasons": []
  }],
  "plan_versions_used": [{ "plan_id": "GREENSHIELD", "version": 1 }],
  "engine_version": "1.0.0"
}
```

**Rejected** (an Ontario-shaped card submitted for an Alberta claim, the reference's live demo of R009):

```json
{
  "outcome": "REJECT",
  "primary_reason_code": "R009",
  "errors": [{ "code": "R009", "message": "Invalid AB health card" }],
  "suggested_status": "rejected",
  "lines": []
}
```

**Pended** carries `review_prompts` such as `["Attach clinical notes", "Confirm diagnosis"]` plus the reason code (`NECESSITY_REVIEW`, `COB_ORDER_UNDETERMINED`, `DATE_OF_LOSS_REQUIRED`).

On `/evaluate`, a decision of any kind is a **successful evaluation**, so the HTTP status is 200 and the outcome is in the body.

### 11.4 Create claim: mirrors the reference

`POST /claims` follows the reference flow: guard, create `draft`, run rules, then transition. A rule failure moves the claim `draft → submitted → rejected` and returns **422** with the reference's body:

```json
{
  "message": "Claim rejected by rule engine",
  "errors": [{ "code": "R002", "message": "Billing number invalid for AB" }],
  "claim_id": 41
}
```

Success returns **201** with `ClaimOut` (`id`, `status`, `province`, `billed_amount`, `denial_reason_code`, `lines`) plus the new `decision` object. A `DENY` or `PEND` outcome is also 201 because the claim was created; its `status` shows `denied` or `pended`.

### 11.5 Status codes and error shape

| Code | When |
| --- | --- |
| 200 | Evaluation completed (any outcome); reads |
| 201 | Resource created |
| 400 | `No billing engine for <province>` (unsupported province, fail-closed) **\[Ref\]** |
| 401 / 403 | Missing or invalid credentials / insufficient role |
| 404 | Patient, claim, plan or appeal not found |
| 409 | Illegal status transition, or idempotency-key conflict |
| 422 | Guard failure (G001–G003) with the reference's message, Zod validation failure, or rule rejection body above |
| 429 | Rate limit |
| 5xx | Unexpected. The caller should treat as "engine unavailable" (section 15.5) |

Guard failures return `{ "detail": "<reference message>", "code": "G002" }`. Zod failures list field paths.

### 11.6 Optional modules carried from the reference

Appeals (`POST /appeals`, `POST /appeals/{id}/resolve`: `denied → appeal_pending → paid | closed`), payments (`POST /payments`, flags underpayment when `paid < billed`, moves `submitted → paid`) and analytics (`GET /analytics/summary`: denial rate by payer, top five denial reasons, appeal success rate, average days to payment) are specified in the reference and are **not needed for the rules engine**. Build them in a later phase if the calling app wants them.

### 11.7 Cross-cutting API behaviour

- **Idempotency.** `POST /claims` accepts an `Idempotency-Key` header. The same key and body returns the original response; the same key with a different body returns 409. Keys expire after 24 hours.
- **Versioning.** URL-versioned (`/api/v1`). The response always includes `engine_version` and `plan_versions_used`, so any decision can be reproduced later.
- **Money format.** The wire uses decimal dollars as in the reference; internally integer cents.
- **Dates.** ISO `YYYY-MM-DD` only. Timestamps are UTC ISO-8601.

## 12. Data model

Tables marked **Ref** are the reference's, with the same columns. Tables marked **Ext** are added for the new rules.

| Table | Source | Key columns |
| --- | --- | --- |
| `users` | Ref | `id`, `email` (unique), `hashed_password`, `role` (`admin / biller / analyst`), `is_active` |
| `patients` | Ref | `id`, names, `dob`, `gender`, `province` (default `AB`), contact fields |
| `insurance_plans` | Ref | `id`, `payer_id` (unique: `AHCIP`, `GREENSHIELD`, …), `name`, `layer` (`public / private` + `auto` **\[Ext\]**), `plan_type` |
| `patient_insurances` | Ref | `patient_id`, `plan_id`, `member_id`, `health_card_number`, `group_number`, `effective_date`, `termination_date`, `priority`, `last_verified_at`, `last_eligibility` (JSON snapshot) |
| `claims` | Ref | `id`, `patient_id`, `plan_id`, `province`, `provider_billing_number`, `service_date`, `billed_amount`, `coverage_snapshot` (JSON), `status`, `denial_reason_code`. **\[Ext\]** adds `date_of_loss`, `received_date`, `idempotency_key` |
| `claim_lines` | Ref | `claim_id`, `service_code`, `diagnosis_code`, `units`, `amount`. **\[Ext\]** adds `service_date`, `prior_auth_number` |
| `claim_status_history` | Ref | `claim_id`, `from_status`, `to_status`, `reason_code`, `created_at` |
| `appeals`, `payments` | Ref | As in the reference |
| `provincial_rules` | Ref | `province`, `config` (JSON: billing regex, filing days, card regex) |
| `audit_logs` | Ref | `user_id`, `action` (`read / create / update / delete`), `resource` (e.g. `patient:12`), `ip_address`, `created_at` |
| `plan_versions` | Ext | `plan_id`, `version`, `effective_from`, `effective_to`, `definition` (jsonb, Zod-validated) |
| `accumulators` | Ext | `patient_id`, `plan_id`, `period_key`, `individual_deductible_met`, `family_deductible_met`, `oop_met`, `benefit_used` (jsonb), `version` for locking |
| `claim_adjudications` | Ext | `claim_id`, `seq`, `supersedes_id`, `outcome`, `decision` (jsonb), `trace` (jsonb), `engine_version`, `created_at`. Append-only. |
| `claim_line_results` | Ext | `adjudication_id`, `line_no`, `outcome`, money columns (cents), `reasons` (jsonb) |
| `claim_flags` | Ext | `claim_id`, `flag` (`REPROCESS_CANDIDATE`, `RECOVERY_REVIEW`), `created_at`, `cleared_at` |
| `overrides` | Ext | `claim_id`, `user_id`, `from_outcome`, `to_outcome`, `reason`, `created_at` |
| `api_keys` | Ext | `id`, `name`, `key_hash`, `scopes`, `last_used_at`, `revoked_at` |

Indexes to add: `claim_lines(claim_id)`, `claims(patient_id, service_date)` for frequency windows, `claims(provider_billing_number, service_date)` for duplicates, and a unique index on `plan_versions(plan_id, version)`. Money columns in the extension tables are integer cents.

## 13. Security, privacy and compliance

- **Use synthetic data only.** Everything payer-facing is mocked and no real AHCIP credentials exist **\[Ref\]**. Never load real patient data into a portfolio deployment.
- **Governing law: Health Information Act (HIA)**, not PHIPA (Ontario) or PIPEDA alone **\[Ref\]**. README, audit-log comments and compliance text must cite HIA. If this ever handles real health information, a custodian's obligations (consent, safeguards, privacy impact assessment, data location) need review by privacy counsel. This document is not legal advice.
- **Authentication.** JWT bearer with `sub`, `role`, `exp` and HS256 **\[Ref\]**. Service-to-service callers use `X-API-Key` **\[Ext\]**: keys are random 32 bytes, shown once, stored as a SHA-256 hash, scoped (`evaluate:write`, `claims:read`), revocable.
- **Authorization.** Role checks per route (table in section 11.1). Plan writes and overrides are admin-only.
- **Audit.** Every read and write of a patient or claim creates an `audit_logs` row. Overrides, reprocessing and plan edits are audited with the acting user and reason.
- **PHI hygiene.** pino redaction removes `health_card_number`, names, DOB and member IDs from logs. Request bodies are never logged. Error responses never echo a PHN.
- **Transport and storage.** TLS only; encrypted database storage; secrets only in environment variables (`.env` is git-ignored, `.env.example` is committed **\[Ref\]**).
- **Abuse controls.** Per-key rate limiting, request size limit, strict Zod schemas that reject unknown fields.
- **Decision support, not decision maker.** The engine suggests; an adjuster confirms. Overrides always record a reason.

## 14. Testing strategy

### 14.1 Tooling and conventions

- **Vitest** for unit and integration tests; **fast-check** for invariants; **Testcontainers** for a real Postgres 16 in API tests; `fastify.inject` for HTTP without opening a port.
- A `makeClaim(overrides)` factory mirrors the reference's `_ctx(**kw)` helper: a valid Alberta claim (`province: 'AB'`, billing number `123456`, PHN `123456789`, line `03.03A` / `J06.9`) that tests mutate one field at a time.
- A `FakeClock` makes every date test deterministic. In-memory implementations of the ports keep core tests free of I/O.
- Core coverage gate: 95% lines and branches on `packages/core`; 85% on the API.

### 14.2 Planned tests: 85

| # | Group | Count | What it proves |
| --- | --- | --- | --- |
| 1 | Reference parity | 6 | The reference's own tests and flow pass unchanged |
| 2 | Stage 1 validation | 12 | R001–R005, R009, R010 incl. boundaries |
| 3 | Eligibility and guards | 7 | G001–G003, mock payer, cache, R006 |
| 4 | Coverage | 7 | R007, R008, R016, R017 |
| 5 | Deductible / coinsurance / OOP | 9 | R011 maths and invariants |
| 6 | Frequency and duplicates | 7 | R012, R015 |
| 7 | Medical necessity | 6 | R013 modes and PEND behaviour |
| 8 | Coordination of benefits | 6 | R014 ordering and splitting |
| 9 | Bodily injury | 6 | Regime routing, Section B vs Care-First |
| 10 | Edge cases | 6 | Plan change, retroactive eligibility |
| 11 | Status machine | 5 | Legal and illegal transitions, history rows |
| 12 | API integration | 8 | Auth, evaluate, claims, errors, idempotency |
|  | **Total** | **85** |  |

### 14.3 Representative cases per group

**1. Reference parity (6).** Valid claim returns no errors. Bad billing number `ABC` flags R002. `patient_province: 'ON'` flags R010. Service code `Z999` flags R004. OHIP-shaped card `1234567890AB` flags R009 for an Alberta claim. End-to-end: register patient, verify, create claim (status `submitted`), post payment (`underpaid: false`).

**2. Stage 1 validation (12).** No lines → R001. Empty billing number → R001. Five-digit and seven-digit billing numbers → R002. Unknown ICD code → R003. Ontario-style `A001` → R004. Service exactly 90 days old passes; 91 days → R005. PHN with 8 digits, with 10 digits and with a trailing newline → R009. Multiple failures aggregate and `errors[0]` follows the fixed order.

**3. Eligibility and guards (7).** No insurance row → G001. Verification 25 hours old → G002; 23 hours passes. `TERM-9` and `OON-9` → G003 with the payer reason. `reverify` clears the cache. Service date before `effective_date` or after `termination_date` → R006.

**4. Coverage (7).** Code not in any coverage rule → default-deny `NOT_A_BENEFIT`. Private plan asked to pay an insured physician service → `INSURED_BY_AHCIP`. `MRI` without authorization → R008 deny; with `requested` status → PEND. Auto claim without date of loss → PEND. Service before date of loss → deny. Dollar maximum partly remaining → `PARTIAL`. Section B time limit exceeded → deny.

**5. Deductible (9).** Cases A–D from section 9.4 as table-driven tests. Family deductible satisfied zeroes the individual remainder. Two lines on one claim consume the deductible in order. Rounding on an odd-cent amount keeps `plan + member = eligible`. fast-check property: for any generated plan and amounts, all amounts are non-negative and the sum invariant holds.

**6. Frequency and duplicates (7).** Under the limit passes. Exactly at the limit passes; one over → `PARTIAL`. Zero remaining → deny. Calendar-year window resets on January 1. Rolling window slides. Late-submitted earlier visit is ordered by service date. Exact duplicate → `DUPLICATE_CLAIM`.

**7. Medical necessity (6).** Matching diagnosis passes. Mismatch → PEND with prompts. Mismatch with `hard: true` → deny. Protocol with classification `unknown` → PEND. Care-First claim on day 84 pre-approved; day 85 → PEND.

**8. COB (6).** Own plan beats dependent coverage. Birthday rule picks the earlier birthday. Tie → longer-held plan. Auto beats private. Secondary pays `min(benefit, remainder)` and combined never exceeds eligible. Undeterminable order → PEND.

**9. Bodily injury (6).** Accident Dec 31, 2026 → Section B version. Accident Jan 1, 2027 → Care-First version. Treatment in 2027 for a 2026 accident stays Section B. Mixed service dates within one claim. Missing classification. Benefit cap reached mid-claim.

**10. Edge cases (6).** Mid-year version change uses two versions on one claim. Carryover on versus off. Retro-add flags `REPROCESS_CANDIDATE` and reprocess writes a new adjudication. Retro-termination flags `RECOVERY_REVIEW` and changes no payment. Edmonton-midnight filing boundary. Concurrent claims cannot double-spend a deductible.

**11. Status machine (5).** Every legal transition in the table succeeds and writes history. `paid → submitted` and `draft → paid` return 409. `rejected → submitted` allowed. `pended → paid` allowed. `closed` is terminal.

**12. API integration (8).** Missing token → 401; wrong role → 403. `/evaluate` returns 200 with each outcome and persists nothing. `POST /claims` returns the reference 422 body on rejection. Unsupported province → 400. Zod rejects unknown fields and negative amounts. Same idempotency key returns the same claim; changed body → 409. `/health` returns `{"status":"ok"}`.

### 14.4 Definition of done for tests

All 85 pass in CI on every push; coverage gates met; the rule-order test (section 8.3) and the cache-clearing test exist and are not skipped.

## 15. Deployment and integration

### 15.1 Why API, and how the package option stays open

The calling app needs a network feature, so the primary deliverable is an HTTP API. Because `packages/core` has no I/O, it can still be published to npm later, or imported directly if the caller is also TypeScript.

### 15.2 Configuration **\[Ref\]** plus additions

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Neon in the reference deploy) |
| `REDIS_URL` | Optional. If unset or unreachable, the cache falls back to memory **\[Ref\]** |
| `SECRET_KEY`, `ALGORITHM` (`HS256`), `ACCESS_TOKEN_EXPIRE_MINUTES` (`1440`) | JWT settings **\[Ref\]** |
| `ENVIRONMENT` | `development` or `production` **\[Ref\]** |
| `PORT` | Required on Render and Railway **\[Ext\]** |
| `API_KEY_PEPPER`, `RATE_LIMIT_PER_MIN` | Service-key hashing and throttling **\[Ext\]** |

### 15.3 Container

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
EXPOSE 8000
CMD ["sh", "-c", "node apps/api/dist/server.js"]
```

The server binds `0.0.0.0` and reads `PORT` (default 8000). Local development uses `docker compose up --build` with `postgres:16` and `redis:7`, each with the reference's health checks, then `npm run db:migrate && npm run seed`.

### 15.4 Deploying (free tier, as in the reference)

1. Create a Neon project and copy the connection string.
2. Push the repo to GitHub.
3. Render → New → Web Service → connect the repo; it detects the Dockerfile.
4. Set `DATABASE_URL`, a long random `SECRET_KEY`, `ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, and optionally an Upstash `REDIS_URL`.
5. After the first deploy, run migrations and seed once from the shell: `npm run db:migrate && npm run seed`.
6. Swagger is live at `https://<service>.onrender.com/docs`.

Railway works the same way from the same Dockerfile and environment variables, and is a drop-in alternative if you prefer it; nothing in the code depends on the host.

> **Cold starts matter for a feature.** The reference notes the free Render service sleeps after about 15 minutes idle and takes about a minute to wake. That is fine for a demo link but not for a feature another app calls on a user's click. For real use, pick an always-on instance, or have the caller warm it up and apply the timeout policy in 15.5.

### 15.5 Calling it from another app

Treat the engine as an advisory dependency. Fail safe, never fail open.

```ts
export async function evaluateClaim(body: EvaluateRequest): Promise<EvaluateResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${process.env.RULES_API_URL}/api/v1/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.RULES_API_KEY! },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`rules-api ${res.status}`);
    return await res.json();
  } catch {
    // Engine unreachable: do NOT approve. Route to a human.
    return { outcome: 'PEND', primary_reason_code: 'ENGINE_UNAVAILABLE', review_prompts: ['Rules service unavailable'] } as EvaluateResponse;
  } finally {
    clearTimeout(timer);
  }
}
```

Recommendations for the caller: one retry on network errors only, an idempotency key on any create call, a circuit breaker after repeated failures, and storing `engine_version` and `plan_versions_used` with every decision it keeps.

## 16. Observability

- **Structured logs** (pino) with a request ID, route, status, latency and the decision outcome, never PHI.
- **Decision trace.** One entry per rule: `{ rule, stage, fired, outcome, inputs, durationMs }`. Stored in `claim_adjudications.trace` and returned on request. This is what lets an adjuster see *why*.
- **Metrics** (Prometheus format or host dashboard): requests by route and status, decisions by outcome, rule hit counts by ID, p50 / p95 latency, guard failures by code, cache hit rate.
- **Alerts:** error-rate spike, p95 latency over target, sudden rise in `PEND` or `ENGINE_UNAVAILABLE`.
- **Health:** `GET /health` is liveness. Add `GET /ready` that also checks the database.

## 17. Phased build checklist

Each phase ends with something demoable and a clean set of commits, as in the reference.

- [ ] **Phase 0 — Scaffold.** Monorepo, strict TS, Docker, `/health`, Drizzle schema and first migration, CI running Vitest.
- [ ] **Phase 1 — Reference core.** `PROVINCE_CONFIG`, reference code tables, R001–R005, R009, R010, `runRules`, state machine, tests group 1, 2 and 11.
- [ ] **Phase 2 — Eligibility.** Cache with memory fallback, mock payer scenarios, guard G001–G003, R006, snapshot on claim. Tests group 3.
- [ ] **Phase 3 — Plan definitions.** Zod schema, `plan_versions`, resolver by date, seed JSON for AHCIP, GREENSHIELD and the two auto versions. Plan endpoints.
- [ ] **Phase 4 — Coverage and money.** R007, R008, R016, R017, R011 with accumulators and locking. Tests groups 4 and 5.
- [ ] **Phase 5 — Limits and judgement.** R012, R015, R013, R014. Tests groups 6, 7 and 8.
- [ ] **Phase 6 — Edge cases.** Plan-change handling, reprocess endpoint, flags, overrides. Tests groups 9 and 10.
- [ ] **Phase 7 — API hardening.** `/evaluate`, API keys, rate limits, idempotency, audit log, OpenAPI. Tests group 12.
- [ ] **Phase 8 — Ship.** README with diagram, Render or Railway deploy, seeded demo, short walkthrough video.
- [ ] **Stretch.** Ontario engine (`OHIPEngine`, `HCP`-style record) to prove the strategy pattern; appeals, payments and analytics modules from the reference; EDI 837 parser; FHIR `Coverage` and `Claim` resources.

## 18. Glossary

| Term | Meaning |
| --- | --- |
| AHCIP | Alberta Health Care Insurance Plan, the public plan |
| Alberta Health | Ministry administering AHCIP and the fee schedule |
| AHS | Alberta Health Services, the care-delivery authority (not the payer) |
| SOMB | Schedule of Medical Benefits, Alberta's fee-for-service code list |
| PHN / ULI | Personal Health Number / Unique Lifetime Identifier, 9 digits in Alberta |
| ICD-10-CA | Canadian diagnosis coding standard (CIHI) |
| COB | Coordination of benefits between more than one plan |
| Section B | Accident-benefits section of the standard Alberta owner's auto policy (accidents before 2027) |
| Care-First | Alberta's no-fault auto injury system for accidents on or after January 1, 2027 |
| DTPR | Diagnostic and Treatment Protocols Regulation for minor injuries (pre-2027) |
| Date of loss | The date of the accident; drives regime selection |
| HIA | Health Information Act, Alberta's health privacy law |
| ERA / EOB | Electronic remittance advice / explanation of benefits |
| WCB | Workers' Compensation Board, handles work injuries (out of scope) |

## 19. Requirements specification

Priority uses MoSCoW: **M** = must (release blocker), **S** = should, **C** = could. *Phase* refers to the build checklist in section 17. Acceptance criteria are written so each can become a test in section 32.

### 19.1 Functional requirements

| ID | Requirement | Pri | Phase | Acceptance criterion |
| --- | --- | --- | --- | --- |
| FR-001 | The system MUST evaluate a claim submitted over HTTP and return an outcome of `ACCEPT`, `PARTIAL`, `PEND`, `DENY` or `REJECT`. | M | 7 | `POST /evaluate` returns 200 with an `outcome` in that set for every valid request |
| FR-002 | The system MUST validate Alberta identifiers: 6-digit billing number, 9-digit numeric PHN, SOMB service codes, ICD-10-CA diagnoses. **\[Ref\]** | M | 1 | R002, R003, R004, R009 fire on malformed input and not on valid input |
| FR-003 | The system MUST enforce the 90-day timely-filing limit with a strict comparison. **\[Ref\]** | M | 1 | 90 days old passes; 91 days fails |
| FR-004 | The system MUST reject claims for patients whose province differs from the billed province. **\[Ref\]** | M | 1 | R010 fires for `patient_province = ON` on an `AB` claim |
| FR-005 | The system MUST run all stage-1 rules, aggregate their errors in the fixed reference order, and record the first error code as the primary reason. **\[Ref\]** | M | 1 | Multi-error claim returns `R002, R003, R004, R009, R010` in that order |
| FR-006 | The system MUST block claim creation when coverage is unverified (G001), verified more than 24 hours ago (G002) or ineligible (G003). **\[Ref\]** | M | 2 | Each guard returns 422 with the reference message |
| FR-007 | The system MUST provide a deterministic mock payer keyed by member-ID prefix (`TERM`, `OON`, `PEND`, `INACT`). **\[Ref\]** | M | 2 | `TERM-9` yields `COVERAGE_TERMINATED` |
| FR-008 | The system MUST deny a line whose service date falls outside the member's coverage period (R006). **\[Ext\]** | M | 2 | Service before `effective_date` or after `termination_date` → `COVERAGE_PERIOD` |
| FR-009 | Plan definitions MUST be stored as versioned, schema-validated JSON and resolved by date. **\[Ext\]** | M | 3 | An invalid plan cannot be saved; two versions of one plan resolve by date |
| FR-010 | A service MUST be a listed benefit to be payable; absence of a rule means denial. **\[Ext\]** | M | 4 | Unlisted code → `NOT_A_BENEFIT` |
| FR-011 | The system MUST deny, or pend when requested, lines needing prior authorization that carry none (R008). **\[Ext\]** | M | 4 | `MRI` without number → deny; with `requested` → pend |
| FR-012 | The system MUST apply deductible, then coinsurance, then out-of-pocket cap, per line in order, keeping `plan + member = eligible`. **\[Ext\]** | M | 4 | Worked cases A–D (section 9.4) reproduce exactly |
| FR-013 | The system MUST enforce frequency limits in service-date order and pay partial units where some remain. **\[Ext\]** | M | 5 | One unit over limit → `PARTIAL` with `FREQUENCY_EXCEEDED` on the remainder |
| FR-014 | The system MUST deny exact duplicate services. **\[Ext\]** | M | 5 | Same patient, provider, code, date, units → `DUPLICATE_CLAIM` |
| FR-015 | The system MUST NOT deny on clinical grounds unless the plan marks the rule `hard`; otherwise it MUST pend with review prompts. **\[Ext\]** | M | 5 | Soft mismatch → `PEND` with `review_prompts` |
| FR-016 | The system MUST determine payer order and split payment between primary and secondary plans without exceeding 100% of the eligible amount. **\[Ext\]** | M | 5 | Secondary pays `min(normal benefit, remainder)` |
| FR-017 | The system MUST enforce benefit maximums and time limits and pay partially up to the remaining maximum. **\[Ext\]** | S | 4 | Cap reached mid-claim → `PARTIAL` with `MAX_REACHED` |
| FR-018 | Auto claims MUST be routed to the plan version in force on the **date of loss**. **\[Ext\]** | M | 4 | Dec 31, 2026 loss → Section B; Jan 1, 2027 loss → Care-First |
| FR-019 | Claim status MUST change only through the legal-transition table, with a history row per change. **\[Ref\]** | M | 1 | Illegal transition → 409; every legal one writes history |
| FR-020 | The system MUST support reprocessing after retroactive eligibility changes, flagging affected claims and never overwriting prior adjudications. **\[Ext\]** | M | 6 | Retro-add flags `REPROCESS_CANDIDATE`; reprocess adds a new adjudication row |
| FR-021 | Each line MUST be adjudicated against the plan version in force on its own service date. **\[Ext\]** | M | 6 | A claim spanning a July 1 change lists both versions in `plan_versions_used` |
| FR-022 | Every adjudication MUST be stored append-only with its rule trace and engine version. **\[Ext\]** | M | 7 | Re-reading a claim returns the exact original decision |
| FR-023 | Overrides of `PEND` or `DENY` MUST require a reason and be audited. **\[Ext\]** | M | 6 | Missing reason → 422; override writes `overrides` and `audit_logs` rows |
| FR-024 | `POST /claims` MUST honour an `Idempotency-Key`. **\[Ext\]** | S | 7 | Same key + body → same claim; same key + different body → 409 |
| FR-025 | The API MUST authenticate with JWT (roles) or API key (scopes) and authorise per route. **\[Ref + Ext\]** | M | 7 | 401 without credentials; 403 for a role without access |
| FR-026 | Reads and writes of patients and claims MUST create an audit row. **\[Ref\]** | M | 7 | `audit_logs` row with user, action, resource, IP |
| FR-027 | The API MUST publish OpenAPI documentation at `/docs`. **\[Ref\]** | S | 7 | `/docs` renders every endpoint |
| FR-028 | A request for a province with no billing engine MUST fail with 400. **\[Ref\]** | M | 1 | `No billing engine for XX` |
| FR-029 | The system SHOULD return a per-rule trace on request. **\[Ext\]** | S | 7 | `?trace=true` lists every rule evaluated with inputs |
| FR-030 | Plan creation and version publishing MUST be admin-only. **\[Ext\]** | M | 3 | Biller token → 403 on `POST /plans` |

### 19.2 Out-of-scope requirements (explicitly not promised)

Real payer transmission, payment execution, tort valuation, WCB adjudication, fraud scoring, and authoritative fee schedules.

## 20. Actors and use cases

| Actor | Description |
| --- | --- |
| Claims adjuster | Human decision-maker who acts on `PEND` and `DENY` outcomes |
| Calling application | The other app that sends claims to the engine as a feature |
| Plan administrator | Maintains plan definitions and versions |
| Billing clerk | Enters patients, coverage and claims |
| Operations engineer | Deploys, monitors and recovers the service |
| Auditor | Reviews decisions, overrides and access logs |

| ID | Use case | Actor | Main flow | Key alternates | Postcondition |
| --- | --- | --- | --- | --- | --- |
| UC-01 | Evaluate a claim (dry run) | Calling app | Send claim → engine resolves plans → runs stages 1–3 → returns decision and optional trace | Unknown province → 400; invalid body → 422; engine down → caller pends | Nothing persisted |
| UC-02 | Submit and adjudicate a claim | Billing clerk or calling app | Guard → create draft → rules → provincial formatting → status transition | Guard fails → 422; stage 1 fails → `rejected` + 422 body | Claim stored with adjudication and history |
| UC-03 | Review a pended claim | Adjuster | Open claim → read `review_prompts` and trace → decide → override or request information | Needs documents → status stays `pended` | Claim `paid`, `denied` or still `pended` |
| UC-04 | Override a decision | Adjuster (admin) | Select claim → choose new outcome → enter reason → confirm | No reason → 422 | `overrides` row; audit entry |
| UC-05 | Reprocess after retroactive change | Admin | Update coverage dates → engine flags affected claims → admin reprocesses | Retro-termination → `RECOVERY_REVIEW`, no automatic clawback | New adjudication row; old preserved |
| UC-06 | Publish a new plan version | Plan administrator | Upload JSON → schema validation → set `effective_from` → publish | Invalid JSON → 422 with paths; overlapping window → 409 | New immutable plan version |
| UC-07 | Verify eligibility | Billing clerk | Select insurance → verify → snapshot stored and cached | Cache hit returns stored answer; reverify clears cache first | `last_verified_at` and snapshot updated |
| UC-08 | Explain a past decision | Auditor | Fetch claim → read adjudication, trace, engine and plan versions | Plan version superseded → still readable | Decision reproducible |
| UC-09 | Survive an engine outage | Calling app | Timeout → return `PEND` with `ENGINE_UNAVAILABLE` → retry later | Retry succeeds → normal flow | No claim approved without engine |

## 21. Rule specification cards

Each rule is specified by the same card so a developer can implement it and a tester can verify it without reading code. *Fires when* is the exact condition. *Config* names where behaviour is tuned.

### 21.1 Stage 0 and Stage 1 **\[Ref\]**

| ID | Purpose | Inputs | Fires when | Output | Config | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| G001 | Ensure coverage was ever verified | `last_verified_at`, `last_eligibility` | Row missing, or either field empty | 422, `No verified coverage for this patient/plan` | — | T-019, T-020 |
| G002 | Ensure verification is recent | `last_verified_at`, now | Older than 24 hours | 422, `Coverage verification is stale — re-verify` | `GUARD_MAX_AGE_HOURS = 24` | T-021, T-022 |
| G003 | Ensure payer said eligible | `last_eligibility.eligible` | `false` | 422, `Patient is not eligible — claim blocked` | — | T-023 |
| R001 | Required fields | `lines`, `provider_billing_number` | No lines, or empty billing number | `R001` (one error per cause) | — | T-007, T-008 |
| R002 | Billing-number format | `province`, billing number | Province configured and regex `^\d{6}$` fails | `R002 Billing number invalid for AB` | `PROVINCE_CONFIG` | T-009, T-010 |
| R003 | Diagnosis code validity | each `diagnosis_code` | Code not in the ICD-10-CA set | `R003 Unknown ICD-10-CA code X` (per line) | ICD set | T-011 |
| R004 | Service code validity | `province`, each `service_code` | Code absent from that province's table (empty table = all absent) | `R004 Unknown AHCIP SOMB code X` (per line) | `SERVICE_CODES_BY_PROVINCE` | T-004, T-012 |
| R005 | Timely filing | `service_date`, `received_date` | `service_date < received_date − limit` | `R005 Past the timely-filing limit` | `filingLimitDays` (AB 90) | T-013, T-014 |
| R009 | Health-card format | PHN | Province configured and PHN empty or regex `^\d{9}$` fails | `R009 Invalid AB health card` | `PROVINCE_CONFIG` | T-005, T-015–T-017 |
| R010 | Residency routing | `patient_province`, `province` | They differ | `R010 Patient (ON) cannot be billed to AB` | — | T-003 |

### 21.2 Stage 2: eligibility and coverage **\[Ext\]**

| ID | Purpose | Inputs | Fires when | Output | Config | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| R006 | Coverage in force on service date | service date, `effective_date`, `termination_date`, plan window | Date outside any of the three ranges | DENY `COVERAGE_PERIOD` | plan `effectiveFrom/To` | T-025 |
| R007 | Service is a benefit | line code/category, `coverage[]` | No matching rule, or match with `covered: false` | DENY `NOT_A_BENEFIT` or the rule's reason (e.g. `INSURED_BY_AHCIP`) | `coverage[]` | T-026, T-027 |
| R008 | Prior authorization | line code/category, `priorAuth[]`, auth fields | Listed and no `prior_auth_number` | DENY `PRIOR_AUTH_REQUIRED`; PEND if status `requested` | `priorAuth[]` | T-028, T-029 |
| R016 | Regime routing for auto | `date_of_loss`, service date, plan versions | Auto claim without date of loss; or service before loss | PEND `DATE_OF_LOSS_REQUIRED`; DENY `SERVICE_BEFORE_LOSS` | plan windows | T-030, T-031, T-061–T-063 |

### 21.3 Stage 3: adjudication **\[Ext\]**

| ID | Purpose | Inputs | Fires when | Output | Config | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| R015 | Duplicate service | patient, provider, code, date, units, history | Identical non-rejected service exists | DENY `DUPLICATE_CLAIM` | — | T-048 |
| R012 | Frequency limits | history units in window, line units | Used + requested > `maxUnits`, or interval < `minDaysBetween` | PARTIAL or DENY `FREQUENCY_EXCEEDED` / `FREQUENCY_INTERVAL` | `frequency[]` | T-042–T-047 |
| R013 | Medical necessity | diagnosis, code, classification, date of loss | Mismatch, beyond protocol, outside pre-approval window, or unknown classification | PEND `NECESSITY_REVIEW`; DENY `NECESSITY_MISMATCH` only if `hard` | `medicalNecessity[]` | T-049–T-054, T-065 |
| R017 | Maximums and time limits | paid-to-date, date of loss, caps | Cap exhausted or time limit passed | PARTIAL `MAX_REACHED`; DENY `TIME_LIMIT_EXCEEDED` | `benefitMaximums[]` | T-032, T-066 |
| R011 | Cost sharing | eligible amount, accumulators | Always evaluated; never rejects | Deductible, coinsurance, plan and member amounts | deductible, coinsurance, OOP | T-033–T-041 |
| R014 | Coordination of benefits | all coverages, relationship, birthdays, loss | Order undeterminable | PEND `COB_ORDER_UNDETERMINED`; otherwise primary/secondary split | `cob` | T-055–T-060 |

### 21.4 Stage 1 boundary examples

| Rule | Input | Result |
| --- | --- | --- |
| R002 | `123456` | pass |
| R002 | `12345`, `1234567`, `ABC`, `  123456 ` | fail (no silent trimming) |
| R009 | `123456789` | pass |
| R009 | `12345678`, `1234567890`, `1234567890AB`, `123456789\n` | fail |
| R004 | `03.03A` | pass for AB |
| R004 | `A001`, `Z999`, `3.03A` | fail for AB |
| R005 | received 2026-10-13, service 2026-07-15 (90 days) | pass |
| R005 | received 2026-10-13, service 2026-07-14 (91 days) | fail |
| R010 | `patient_province = AB` | pass |
| R010 | `patient_province = ON` or empty | fail |

## 22. Reason-code and error catalogue

Every code the engine can emit. *Adjuster action* is what a person should do next; *Retry* says whether resubmitting the same data can succeed.

| Code | From | Outcome | HTTP | Meaning | Adjuster action | Retry |
| --- | --- | --- | --- | --- | --- | --- |
| G001 | Guard | Block | 422 | No verified coverage on file | Run eligibility verification | After verify |
| G002 | Guard | Block | 422 | Verification older than 24 h | Reverify | After reverify |
| G003 | Guard | Block | 422 | Payer reports not eligible | Check payer reason below | No |
| COVERAGE\_TERMINATED / OUT\_OF\_NETWORK / COVERAGE\_PENDING / INACTIVE\_PLAN | Mock payer **\[Ref\]** | Block with G003 | 422 | Payer-supplied reason | Contact member or payer | Depends |
| R001 | Stage 1 | REJECT | 422 | Missing lines or billing number | Correct and resubmit | After fix |
| R002 | Stage 1 | REJECT | 422 | Billing number not 6 digits | Correct billing number | After fix |
| R003 | Stage 1 | REJECT | 422 | Unknown ICD-10-CA code | Correct diagnosis | After fix |
| R004 | Stage 1 | REJECT | 422 | Not a valid SOMB code for AB | Correct service code | After fix |
| R005 | Stage 1 | REJECT | 422 | Beyond 90-day filing limit | Confirm dates; consider plan-specific relief | No |
| R009 | Stage 1 | REJECT | 422 | PHN not 9 digits | Correct health number | After fix |
| R010 | Stage 1 | REJECT | 422 | Patient not an Alberta resident for this billing | Bill the correct province | No |
| COVERAGE\_PERIOD | R006 | DENY | 201 / 200 | Not covered on service date | Check coverage dates; look for retro changes | After retro change |
| NOT\_A\_BENEFIT | R007 | DENY | 201 / 200 | Service not a listed benefit | Confirm plan wording | No |
| INSURED\_BY\_AHCIP | R007 | DENY | 201 / 200 | Insured physician service belongs to AHCIP | Bill AHCIP | No |
| PRIOR\_AUTH\_REQUIRED | R008 | DENY | 201 / 200 | Authorization missing | Obtain authorization | After auth |
| DATE\_OF\_LOSS\_REQUIRED | R016 | PEND | 201 / 200 | Auto claim has no date of loss | Obtain date of loss | After info |
| SERVICE\_BEFORE\_LOSS | R016 | DENY | 201 / 200 | Service predates the accident | Verify dates | After fix |
| TIME\_LIMIT\_EXCEEDED | R017 | DENY | 201 / 200 | Treatment incurred past the time limit | Review for exceptions | No |
| MAX\_REACHED | R017 | PARTIAL / DENY | 201 / 200 | Benefit maximum exhausted | Inform member of exhausted benefit | No |
| DUPLICATE\_CLAIM | R015 | DENY | 201 / 200 | Same service already billed | Confirm not a legitimate repeat | No |
| FREQUENCY\_EXCEEDED | R012 | PARTIAL / DENY | 201 / 200 | Annual or rolling limit used | Check plan limit and history | After limit period |
| FREQUENCY\_INTERVAL | R012 | DENY | 201 / 200 | Services too close together | Confirm dates | After interval |
| NECESSITY\_REVIEW | R013 | PEND | 201 / 200 | Needs clinical judgement | Review prompts; request notes | After review |
| NECESSITY\_MISMATCH | R013 | DENY | 201 / 200 | Hard mismatch of diagnosis and service | Confirm diagnosis | After fix |
| COB\_ORDER\_UNDETERMINED | R014 | PEND | 201 / 200 | Cannot tell which plan pays first | Determine order; record | After info |
| COB\_PRIMARY\_PENDING | R014 | PEND | 201 / 200 | Primary has not adjudicated | Submit to primary first | After primary |
| ENGINE\_UNAVAILABLE | Caller | PEND | — | Rules service unreachable | Wait or review manually | Yes |
| REPROCESS\_CANDIDATE | Flag | Flag | — | Earlier denial may now pass after a retro change | Reprocess | — |
| RECOVERY\_REVIEW | Flag | Flag | — | Paid claim may fall in a terminated period | Manual recovery decision | — |
| APPEAL\_UPHELD | Appeals **\[Ref\]** | closed | 200 | Appeal rejected | None | No |
| UNKNOWN | Appeals **\[Ref\]** | — | — | Denied claim had no stored reason | Investigate | — |

**HTTP error codes:** 400 unsupported province, 401 unauthenticated, 403 forbidden, 404 not found, 409 illegal transition or idempotency conflict, 422 validation / guard / stage-1 rejection, 429 rate limit, 5xx server error. For `/evaluate`, rule outcomes are 200; for `POST /claims`, a stage-1 rejection is 422 (reference behaviour) and other outcomes are 201.

## 23. API reference

All endpoints are under `/api/v1`. Bodies are JSON, field names `snake_case`. Authentication: `Authorization: Bearer <jwt>` or `X-API-Key: <key>`.

### 23.1 `POST /evaluate` — request

| Field | Type | Req | Constraints |
| --- | --- | --- | --- |
| `patient_id` | integer | yes | Must exist |
| `plan_id` | integer | yes | Must exist and be linked to the patient |
| `province` | string | yes | `AB` (or a registered engine key); unsupported → 400 |
| `provider_billing_number` | string | yes | Exactly as sent; validated by R002 |
| `service_date` | date | yes | ISO date, not in the future |
| `received_date` | date | no | Defaults to today (Edmonton) |
| `date_of_loss` | date | auto only | On or before `service_date` |
| `injury_classification` | enum | no | `minor`, `non_minor`, `unknown` (default) |
| `lines[]` | array | yes | 1–50 items |
| `lines[].service_code` | string | yes | Max 12 characters |
| `lines[].diagnosis_code` | string | yes | Max 10 characters |
| `lines[].units` | integer | no | 1–999, default 1 |
| `lines[].amount` | number | yes | Dollars per unit, ≥ 0, 2 decimals |
| `lines[].service_date` | date | no | Line-level date overriding the claim date |
| `lines[].prior_auth_number` | string | no | Satisfies R008 |
| `lines[].prior_auth_status` | enum | no | `requested` turns an R008 denial into a pend |
| `history` | object / null | no | Caller-supplied prior lines and accumulators |
| `prior_accumulators` | object / null | no | Transferred deductible credit from a prior carrier |

Unknown fields are rejected with 422.

### 23.2 `POST /evaluate` — response

| Field | Type | Notes |
| --- | --- | --- |
| `outcome` | enum | `ACCEPT`, `PARTIAL`, `PEND`, `DENY`, `REJECT` |
| `primary_reason_code` | string / null | First error or denial code |
| `errors[]` | `{code, message}` | Stage-1 errors and denials |
| `billed_amount`, `plan_pays_total`, `member_pays_total` | number | Dollars |
| `lines[]` | object | `line_no`, `outcome`, `eligible_amount`, `deductible_applied`, `coinsurance_amount`, `plan_pays`, `member_pays`, `reasons[]` |
| `review_prompts[]` | string\[\] | Present on `PEND` |
| `suggested_status` | enum | Maps to the status machine |
| `plan_versions_used[]` | `{plan_id, version}` | Reproducibility |
| `payers[]` | object | Per-plan split when COB applies, in payment order |
| `trace[]` | object | Only with `?trace=true` |
| `engine_version` | string | Semantic version |

### 23.3 Other endpoints

| Endpoint | Request essentials | Success | Errors |
| --- | --- | --- | --- |
| `POST /auth/login` | form `username`, `password` | 200 `{access_token, token_type}` | 401 |
| `POST /auth/register` | `email`, `password`, `role` | 201 user | 409 duplicate email |
| `POST /patients` | names (min 2 chars), `dob`, `gender`, `province` (default `AB`), optional contact, nested `insurance` (`payer_id`, `member_id`, `health_card_number`, `effective_date`, `termination_date`, `priority`) | 201 `{id, …}` | 422, 404 unknown payer |
| `POST /insurance/verify`, `/reverify` | `patient_insurance_id` | 200 eligibility response | 404 |
| `POST /claims` | As evaluate, plus `Idempotency-Key` header | 201 claim with `decision` | 422 guard / stage 1, 409, 404 |
| `GET /claims/{id}` | — | 200 claim, lines, latest adjudication | 404 |
| `POST /claims/{id}/status` | `to_status`, `reason_code?` | 200 claim | 409 illegal transition |
| `POST /claims/{id}/reprocess` | `reason` | 201 new adjudication | 404, 409 if status terminal |
| `POST /claims/{id}/override` | `to_outcome`, `reason` (min 10 chars) | 200 claim | 403, 422 |
| `POST /plans` | Full `PlanDefinition` | 201 | 403, 422 with Zod paths |
| `POST /plans/{id}/versions` | `PlanDefinition`, `effective_from` | 201 | 409 overlapping window |
| `GET /rules` | — | 200 catalogue | — |

### 23.4 OpenAPI skeleton (abridged)

```yaml
openapi: 3.1.0
info: { title: Alberta Insurance Rules Engine, version: 1.0.0 }
servers: [ { url: /api/v1 } ]
security: [ { bearerAuth: [] }, { apiKeyAuth: [] } ]
paths:
  /evaluate:
    post:
      summary: Dry-run adjudication of a claim
      parameters: [ { name: trace, in: query, schema: { type: boolean } } ]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/EvaluateRequest' } } } }
      responses:
        '200': { description: Decision, content: { application/json: { schema: { $ref: '#/components/schemas/Decision' } } } }
        '400': { $ref: '#/components/responses/UnsupportedProvince' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '422': { $ref: '#/components/responses/ValidationError' }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
    apiKeyAuth: { type: apiKey, in: header, name: X-API-Key }
```

In the build the full document is generated from the Zod schemas, so it cannot drift from validation.

## 24. Data dictionary

| Entity.field | Type | Required | Validation / format | Source and use |
| --- | --- | --- | --- | --- |
| Claim.`province` | enum | yes | Registered engine key | Selects config, code table, engine **\[Ref\]** |
| Claim.`provider_billing_number` | string | yes | 6 digits for AB; not trimmed | R001, R002 |
| Claim.`service_date` | date | yes | ISO; not future | R005, R006, plan version |
| Claim.`received_date` | date | yes | ISO; ≥ `service_date` | Filing clock end |
| Claim.`date_of_loss` | date | auto | ISO; ≤ service date | R016, R017, R013 |
| Claim.`billed_amount` | cents | derived | Σ `amount × units` | Reporting |
| Claim.`status` | enum | yes | Eight states | Status machine |
| Claim.`denial_reason_code` | string | no | Set on `denied` / `rejected` | Analytics |
| Claim.`coverage_snapshot` | JSON | yes | Frozen eligibility response | Evidence of what the payer said |
| Line.`service_code` | string | yes | SOMB `NN.NNX` for AB | R004, R007 |
| Line.`diagnosis_code` | string | yes | ICD-10-CA | R003, R013 |
| Line.`units` | integer | yes | 1–999 | R011, R012 |
| Line.`amount` | cents | yes | ≥ 0 | R011 |
| Patient.`province` | enum | yes | Default `AB` | R010 |
| Insurance.`health_card_number` | string | public | 9 digits for AB | R009 |
| Insurance.`effective_date`, `termination_date` | date | yes / no | Termination ≥ effective | R006 |
| Insurance.`priority` | enum | yes | `primary`, `secondary` | R014 |
| Insurance.`last_verified_at` | timestamp | no | UTC | G001, G002 |
| Accumulator.`individual_deductible_met` | cents | yes | 0 ≤ x ≤ deductible | R011 |
| Accumulator.`family_deductible_met` | cents | yes | ≥ 0 | R011 |
| Accumulator.`oop_met` | cents | yes | ≥ 0 | R011 |
| Accumulator.`benefit_used` | JSON | yes | Map of category → cents | R017 |
| Decision.`outcome` | enum | yes | Five values | Caller routing |
| Decision.`trace[]` | array | optional | One entry per rule | Explainability |
| Decision.`engine_version` | semver | yes | `MAJOR.MINOR.PATCH` | Reproducibility |

## 25. Sequence flows

### 25.1 Evaluate a claim (UC-01)

```
Calling app        API (Fastify)        Core engine           Postgres / Cache
    |  POST /evaluate  |                     |                        |
    |----------------->| authenticate, Zod   |                        |
    |                  |-- load patient, coverage, plan versions ---->|
    |                  |<-------------------------------------------- |
    |                  | evaluateClaim(ctx, ports)                    |
    |                  |-------------------->| stage 1 (R001-R010)    |
    |                  |                     | stage 2 (R006-R008,R016)
    |                  |                     |-- history, accumulators->|
    |                  |                     |<-------------------------|
    |                  |                     | stage 3 (R015,R012,R013,R017,R011,R014)
    |                  |<-- Decision + trace |                        |
    |<-- 200 Decision -|  (nothing persisted)                         |
```

### 25.2 Create and adjudicate a claim (UC-02) **\[Ref flow\]**

```
Client     API                 Guard/Eligibility     Core engine        DB
  | POST /claims |                  |                    |              |
  |------------->| Idempotency-Key check ---------------------------->|
  |              |-- assertEligible -->| G001-G003        |              |
  |              |   fail -> 422 {detail, code}           |              |
  |              |-- create claim (draft) + lines + coverage_snapshot -->|
  |              |-- evaluateClaim --------------------->|              |
  |              |   REJECT: draft->submitted->rejected, 422 body       |
  |              |   DENY/PEND/ACCEPT: engine.formatSubmission()        |
  |              |-- transition(submitted | denied | pended) ---------->|
  |              |-- store adjudication (append-only) + audit row ----->|
  |<-- 201 ClaimOut + decision                                          |
```

### 25.3 Reprocess after a retroactive change (UC-05)

```
Admin       API                 Core engine                DB
  | update coverage dates ----------------------------------->|
  |             |-- find claims in affected range ------------->|
  |             |-- flag: REPROCESS_CANDIDATE / RECOVERY_REVIEW ->|
  | POST /claims/{id}/reprocess |                             |
  |------------>|-- replay accumulators from earliest date ---->|
  |             |-- evaluateClaim(new coverage dates) -------->|
  |             |-- new adjudication row (supersedes_id) ------>|
  |<-- 201 new adjudication; previous row untouched            |
```

### 25.4 Caller resilience (UC-09)

```
Caller            Rules API
  |-- POST /evaluate (timeout 8 s) -->|
  |   no answer / 5xx                 |
  |-- return PEND ENGINE_UNAVAILABLE  |   never ACCEPT on failure
  |-- one retry on network error ---->|
  |-- circuit opens after N failures; claims queue for manual review
```

## 26. Architecture decision records

Each record states the context, the choice, the alternatives rejected and the consequences, so a later reader can tell *why* before changing it. All are **Accepted** unless noted.

| ID | Decision | Context and rationale | Alternatives rejected | Consequences |
| --- | --- | --- | --- | --- |
| ADR-001 | The rule engine is a pure function with ports for data | Deterministic tests, reproducible decisions, and the option to publish to npm | Engine that queries the database directly | Slightly more wiring (repositories); tests need no database |
| ADR-002 | Money is integer cents internally | Floating-point rounding errors are unacceptable in adjudication | `number` dollars as in the reference; decimal library | Conversion at the API edge; invariants testable exactly |
| ADR-003 | Wire format stays `snake_case` | Compatibility with the reference and any existing Python callers | camelCase JSON | Explicit mapper layer between wire and domain |
| ADR-004 | Fastify + Zod + Drizzle | One schema yields validation, types and OpenAPI; typed SQL without heavy ORM | Express + manual validation; Prisma; NestJS | Smaller ecosystem than Nest, less ceremony |
| ADR-005 | Plans are versioned JSON (jsonb) validated by Zod | Benefit design changes often and must be auditable | Hardcoded plan classes; one table column per setting | Rule code is generic; bad plans cannot be saved; versions immutable |
| ADR-006 | Judgement calls return `PEND`, not `DENY` | Clinical necessity and COB ambiguity need human review | Auto-deny with appeal | More manual review volume; fewer wrongful denials |
| ADR-007 | Coverage is default-deny | A benefit must be listed to be paid | Default-allow with exclusions | Plan authors must list benefits; safer failure mode |
| ADR-008 | Adjudications are append-only | Audit, reproducibility, retroactive changes | Update the claim row in place | More storage; full history; `supersedes_id` chain |
| ADR-009 | Regime for auto claims is chosen by date of loss | Mirrors how the Section B / Care-First transition applies | Service date or received date | Needs date of loss on every auto claim (R016 pends without it) |
| ADR-010 | Unknown province fails closed with 400 | The reference silently skipped R002/R009 for unknown provinces | Skip rules and continue | Callers see a clear error instead of unvalidated acceptance |
| ADR-011 | npm-workspaces monorepo with `core` and `api` | Keep the engine publishable and the API thin | Single package; separate repos | Slightly more build config |
| ADR-012 | Postgres 16 with Redis optional and memory fallback | Matches the reference and its free-tier deploy | SQLite; mandatory Redis | In-memory cache is per instance (see RSK-05) |
| ADR-013 | Edmonton calendar date for all "day" logic | Filing and windows are legal-calendar concepts | UTC dates | Needs an injected clock and date-only helpers |
| ADR-014 | Reference defects are decided explicitly, not inherited | See section 3.3 | Copy reference verbatim | Documented deviations, all covered by tests |

## 27. Non-functional specification

Targets are for a single always-on instance (1 vCPU, 512 MB) with a managed Postgres. They are goals to verify with a load test (T-NFR in section 32.3), not guarantees.

| ID | Category | Requirement | Target |
| --- | --- | --- | --- |
| NFR-001 | Performance | `POST /evaluate` latency, excluding external payer calls | p95 ≤ 300 ms, p99 ≤ 800 ms at 25 requests/s |
| NFR-002 | Performance | Pure engine evaluation of a 10-line claim with history preloaded | p95 ≤ 20 ms |
| NFR-003 | Performance | `POST /insurance/verify` including mock payer delay | Dominated by the 200–600 ms mock delay **\[Ref\]** |
| NFR-004 | Availability | Monthly availability on a paid always-on instance | ≥ 99.5% (the free tier has no target) |
| NFR-005 | Scalability | Horizontal scale | Stateless instances; shared Postgres and Redis |
| NFR-006 | Recoverability | Recovery targets | RPO ≤ 24 h, RTO ≤ 4 h |
| NFR-007 | Determinism | Same claim, history, plan versions and clock | Identical decision |
| NFR-008 | Security | API hardening | Aligned with the OWASP API Security Top 10; no unauthenticated data routes |
| NFR-009 | Security | Secrets | Only in environment variables; rotation procedure OPS-04 |
| NFR-010 | Privacy | PHI in logs | None; redaction tested |
| NFR-011 | Auditability | Completeness | 100% of patient and claim reads and writes audited |
| NFR-012 | Quality | Automated test coverage | Core ≥ 95% lines and branches; API ≥ 85% |
| NFR-013 | Maintainability | Adding a province | One engine class, one config entry, one code table; no router changes |
| NFR-014 | Compatibility | API evolution | No breaking change inside `/api/v1`; breaking change = `/api/v2` |
| NFR-015 | Operability | Observability | Request ID on every log line; metrics in section 16 |
| NFR-016 | Limits | Request size and rate | 256 KB body, 120 requests/min per key (configurable) |
| NFR-017 | Portability | Runtime | Any Docker host with Postgres 16 |
| NFR-018 | Retention | Data retention | Set by custodian policy; engine supports configurable retention jobs |

### 27.1 Capacity sketch

A claim has about 3 lines, so 100,000 claims a year is about 300,000 line rows and an equal number of result rows. With a stored trace averaging 3 KB, adjudications add roughly 300 MB a year. That fits a small managed Postgres; plan retention before it matters.

## 28. Operations runbook

### 28.1 Environments

| Environment | Purpose | Data | Deploy trigger |
| --- | --- | --- | --- |
| Local | Development | Seeded synthetic | `docker compose up` |
| Staging | Pre-release checks, contract tests with the calling app | Synthetic | Merge to `main` |
| Production | Live | Per custodian policy | Tagged release |

### 28.2 Standard procedures

| ID | Procedure | Steps |
| --- | --- | --- |
| OPS-01 | Deploy | 1. CI green (all 85 tests, coverage gates). 2. Build image tagged with git SHA. 3. Run migrations against staging, smoke test `/health`, `/ready`, one evaluate per outcome. 4. Promote the same image to production. 5. Watch error rate and p95 for 30 minutes. |
| OPS-02 | Database migration | Migrations are forward-only and backward-compatible for one release (add columns before using them; drop only a release later). Take a backup first. Run `npm run db:migrate`. |
| OPS-03 | Rollback | Redeploy the previous image tag. If the release included a migration, it is compatible by OPS-02, so no schema rollback is needed. Plan versions are immutable and need no rollback. |
| OPS-04 | Rotate secrets | `SECRET_KEY`: deploy a new value (existing JWTs expire within 24 h; announce a re-login). API keys: issue a new key, switch the caller, revoke the old one (`revoked_at`). |
| OPS-05 | Publish a plan version | Validate JSON locally with the schema, review against the plan documents, test in staging with the golden corpus, publish with a future `effective_from`, confirm `GET /plans/{id}` shows it. |
| OPS-06 | Backup and restore | Enable daily backups and, where the host supports it, point-in-time restore. Quarterly: restore into staging and run the golden corpus to prove it works. |
| OPS-07 | Warm-up (free tier) | Call `/health` before a demo; expect up to about a minute after idle. |

### 28.3 Incident playbooks

| Symptom | Likely causes | Actions |
| --- | --- | --- |
| Spike in `REJECT` | A caller started sending a bad format (e.g. OHIP-shaped card) | Check `primary_reason_code` distribution; contact the caller |
| Spike in `PEND` | Engine unavailable upstream, new plan lacks `coverage` or `cob` data, missing date of loss | Group by reason code; fix plan JSON or caller payload |
| Sudden rise in `DENY` `COVERAGE_PERIOD` | Retroactive coverage change not loaded | Load coverage change; flag and reprocess (UC-05) |
| p95 latency high | Slow history query, missing index, Redis down | Check indexes in section 12, DB CPU, cache hit rate |
| 5xx errors | Bad deploy, DB unreachable | Roll back (OPS-03); check `/ready` |
| Eligibility results inconsistent between instances | In-memory cache per instance when Redis is unset | Set `REDIS_URL`, or run a single instance |
| 401 from the caller | Revoked or expired key / JWT | Rotate (OPS-04) |
| Wrong payment amount reported | Plan version or accumulator error | Pull the adjudication and trace; compare `plan_versions_used`; reprocess after fixing |
| Suspected PHI in logs | Redaction gap | Stop shipping logs, purge, add redaction test, follow the custodian's incident process |

### 28.4 Release checklist

- [ ] All tests pass and coverage gates are met
- [ ] Golden-corpus run shows no unexplained outcome changes
- [ ] OpenAPI diff reviewed (no breaking change in v1)
- [ ] Migration reviewed and backward-compatible
- [ ] Changelog entry written; `engine_version` bumped
- [ ] Runbook and this document updated if behaviour changed

## 29. Governance and change management

### 29.1 Change classes

| Change | Examples | Approval | Required evidence | Version impact |
| --- | --- | --- | --- | --- |
| Plan data | New deductible, new benefit, new Care-First window | Plan owner and one reviewer | Schema validation, golden corpus diff, staging test | New immutable plan version; engine unchanged |
| Reference data | New SOMB codes, ICD-10-CA update | Data owner | Source citation (Alberta Health / CIHI), tests for added codes | Engine MINOR (or data-only PATCH) |
| Rule logic | Change to R011 order, new rule | Engineering lead | New and updated tests, ADR if design-level | MINOR if additive, MAJOR if outcomes change for existing valid input |
| Schema | New table or column | Engineering lead | Backward-compatible migration | MINOR |
| API contract | New field or endpoint | Engineering lead | OpenAPI diff, contract tests | Additive = MINOR; breaking = new `/api/vN` |

### 29.2 Versioning policy

- The engine follows semantic versioning (`MAJOR.MINOR.PATCH`). The version is stamped on every decision.
- A **golden corpus** of at least 50 representative claims with expected decisions is kept in the repository. Any change that alters an outcome must be explained in the changelog and approved; unexplained diffs block release.
- Deprecations are announced in the changelog and honoured for at least 90 days before removal in a new major API version.
- Plan versions are never edited; a correction is a new version with a later `effective_from`, plus a reprocess where history is affected.

### 29.3 Privacy and compliance control map

This maps engineering controls to the Alberta **Health Information Act** themes. It is a design aid, not legal advice; any use with real health information needs review by the custodian's privacy officer.

| Control theme | Implementation | Evidence |
| --- | --- | --- |
| Access limited to those who need it | Roles and scoped API keys; plan writes admin-only | Auth tests, role matrix (11.1) |
| Accountability and audit | `audit_logs` for reads and writes; override and plan-change records | Audit completeness test |
| Minimum necessary data | Evaluate accepts only fields needed for adjudication; no free-text clinical notes stored | Schema review |
| Safeguards | TLS, encrypted storage, secret handling, log redaction | Redaction tests, deployment config |
| Retention and disposal | Configurable retention jobs | NFR-018, runbook |
| Incident response | Playbook for suspected PHI exposure | Section 28.3 |
| Synthetic data in non-production | Seed script generates only fake patients | Seed script review |

### 29.4 Roles and responsibilities (RACI)

| Activity | Plan owner | Engineering lead | Operations | Privacy officer |
| --- | --- | --- | --- | --- |
| Publish plan version | A/R | C | I | I |
| Change rule logic | C | A/R | I | I |
| Deploy to production | I | A | R | I |
| Handle privacy incident | I | R | R | A |
| Approve data-retention policy | C | C | I | A/R |

*R = responsible, A = accountable, C = consulted, I = informed.*

## 30. Risk register

Likelihood (L) and impact (I) are rated H / M / L. Review at every minor release.

| ID | Risk | L | I | Mitigation | Early warning |
| --- | --- | --- | --- | --- | --- |
| RSK-01 | Care-First regulations change after this design | H | H | All windows and limits live in plan JSON; version by date of loss; review on each regulatory update | Government of Alberta or IBC notices |
| RSK-02 | Illustrative code tables mistaken for authoritative | M | H | Labelled illustrative everywhere; load real SOMB and fee guides before production; tests assert table source | Unknown-code reject rate |
| RSK-03 | Engine diverges from the AHS reference over time | M | M | Reference-parity test group; traceability matrix; ADR-014 | Parity test failures |
| RSK-04 | Money rounding or invariant bug (plan + member ≠ eligible) | L | H | Integer cents; property-based tests; invariant asserted at runtime in non-production | fast-check failures |
| RSK-05 | Per-instance memory cache gives inconsistent eligibility when Redis is unset and more than one instance runs | M | M | Run one instance without Redis, or set `REDIS_URL`; documented in runbook | Differing answers for one member |
| RSK-06 | Two simultaneous claims consume the same deductible | M | H | Row lock on accumulator inside the adjudication transaction; concurrency test T-072 | Accumulator exceeds deductible |
| RSK-07 | PHI appears in logs or error messages | L | H | Redaction, no body logging, redaction test, error messages never echo PHN | Log scan |
| RSK-08 | Free-tier cold start breaks a feature that depends on the API | H | M | Always-on instance for real use; caller timeout and `PEND` fallback | Timeouts in caller metrics |
| RSK-09 | Adjusters over-trust automated outcomes (automation bias) | M | H | `PEND` for judgement; trace shown with every decision; override requires reason; sampling review of `ACCEPT` | Low override and review rates |
| RSK-10 | Plan misconfiguration silently changes payments | M | H | Zod validation, golden-corpus diff on every plan change, staging test, immutable versions | Unexpected outcome diffs |
| RSK-11 | Scope creep into payments, fraud and tort valuation | M | M | Out-of-scope list (1.3, 19.2); phases in section 17 | Unplanned work items |
| RSK-12 | Licensing or terms for full ICD-10-CA and SOMB data | M | M | Use subsets for the portfolio; obtain data under proper terms before production | Legal review |
| RSK-13 | Dependency vulnerability or supply-chain issue | M | M | Lockfile, automated audit in CI, pinned versions, minimal dependencies | Audit alerts |
| RSK-14 | Clock or timezone defects around filing boundaries | M | M | Injected clock, Edmonton calendar helper, boundary tests T-013, T-014, T-071 | Boundary-day rejects |
| RSK-15 | Retroactive changes trigger unintended automatic recoveries | L | H | Engine only flags `RECOVERY_REVIEW`; no automatic clawback | Flag volume spikes |

## 31. Requirements traceability matrix

Every functional requirement maps to at least one rule or component, one interface, and at least one test.

| Requirement | Rules / component | Interface | Tests |
| --- | --- | --- | --- |
| FR-001 | `evaluateClaim` | `POST /evaluate` | T-080 |
| FR-002 | R002, R003, R004, R009 | `/evaluate`, `/claims` | T-002, T-004, T-005, T-009–T-012, T-015–T-017 |
| FR-003 | R005 | `/claims` | T-013, T-014, T-071 |
| FR-004 | R010 | `/claims` | T-003 |
| FR-005 | `runRules` ordering | `/claims` 422 body | T-018, T-081 |
| FR-006 | G001–G003 | `/claims` 422 | T-019–T-023 |
| FR-007 | Mock payer | `/insurance/verify` | T-023, T-024 |
| FR-008 | R006 | `/evaluate` | T-025 |
| FR-009 | Plan schema and resolver | `/plans` | T-067, T-083 |
| FR-010 | R007 | `/evaluate` | T-026, T-027 |
| FR-011 | R008 | `/evaluate` | T-028, T-029 |
| FR-012 | R011 | `/evaluate` | T-033–T-041 |
| FR-013 | R012 | `/evaluate` | T-042–T-047 |
| FR-014 | R015 | `/evaluate` | T-048 |
| FR-015 | R013 | `/evaluate` | T-049–T-054, T-065 |
| FR-016 | R014 | `/evaluate` | T-055–T-060 |
| FR-017 | R017 | `/evaluate` | T-032, T-066 |
| FR-018 | R016 | `/evaluate` | T-030, T-031, T-061–T-064 |
| FR-019 | Status machine | `/claims/{id}/status` | T-073–T-077 |
| FR-020 | Reprocess, flags | `/claims/{id}/reprocess` | T-069, T-070 |
| FR-021 | Per-line plan resolution | `/evaluate` | T-067, T-068 |
| FR-022 | `claim_adjudications` | `GET /claims/{id}` | T-069, T-080 |
| FR-023 | Overrides | `/claims/{id}/override` | T-080 (override case), T-079 |
| FR-024 | Idempotency | `POST /claims` | T-084 |
| FR-025 | Auth plugin | all | T-078, T-079 |
| FR-026 | Audit plugin | all | T-079, T-085 (audit assertion) |
| FR-027 | OpenAPI | `/docs` | T-085 |
| FR-028 | Provincial registry | `/evaluate`, `/claims` | T-082 |
| FR-029 | Trace | `/evaluate?trace=true` | T-080 |
| FR-030 | Plan admin | `/plans` | T-079, T-083 |

## 32. Test case catalogue

### 32.1 Conventions

This catalogue is authoritative: it supersedes the representative lists in section 14.3 where they differ. Each case has one assertion focus. *Layer*: **U** = unit (pure core), **P** = property-based, **I** = integration with Postgres and HTTP. Cases T-001 to T-024 and T-073 to T-077 are the ones already implemented in the Phase 1 core package.

### 32.2 Functional cases (85)

| ID | Group | Case | Expected | Layer |
| --- | --- | --- | --- | --- |
| T-001 | 1 Parity | Valid Alberta claim | No errors | U |
| T-002 | 1 | Billing number `ABC` | R002 | U |
| T-003 | 1 | `patient_province = ON` | R010 | U |
| T-004 | 1 | Service code `Z999` | R004 | U |
| T-005 | 1 | Card `1234567890AB` | R009 | U |
| T-006 | 1 | Verify → rules → format → submitted → paid | Format `AHCIP\|123456\|2026-10-01…`, status `paid` | U |
| T-007 | 2 Validation | No lines | R001 | U |
| T-008 | 2 | Empty billing number | R001 | U |
| T-009 | 2 | 5-digit billing number | R002 | U |
| T-010 | 2 | 7-digit billing number | R002 | U |
| T-011 | 2 | Unknown ICD code | R003 | U |
| T-012 | 2 | Ontario-style `A001` | R004 | U |
| T-013 | 2 | Service 90 days old | No R005 | U |
| T-014 | 2 | Service 91 days old | R005 | U |
| T-015 | 2 | 8-digit PHN | R009 | U |
| T-016 | 2 | 10-digit PHN | R009 | U |
| T-017 | 2 | PHN with trailing newline | R009 | U |
| T-018 | 2 | Several failures at once | `R002,R003,R004,R009,R010` in order | U |
| T-019 | 3 Eligibility | No insurance row | G001 | U |
| T-020 | 3 | Never verified | G001 | U |
| T-021 | 3 | Verified 25 h ago | G002 | U |
| T-022 | 3 | Verified 23 h ago | Passes | U |
| T-023 | 3 | `TERM-9`, `OON-9` | G003 with payer reasons | U |
| T-024 | 3 | Reverify after payer change | Cache cleared; new answer seen | U |
| T-025 | 3 | Service before effective or after termination date | R006 `COVERAGE_PERIOD` | U |
| T-026 | 4 Coverage | Code in no coverage rule | DENY `NOT_A_BENEFIT` | U |
| T-027 | 4 | Private plan, insured physician service | DENY `INSURED_BY_AHCIP` | U |
| T-028 | 4 | `MRI` without authorization | DENY `PRIOR_AUTH_REQUIRED` | U |
| T-029 | 4 | `MRI` with status `requested` | PEND | U |
| T-030 | 4 | Auto claim, no date of loss | PEND `DATE_OF_LOSS_REQUIRED` | U |
| T-031 | 4 | Service before date of loss | DENY `SERVICE_BEFORE_LOSS` | U |
| T-032 | 4 | Section B service past time limit | DENY `TIME_LIMIT_EXCEEDED` | U |
| T-033 | 5 Cost sharing | Case A: deductible swallows $85 | Plan $0, member $85 | U |
| T-034 | 5 | Case B: $600, $380 remaining, 20% | Plan $176, member $424 | U |
| T-035 | 5 | Case C: OOP cap reached | Plan $950, member $50 | U |
| T-036 | 5 | Case D: public AHCIP | Plan pays all | U |
| T-037 | 5 | Family deductible satisfied | Individual remaining = 0 | U |
| T-038 | 5 | Two lines on one claim | Deductible consumed in line order | U |
| T-039 | 5 | Odd-cent amount | Plan + member = eligible, no cent lost | U |
| T-040 | 5 | Random plans and amounts | Invariants hold (≥ 0, sum = eligible) | P |
| T-041 | 5 | Eligible exactly equals deductible remaining | Plan $0, no coinsurance | U |
| T-042 | 6 Frequency | Within limit, including exactly at limit | Payable | U |
| T-043 | 6 | One unit over limit | PARTIAL, remainder `FREQUENCY_EXCEEDED` | U |
| T-044 | 6 | Zero units remaining | DENY | U |
| T-045 | 6 | Calendar-year window on Jan 1 | Counter resets | U |
| T-046 | 6 | Rolling window | Oldest service falls out of window | U |
| T-047 | 6 | Late-submitted earlier visit | Ordered by service date | U |
| T-048 | 6 | Exact duplicate service | DENY `DUPLICATE_CLAIM` | U |
| T-049 | 7 Necessity | Matching diagnosis | Passes | U |
| T-050 | 7 | Mismatch, soft | PEND with prompts | U |
| T-051 | 7 | Mismatch, `hard: true` | DENY `NECESSITY_MISMATCH` | U |
| T-052 | 7 | Protocol, classification `unknown` | PEND | U |
| T-053 | 7 | Care-First claim on day 84 | Pre-approved | U |
| T-054 | 7 | Care-First claim on day 85 | PEND | U |
| T-055 | 8 COB | Own plan vs dependent coverage | Own plan primary | U |
| T-056 | 8 | Child on two parents' plans | Earlier birthday primary | U |
| T-057 | 8 | Birthdays equal | Longer-held plan primary | U |
| T-058 | 8 | Auto accident plus private plan | Auto primary | U |
| T-059 | 8 | Secondary payment | `min(benefit, remainder)`; total ≤ eligible | U |
| T-060 | 8 | Order undeterminable | PEND `COB_ORDER_UNDETERMINED` | U |
| T-061 | 9 Bodily injury | Loss on 2026-12-31 | Section B version | U |
| T-062 | 9 | Loss on 2027-01-01 | Care-First version | U |
| T-063 | 9 | 2027 treatment of 2026 loss | Stays Section B | U |
| T-064 | 9 | Mixed service dates in one claim | One regime, per-line dates | U |
| T-065 | 9 | Injury classification missing | PEND | U |
| T-066 | 9 | Benefit cap reached mid-claim | PARTIAL `MAX_REACHED` | U |
| T-067 | 10 Edge | Version change on July 1 | Two versions in `plan_versions_used` | U |
| T-068 | 10 | Carryover on vs off | Deductible credited vs restarted | U |
| T-069 | 10 | Retro-add, then reprocess | `REPROCESS_CANDIDATE`; new adjudication row | I |
| T-070 | 10 | Retro-termination | `RECOVERY_REVIEW`; payments unchanged | I |
| T-071 | 10 | Claim at 23:30 Mountain on day 90 | Filed on Edmonton date | U |
| T-072 | 10 | Two concurrent claims | Deductible not double-spent | I |
| T-073 | 11 Status | Every legal transition | Succeeds and writes history | U |
| T-074 | 11 | `paid → submitted`, `draft → paid` | 409 | U |
| T-075 | 11 | `rejected → submitted` | Allowed | U |
| T-076 | 11 | Rejection with reason | `denial_reason_code` stored | U |
| T-077 | 11 | `closed` and `paid` | Terminal | U |
| T-078 | 12 API | Missing token | 401 | I |
| T-079 | 12 | Wrong role on plan write and override | 403 | I |
| T-080 | 12 | `/evaluate` for each outcome | 200; nothing persisted; trace with flag | I |
| T-081 | 12 | Rejected `POST /claims` | 422 reference body with `claim_id` | I |
| T-082 | 12 | Unsupported province | 400 `No billing engine for XX` | I |
| T-083 | 12 | Unknown field, negative amount, invalid plan JSON | 422 with paths | I |
| T-084 | 12 | Idempotency key reuse | Same claim; changed body → 409 | I |
| T-085 | 12 | `/health` and `/docs` | `{"status":"ok"}`; docs render | I |

### 32.3 Non-functional cases

| ID | Case | Pass criterion |
| --- | --- | --- |
| T-N01 | Load test: 25 requests/s for 10 minutes on `/evaluate` | NFR-001 met, no errors |
| T-N02 | Pure engine benchmark, 10-line claim | NFR-002 met |
| T-N03 | Log redaction: PHN, name, DOB never appear in captured logs or error bodies | Zero matches |
| T-N04 | Dependency audit in CI | No high or critical findings |
| T-N05 | Database unavailable | `/ready` fails, `/evaluate` returns a 5xx the caller treats as `PEND` |
| T-N06 | Backup restore into staging then golden corpus | Identical decisions |
| T-N07 | Determinism: replay 1,000 stored adjudications | Byte-identical decisions |
| T-N08 | Rate limit and body size | 429 and 413 as configured |

## 33. Worked end-to-end examples

All amounts use the example plans in section 7 and the reference mock values.

### 33.1 Rejected claim with several errors

An Ontario-style card, a short billing number and a late filing, all in one claim: service 2026-07-10, received 2026-10-13 (95 days), billing number `12345`, PHN `1234567890AB`, valid code `03.03A` and diagnosis `J06.9`.

| Step | Result |
| --- | --- |
| Guards | Pass (coverage verified 2 hours ago) |
| Stage 1 errors, in fixed order | `R002` billing number, `R005` timely filing, `R009` health card |
| Outcome | `REJECT`, primary reason `R002` |
| Status | `draft → submitted → rejected`, `denial_reason_code = R002` |
| HTTP | 422 with the reference body and `claim_id` |

Fix: correct the billing number and PHN; R005 cannot be fixed by editing, because the claim is past the window.

### 33.2 Private plan with deductible and COB

Physiotherapy, $600.00. Primary plan: deductible $500 with $120 met, 20% member coinsurance. Secondary plan (spouse's): deductible already met, 20% coinsurance.

| Step | Primary | Secondary |
| --- | --- | --- |
| Eligible amount | $600.00 | $600.00 |
| Deductible applied | $380.00 | $0.00 |
| After deductible | $220.00 | $600.00 |
| Member coinsurance (20%) | $44.00 | $120.00 |
| Normal benefit | $176.00 | $480.00 |
| Remainder after primary | — | $600 − $176 = $424.00 |
| Plan pays | **$176.00** | **min($480, $424) = $424.00** |

Member pays $0.00; combined payment $600.00 equals the eligible amount and never exceeds it. This assumes the secondary plan computes its normal benefit on the full eligible amount, as in section 9.7.

### 33.3 Section B claim straddling the new year

Accident on 2026-12-28; physiotherapy on 2027-01-05, $1,400.00. Section B cap $50,000, $48,900 already paid.

| Step | Result |
| --- | --- |
| R016 | Version chosen by date of loss: Section B (version 1), even though the service is in 2027 |
| R017 time limit | Within 2 years of the loss: pass |
| R013 | Protocol mode, classification `minor`, within protocol: pass |
| R017 cap | Remaining $1,100; line payable $1,400 → `PARTIAL` |
| Result | Plan pays $1,100.00; $300.00 denied `MAX_REACHED` |

### 33.4 Care-First claim received late

Accident 2027-01-10, claim received 2027-04-25, which is 105 days later. The pre-approval window is 84 days (12 weeks), so the program-of-care pre-approval does not apply. R013 returns `PEND` `NECESSITY_REVIEW` with prompts to attach treatment plan and clinical notes; an adjuster decides. No automatic denial occurs.

### 33.5 Retroactive termination

Coverage is retroactively ended on 2026-08-31 and notified on 2026-10-05.

| Claim | Service date | Effect |
| --- | --- | --- |
| A | 2026-08-20 | Unaffected |
| B (already paid) | 2026-09-10 | Flagged `RECOVERY_REVIEW`; payment unchanged |
| C (already paid) | 2026-09-22 | Flagged `RECOVERY_REVIEW`; payment unchanged |
| D (new) | 2026-09-15 | DENY `COVERAGE_PERIOD` (R006) |

A person decides on recovery. The engine never claws back automatically.

## Appendix C. Open questions

| # | Question | Owner | Needed before |
| --- | --- | --- | --- |
| 1 | Should R009 apply to private and auto claims through the patient's AHCIP record, or only to public claims as specified here? | Reference owner | Phase 2 |
| 2 | Does the existing platform need the `pended` status, or should pends live in a separate review queue? | Reference owner | Phase 1 |
| 3 | Which fee guide and allowed-amount source will define eligible amounts for private and auto plans? | Plan owner | Phase 4 |
| 4 | Which treatment protocols and visit limits apply to non-minor injuries before 2027? | Claims lead | Phase 5 |
| 5 | What retention period applies to adjudications and audit logs? | Privacy officer | Production |
| 6 | Should the calling app pass history, or should the engine own it? | Integration lead | Phase 7 |
| 7 | Are copays to be applied to payment in a later version? | Plan owner | v1.1 |

## Appendix D. Source references

These are the authorities to consult and cite when loading real data or confirming a rule. None replaces reading the current text.

| Topic | Authority |
| --- | --- |
| Fee schedule and billing rules | Alberta Health: Schedule of Medical Benefits and Alberta Health Care Insurance Plan billing information |
| Diagnosis coding | Canadian Institute for Health Information (CIHI): ICD-10-CA |
| Health privacy | Alberta Health Information Act and regulations |
| Auto injury regime from Jan 1, 2027 | Government of Alberta Care-First materials; Insurance Bureau of Canada summaries; the Care-First regulations as finalised |
| Pre-2027 auto injury benefits | Alberta automobile insurance legislation and regulations (Section B accident benefits; Diagnostic and Treatment Protocols) |
| COB conventions | Canadian Life and Health Insurance Association guidance, and each plan's contract |
| Source of behaviour for the engine | The attached AHS reference guide (FastAPI, Alberta edition) |

## Appendix A. Assumptions to verify before relying on this

1. **Code tables are illustrative.** The five SOMB codes, seven ICD-10-CA codes and every `AUTO_TREATMENT` / `PRIVATE_SCHEDULE` code are placeholders. Load the current SOMB from Alberta Health and real fee guides before production.
2. **Care-First details.** The January 1, 2027 start, the 12-week pre-approval window and the tribunal reflect public information at the time of writing, with regulations still being finalised. Confirm against the Government of Alberta site and put any change in plan JSON.
3. **Section B limits.** The $50,000 medical and rehabilitation cap and 2-year window are as publicly described; confirm the current figures and any indexation.
4. **COB conventions.** The own-plan-first and birthday rules are common Canadian industry practice; each plan's wording governs.
5. **Deductibles on AHCIP.** Insured physician services are first-dollar, so the public plan has no deductible. The deductible logic exists for the private and any future layers.
6. **Medical necessity thresholds.** Protocol visit and time limits are configuration you must source from the actual regulation or plan; none are asserted here.
7. **Reference gaps.** R006–R008 were unspecified in the reference; their definitions here are this project's decision and should be reviewed with whoever owns the existing platform.

## Appendix B. Quick start

```bash
git clone <repo> && cd ab-rules-engine
cp .env.example .env
docker compose up --build
npm run db:migrate && npm run seed
npm test                      # 85 tests
open http://localhost:8000/docs
```

Demo the failure paths with member IDs `TERM-9` (terminated) and `OON-9` (out of network), and submit a card like `1234567890AB` against `province: "AB"` to see R009 reject it.
