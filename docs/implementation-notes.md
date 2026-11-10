# Implementation decisions and traceability

The build follows AB-RULES-DOC-001 v1.1. The separate FastAPI AHS companion mentioned in the document was not supplied, so parity is tested against the rules, messages, examples, and state table reproduced in the supplied document. Descriptions for the five illustrative SOMB codes are labels, not verified official billing descriptions.

## Draft conflicts resolved explicitly

| Topic                                       | Resolution                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core empty lines vs HTTP 1–50 lines         | R001 exists and is tested directly; the HTTP schema follows section 23 and rejects an empty array before adjudication.                                                                                                                                              |
| R009 on private and auto coverage           | Applied only when a public plan is involved, following section 9.1 and the private-payer strategy.                                                                                                                                                                  |
| JavaScript regex newline behavior           | Explicit identifier lengths and regex checks enforce strict input. No silent trimming.                                                                                                                                                                              |
| Auto example JSON omits coverage            | Explicit `medical_rehab` coverage was added; absence still defaults to denial.                                                                                                                                                                                      |
| Unknown injury protocols/programs           | Pend for human review. Demo Section B settings (minor, 21 units, 90 days) and `DEMO-MSK` are explicitly synthetic. No claim of regulatory accuracy.                                                                                                                 |
| Section B “730 days”                        | The shipped plan uses `incurredWithinMonths: 24`, as recommended by section 9.3; generic legacy day limits remain supported.                                                                                                                                        |
| Prior authorization MRI example             | Diagnostic `MRI` and `27447` coverage is explicitly included in the private demo, allowing R008 to be reached.                                                                                                                                                      |
| Timing versus deterministic traces          | Core `durationMs` is always zero. Actual HTTP durations are collected by metrics outside the pure core. Trace monetary inputs remain cents.                                                                                                                         |
| Dry run versus mandatory access audit       | No claim, adjudication, status, flag, or accumulator mutation. Required patient-access auditing is retained.                                                                                                                                                        |
| User provisioning                           | Public registration is disabled. Bootstrap the first PostgreSQL administrator once; existing administrators provision users. Login creates a revocable opaque PostgreSQL session.                                                                                   |
| Auto logical payer ID                       | Patient coverage attaches to `AB_AUTO`; date of loss resolves `AB_AUTO_SECTION_B` or `AB_CARE_FIRST` within that plan.                                                                                                                                              |
| HTTP snake_case versus supplied plan schema | Claim, patient, auth, history, and decision envelopes are snake_case. Plan definition JSON uses the exact camelCase format in section 7; monetary values in plan definitions are cents.                                                                             |
| Open-ended immutable versions               | Overlaps are rejected, including an attempted version after an existing open-ended interval. Publish finite windows when known; changing already-published contract boundaries requires a reviewed data migration, not silent mutation.                             |
| Cost sharing and frequency ordering         | Frequency reservations use service-date order and response lines preserve caller order. Monetary cost sharing is consumed in line order within the applicable period.                                                                                               |
| Family deductible                           | Honors the family accumulator passed by the caller. The draft defines no household identifier; automatic aggregation across different patients is not inferred.                                                                                                     |
| Reprocessing and legal statuses             | Reprocessing creates a new decision and preserves the existing workflow status; it does not invent a `denied -> submitted` transition. An adjuster resolves the workflow using the documented legal transitions. Paid/closed claims cannot be reprocessed.          |
| Retroactive monetary correction             | The core rebuilds applicable accumulators from historical line results chronologically by service date; later frequency conflicts are flagged for explicit review. Existing paid adjudications and payments are never silently rewritten.                           |
| Manual approval amounts                     | `ACCEPT` overrides require explicit line amounts summing to billed expense. Multi-plan approvals additionally require per-payer allocations summing to the approved payment; a reason alone cannot manufacture an amount. Overrides preserve the original decision. |
| Runtime                                     | Strict TypeScript 5, Node 20+ compatible source, Node 22 Docker/CI image. Local execution was checked using Node 25 and PostgreSQL 18; CI/Compose target PostgreSQL 16.                                                                                             |

## Requirements mapping

| Requirements       | Code / tests                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------ |
| FR-001–005, FR-028 | `packages/core/src/rules/reference`, `provincial`; catalogue T-001–018, T-080–083          |
| FR-006–008         | `eligibility`, `routes/patients`, `services/cache`; T-019–025, API guard/cache tests       |
| FR-009–011, FR-030 | `plans/schema`, `routes/plans`, `engine`; T-026–029, T-067–068, T-079/083                  |
| FR-012–018         | `engine`, `rules/extensions`; T-030–066, property tests and edge tests                     |
| FR-019–024         | `status`, `services/adjudication`, `routes/claims`, integrity migration; T-069–077/081/084 |
| FR-025–027, FR-029 | `app`, `routes/auth`, `schemas`, audit services; T-078–085 and security tests              |

Named scenarios T-001–T-085 can be located directly by their IDs in `packages/core/test/catalogue.test.ts` and `apps/api/test/api.test.ts`. Additional cases cover rolling periods, unknown plans and metadata, configuration failures, manual overrides, exact money conservation, and deterministic evaluation.

## External release requirements

- Obtain and compare the missing companion AHS reference before asserting exact FastAPI compatibility.
- Replace synthetic schedules, diagnosis data, treatment programs, and protocol settings with licensed, approved data. Confirm auto regulations with the responsible plan owner.
- Supply Render/Railway and managed PostgreSQL configuration for a public deployment. HTTPS, encrypted storage, backup retention, monitoring alerts, and data location are infrastructure responsibilities.
- Agree on the unspecified privacy/retention policy, clinical review process, and authoritative allowed-amount source before real data use.
- Run the load and restore exercises on the actual hosted hardware. Local performance is evidence for this machine only; availability, RPO, and RTO cannot be certified by unit tests.

The completed local HTTP load run sent 15,000 requests over 10 minutes at 25 requests/second with zero errors. It measured p50 16.1 ms and p95 40.0 ms. Its p99 was 1,049 ms, so the draft's 800 ms p99 target remains unverified. The embedded Windows PostgreSQL process repeatedly reported delayed autovacuum worker startup during this run; repeat the test on PostgreSQL 16 in the deployment environment before attributing the tail latency to the API. The checked-in result is stored in `docs/load-test-result.json`.

The optional payments, appeals endpoints, analytics, Ontario engine, FHIR, and EDI parser are intentionally outside the v1 scope. The state machine includes the specified appeal states without executing payment transfers.
