import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { configSchema } from "../src/config.js";
import * as s from "../src/db/schema.js";
import { seedPlans, seedAdmin } from "../../../scripts/test-fixtures.js";
import { EligibilityCache } from "../src/services/cache.js";
import { privatePlan } from "../../../packages/core/test/fixtures.js";

describe("PostgreSQL + Fastify integration", () => {
  let system: Awaited<ReturnType<typeof buildApp>>;
  let container: StartedPostgreSqlContainer | undefined;
  let admin: string, biller: string, analyst: string;
  let ahcip: number, greenshield: number;
  const now = new Date("2026-10-13T18:00:00Z");
  const headers = (token = admin) => ({ authorization: `Bearer ${token}` });
  beforeAll(async () => {
    let url = process.env.TEST_DATABASE_URL;
    if (!url) {
      container = await new PostgreSqlContainer("postgres:16-alpine").start();
      url = container.getConnectionUri();
    }
    // Explicit test URL only: never infer the application database and truncate it.
    if (!new URL(url).pathname.includes("test") && !container)
      throw new Error("TEST_DATABASE_URL must name a dedicated test database");
    system = await buildApp(
      configSchema.parse({
        DATABASE_URL: url,
        SECRET_KEY: "test-secret-key-at-least-32-characters-long",
        ENVIRONMENT: "test",
        ALLOW_REGISTRATION: "true",
        MOCK_PAYER_DELAY_MS: 0,
        RATE_LIMIT_MAX: 10000,
      }),
      { now: () => now, logger: false },
    );
    await migrate(system.db, { migrationsFolder: "drizzle" });
    await system.db.execute(
      sql`truncate table idempotency_keys, overrides, claim_flags, claim_line_results, claim_adjudications, claim_status_history, claim_lines, claims, accumulators, audit_logs, api_keys, patient_insurances, patients, plan_versions, insurance_plans, users restart identity cascade`,
    );
    await seedPlans(system.db);
    await seedAdmin(system.db, "admin@example.test", "Test-password-123!");
    const login = await system.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        username: "admin@example.test",
        password: "Test-password-123!",
      },
    });
    expect(login.statusCode).toBe(200);
    admin = login.json().access_token;
    for (const role of ["biller", "analyst"]) {
      await system.app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        headers: headers(),
        payload: {
          email: `${role}@example.test`,
          password: "Test-password-123!",
          role,
        },
      });
      const r = await system.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          username: `${role}@example.test`,
          password: "Test-password-123!",
        },
      });
      if (role === "biller") biller = r.json().access_token;
      else analyst = r.json().access_token;
    }
    const plans = await system.db.select().from(s.insurancePlans);
    ahcip = plans.find((p) => p.planId === "AHCIP")!.id;
    greenshield = plans.find((p) => p.planId === "GREENSHIELD")!.id;
  });
  afterAll(async () => {
    await system?.app.close();
    await container?.stop();
  });
  async function patient(
    payer = "AHCIP",
    effective = "2020-01-01",
    member = "DEMO-1",
    card = "123456789",
  ) {
    const r = await system.app.inject({
      method: "POST",
      url: "/api/v1/patients",
      headers: headers(),
      payload: {
        first_name: "Demo",
        last_name: "Patient",
        dob: "1990-01-01",
        gender: "unknown",
        insurance: {
          payer_id: payer,
          member_id: member,
          health_card_number: card,
          effective_date: effective,
          relationship: "self",
        },
      },
    });
    expect(r.statusCode, r.body).toBe(201);
    return r.json();
  }
  async function verify(p: any, reverify = false) {
    const r = await system.app.inject({
      method: "POST",
      url: `/api/v1/insurance/${reverify ? "reverify" : "verify"}`,
      headers: headers(),
      payload: { patient_insurance_id: p.insurance[0].id },
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  }
  const body = (p: any, overrides: Record<string, unknown> = {}) => ({
    patient_id: p.id,
    plan_id: p.insurance[0].plan_id,
    province: "AB",
    provider_billing_number: "123456",
    service_date: "2026-10-01",
    lines: [
      { service_code: "03.03A", diagnosis_code: "J06.9", units: 1, amount: 85 },
    ],
    ...overrides,
  });
  const post = (
    url: string,
    payload: object,
    extra: Record<string, string> = {},
  ) =>
    system.app.inject({
      method: "POST",
      url,
      headers: { ...headers(), ...extra },
      payload,
    });
  it("T-024 reverify clears cached payer answer", async () => {
    const p = await patient();
    expect((await verify(p)).eligible).toBe(true);
    await system.db
      .update(s.patientInsurances)
      .set({ memberId: "TERM-9" })
      .where(eq(s.patientInsurances.id, p.insurance[0].id));
    expect((await verify(p)).eligible).toBe(true);
    expect((await verify(p, true)).reason_code).toBe("COVERAGE_TERMINATED");
  });
  it("T-069 retro-add flags and appends without overwriting", async () => {
    const p = await patient("AHCIP", "2026-10-05");
    await verify(p);
    const first = await post("/api/v1/claims", body(p));
    expect(first.json().status).toBe("denied");
    const id = first.json().id;
    const update = await system.app.inject({
      method: "PATCH",
      url: `/api/v1/insurance/${p.insurance[0].id}`,
      headers: headers(),
      payload: {
        effective_date: "2020-01-01",
        termination_date: null,
        reason: "Coverage was backdated by payer",
      },
    });
    expect(update.json().flags).toContainEqual({
      claim_id: id,
      flag: "REPROCESS_CANDIDATE",
    });
    await verify(p, true);
    const replay = await post(`/api/v1/claims/${id}/reprocess`, {
      reason: "Backdated coverage confirmed",
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json().decision.outcome).toBe("ACCEPT");
    const saved = await system.app.inject({
      url: `/api/v1/claims/${id}`,
      headers: headers(),
    });
    expect(saved.json().adjudications).toHaveLength(2);
    expect(saved.json().adjudications[1].decision.outcome).toBe("DENY");
    expect(saved.json().adjudications[0].supersedes_id).toBe(
      saved.json().adjudications[1].id,
    );
  });
  it("T-070 retro-termination flags paid claims without changing payment", async () => {
    const p = await patient();
    await verify(p);
    const r = await post("/api/v1/claims", body(p));
    const id = r.json().id;
    await post(`/api/v1/claims/${id}/status`, { to_status: "paid" });
    const update = await system.app.inject({
      method: "PATCH",
      url: `/api/v1/insurance/${p.insurance[0].id}`,
      headers: headers(),
      payload: {
        effective_date: "2020-01-01",
        termination_date: "2026-09-30",
        reason: "Retroactive termination confirmed",
      },
    });
    expect(update.json().flags).toContainEqual({
      claim_id: id,
      flag: "RECOVERY_REVIEW",
    });
    const saved = await system.app.inject({
      url: `/api/v1/claims/${id}`,
      headers: headers(),
    });
    expect(saved.json().status).toBe("paid");
    expect(saved.json().decision.plan_pays_total).toBe(85);
    expect(
      (
        await post(`/api/v1/claims/${id}/reprocess`, {
          reason: "Try reprocessing terminal claim",
        })
      ).statusCode,
    ).toBe(409);
  });
  it("T-072 concurrent claims consume the deductible exactly once", async () => {
    const p = await patient("GREENSHIELD");
    await verify(p);
    const make = (code: string) =>
      body(p, {
        lines: [
          {
            service_code: code,
            diagnosis_code: "M54.5",
            units: 1,
            amount: 400,
          },
        ],
      });
    const results = await Promise.all([
      post("/api/v1/claims", make("PHYSIO-INIT")),
      post("/api/v1/claims", make("PHYSIO-FU")),
    ]);
    for (const r of results) expect(r.statusCode, r.body).toBe(201);
    expect(
      results
        .map((r) => r.json().decision.lines[0].deductible_applied)
        .sort((a, b) => a - b),
    ).toEqual([100, 400]);
    expect(
      results.reduce((sum, r) => sum + r.json().decision.plan_pays_total, 0),
    ).toBe(240);
  });
  it("T-078 missing credentials", async () =>
    expect((await system.app.inject({ url: "/api/v1/plans" })).statusCode).toBe(
      401,
    ));
  it("T-079 wrong roles blocked on plans and overrides; access audited", async () => {
    expect(
      (
        await system.app.inject({
          method: "POST",
          url: "/api/v1/plans",
          headers: headers(biller),
          payload: privatePlan,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await system.app.inject({
          method: "POST",
          url: "/api/v1/claims/1/override",
          headers: headers(biller),
          payload: { to_outcome: "DENY", reason: "A valid reason for denial" },
        })
      ).statusCode,
    ).toBe(403);
    const p = await patient();
    await system.app.inject({
      url: `/api/v1/patients/${p.id}`,
      headers: headers(analyst),
    });
    const rows = await system.db
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.resource, `patient:${p.id}`));
    expect(rows.map((r) => r.action)).toEqual(["create", "read"]);
  });
  it("T-080 evaluate returns all five outcomes, trace optional, no claims or accumulators persisted", async () => {
    const p = await patient();
    const priv = await patient("GREENSHIELD");
    const before = await system.db.select().from(s.claims);
    const accBefore = await system.db.select().from(s.accumulators);
    const cases = [
      ["ACCEPT", body(p)],
      ["REJECT", body(p, { provider_billing_number: "BAD" })],
      ["DENY", body(priv)],
      [
        "PEND",
        body(priv, {
          lines: [
            {
              service_code: "MRI",
              diagnosis_code: "M54.5",
              units: 1,
              amount: 100,
              prior_auth_status: "requested",
            },
          ],
        }),
      ],
      [
        "PARTIAL",
        body(priv, {
          lines: [
            {
              service_code: "PHYSIO-INIT",
              diagnosis_code: "M54.5",
              units: 21,
              amount: 10,
            },
          ],
        }),
      ],
    ] as const;
    for (const [expected, payload] of cases) {
      const r = await post("/api/v1/evaluate?trace=true", payload);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().outcome).toBe(expected);
      expect(r.json().trace.length).toBeGreaterThan(0);
    }
    expect(
      (await post("/api/v1/evaluate", body(p))).json().trace,
    ).toBeUndefined();
    expect(await system.db.select().from(s.claims)).toEqual(before);
    expect(await system.db.select().from(s.accumulators)).toEqual(accBefore);
  });
  it("T-081 rejected claim 422 shape and status history", async () => {
    const p = await patient();
    await verify(p);
    const r = await post(
      "/api/v1/claims",
      body(p, { provider_billing_number: "ABC" }),
    );
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({
      message: "Claim rejected by rule engine",
      errors: [{ code: "R002", message: "Billing number invalid for AB" }],
    });
    const records = await system.db
      .select()
      .from(s.claimStatusHistory)
      .where(eq(s.claimStatusHistory.claimId, r.json().claim_id));
    expect(records.map((v) => v.toStatus)).toEqual(["submitted", "rejected"]);
  });
  it("T-082 unknown province fails closed", async () => {
    const p = await patient();
    const r = await post("/api/v1/evaluate", body(p, { province: "XX" }));
    expect(r.statusCode).toBe(400);
    expect(r.json().detail).toBe("No billing engine for XX");
  });
  it("T-083 schemas reject unknown fields, negative amounts and bad plans", async () => {
    const p = await patient();
    for (const b of [
      body(p, { unexpected: true }),
      body(p, {
        lines: [
          { service_code: "03.03A", diagnosis_code: "J06.9", amount: -1 },
        ],
      }),
    ]) {
      const r = await post("/api/v1/evaluate", b);
      expect(r.statusCode).toBe(422);
      expect(r.json().errors).toBeDefined();
    }
    const r = await post("/api/v1/plans", { ...privatePlan, coinsurance: 2 });
    expect(r.statusCode).toBe(422);
  });
  it("T-084 idempotency replay and changed-body conflict including concurrency", async () => {
    const p = await patient();
    await verify(p);
    const h = { "idempotency-key": "catalogue-084" };
    const responses = await Promise.all([
      post("/api/v1/claims", body(p), h),
      post("/api/v1/claims", body(p), h),
    ]);
    expect(responses[0]!.statusCode).toBe(201);
    expect(responses[0]!.json()).toEqual(responses[1]!.json());
    expect(
      (
        await post(
          "/api/v1/claims",
          body(p, { provider_billing_number: "654321" }),
          h,
        )
      ).statusCode,
    ).toBe(409);
  });
  it("T-085 health, ready and generated docs", async () => {
    expect((await system.app.inject({ url: "/health" })).json()).toEqual({
      status: "ok",
    });
    expect((await system.app.inject({ url: "/ready" })).statusCode).toBe(200);
    expect((await system.app.inject({ url: "/docs/" })).statusCode).toBe(200);
    const spec = await system.app.inject({ url: "/docs/json" });
    expect(spec.statusCode, spec.body).toBe(200);
    expect(
      spec.json().paths["/api/v1/evaluate"].post.requestBody,
    ).toBeDefined();
  });
  it("blocks unverified and stale claims before creation", async () => {
    const p = await patient();
    const before = await system.db.select().from(s.claims);
    expect((await post("/api/v1/claims", body(p))).json().code).toBe("G001");
    await verify(p);
    await system.db
      .update(s.patientInsurances)
      .set({ lastVerifiedAt: new Date(+now - 25 * 3600000).toISOString() })
      .where(eq(s.patientInsurances.id, p.insurance[0].id));
    expect((await post("/api/v1/claims", body(p))).json().code).toBe("G002");
    expect(await system.db.select().from(s.claims)).toEqual(before);
  });
  it("no PHN echoed by rule failure", async () => {
    const p = await patient(
      "AHCIP",
      "2020-01-01",
      "SYNTHETIC-PHI-MEMBER",
      "1234567890AB",
    );
    await verify(p);
    const r = await post("/api/v1/claims", body(p));
    expect(r.statusCode).toBe(422);
    expect(r.body).not.toContain("1234567890AB");
    expect(r.body).not.toContain("SYNTHETIC-PHI-MEMBER");
  });
  it("API keys scoped, hashed at rest and revocable", async () => {
    const issued = await post("/api/v1/api-keys", {
      name: "Integration",
      scopes: ["evaluate:write"],
    });
    expect(issued.statusCode).toBe(201);
    const { key, id } = issued.json();
    const [row] = await system.db
      .select()
      .from(s.apiKeys)
      .where(eq(s.apiKeys.id, id));
    expect(row!.keyHash).not.toContain(key);
    const p = await patient();
    expect(
      (
        await system.app.inject({
          method: "POST",
          url: "/api/v1/evaluate",
          headers: { "x-api-key": key },
          payload: body(p),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await system.app.inject({
          url: "/api/v1/claims/1",
          headers: { "x-api-key": key },
        })
      ).statusCode,
    ).toBe(403);
    await system.app.inject({
      method: "DELETE",
      url: `/api/v1/api-keys/${id}`,
      headers: headers(),
    });
    expect(
      (
        await system.app.inject({
          method: "POST",
          url: "/api/v1/evaluate",
          headers: { "x-api-key": key },
          payload: body(p),
        })
      ).statusCode,
    ).toBe(401);
  });
  it("public registration cannot escalate roles", async () => {
    const r = await system.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "intruder@example.test",
        password: "Test-password-123!",
        role: "admin",
      },
    });
    expect(r.statusCode).toBe(403);
  });
  it("override requires reason and explicit allocation, preserves prior adjudication", async () => {
    const p = await patient("AHCIP", "2026-10-05");
    await verify(p);
    const created = await post("/api/v1/claims", body(p));
    const id = created.json().id;
    expect(
      (
        await post(`/api/v1/claims/${id}/override`, {
          to_outcome: "ACCEPT",
          reason: "Too short",
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post(`/api/v1/claims/${id}/override`, {
          to_outcome: "ACCEPT",
          reason: "Coverage confirmed manually",
        })
      ).statusCode,
    ).toBe(422);
    const r = await post(`/api/v1/claims/${id}/override`, {
      to_outcome: "ACCEPT",
      reason: "Coverage confirmed manually",
      lines: [{ line_no: 1, plan_pays: 85, member_pays: 0 }],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe("paid");
    expect(
      await system.db
        .select()
        .from(s.overrides)
        .where(eq(s.overrides.claimId, id)),
    ).toHaveLength(1);
    const history = await system.db
      .select()
      .from(s.claimAdjudications)
      .where(eq(s.claimAdjudications.claimId, id));
    expect(history).toHaveLength(2);
    expect(history[0]!.decision.outcome).toBe("DENY");
  });
  it("plan versions reject overlapping dates", async () => {
    const r = await post(`/api/v1/plans/${greenshield}/versions`, {
      ...privatePlan,
      version: 2,
      effectiveFrom: "2026-07-01",
    });
    expect(r.statusCode).toBe(409);
  });
  it("rejected resubmission reruns rules", async () => {
    const p = await patient();
    await verify(p);
    const rejected = await post(
      "/api/v1/claims",
      body(p, { provider_billing_number: "BAD" }),
    );
    const id = rejected.json().claim_id;
    const r = await post(`/api/v1/claims/${id}/status`, {
      to_status: "submitted",
      correction: body(p),
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().decision.outcome).toBe("ACCEPT");
  });
  it("strict calendar dates and two-decimal money", async () => {
    const p = await patient();
    for (const b of [
      body(p, { service_date: "2026-02-30" }),
      body(p, { service_date: "2026-10-14" }),
      body(p, {
        lines: [
          { service_code: "03.03A", diagnosis_code: "J06.9", amount: 1.001 },
        ],
      }),
    ])
      expect((await post("/api/v1/evaluate", b)).statusCode).toBe(422);
  });
  it("body limit rejects oversized requests", async () =>
    expect(
      (
        await system.app.inject({
          method: "POST",
          url: "/api/v1/evaluate",
          headers: headers(),
          payload: { padding: "x".repeat(270000) },
        })
      ).statusCode,
    ).toBe(413));
  it("memory cache honors TTL and delete", async () => {
    let time = 0;
    const cache = new EligibilityCache(() => time);
    await cache.set("a", { eligible: true }, 1);
    expect(await cache.get("a")).toEqual({ eligible: true });
    time = 1001;
    expect(await cache.get("a")).toBeNull();
    await cache.set("b", 1);
    await cache.delete("b");
    expect(await cache.get("b")).toBeNull();
    await cache.close();
  });
  it("database enforces append-only decisions and stores replay inputs", async () => {
    const p = await patient();
    await verify(p);
    const r = await post("/api/v1/claims", body(p));
    const id = r.json().id;
    const [a] = await system.db
      .select()
      .from(s.claimAdjudications)
      .where(eq(s.claimAdjudications.claimId, id));
    expect(a!.inputSnapshot).toHaveProperty("claim.patientId", String(p.id));
    expect(a!.inputSnapshot).toHaveProperty("history");
    await expect(
      system.db
        .update(s.claimAdjudications)
        .set({ outcome: "DENY" })
        .where(eq(s.claimAdjudications.id, a!.id)),
    ).rejects.toThrow();
    await expect(
      system.db.delete(s.planVersions).where(eq(s.planVersions.planId, ahcip)),
    ).rejects.toThrow();
  });
  it("stateless caller history and transferred credit are mapped from dollars", async () => {
    const p = await patient("GREENSHIELD");
    const r = await post(
      "/api/v1/evaluate",
      body(p, {
        lines: [
          {
            service_code: "PHYSIO-INIT",
            diagnosis_code: "M54.5",
            units: 1,
            amount: 600,
          },
        ],
        history: { lines: [], accumulators: {} },
        prior_accumulators: {
          GREENSHIELD: {
            individual_deductible_met: 120,
            family_deductible_met: 0,
            oop_met: 0,
            benefit_used: {},
          },
        },
      }),
    );
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().plan_pays_total).toBe(176);
    expect(r.json().member_pays_total).toBe(424);
  });
  it("a clinical pend can be manually denied and accepts no invented payout", async () => {
    const p = await patient("GREENSHIELD");
    await verify(p);
    const created = await post(
      "/api/v1/claims",
      body(p, {
        lines: [
          {
            service_code: "MRI",
            diagnosis_code: "M54.5",
            amount: 100,
            prior_auth_status: "requested",
          },
        ],
      }),
    );
    const r = await post(`/api/v1/claims/${created.json().id}/override`, {
      to_outcome: "DENY",
      reason: "Authorization was declined after review",
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().status).toBe("denied");
    expect(r.json().decision.lines[0]).toMatchObject({
      eligible_amount: 0,
      plan_pays: 0,
      denied_amount: 100,
    });
  });
  it("can publish a new valid plan and nonoverlapping version", async () => {
    const p = {
      ...privatePlan,
      planId: "TEST_PLAN",
      payerId: "TEST_PLAN",
      effectiveTo: "2026-06-30",
    };
    const created = await post("/api/v1/plans", p);
    expect(created.statusCode, created.body).toBe(201);
    const version = await post(`/api/v1/plans/${created.json().id}/versions`, {
      ...p,
      version: 2,
      effectiveFrom: "2026-07-01",
      effectiveTo: null,
    });
    expect(version.statusCode, version.body).toBe(201);
    const read = await system.app.inject({
      url: `/api/v1/plans/${created.json().id}`,
      headers: headers(),
    });
    expect(read.json().versions).toHaveLength(2);
  });
  it("service API can read claims only with claims:read scope", async () => {
    const key = await post("/api/v1/api-keys", {
      name: "Read integration",
      scopes: ["claims:read"],
    });
    expect(
      (
        await system.app.inject({
          url: "/api/v1/claims/1",
          headers: { "x-api-key": key.json().key },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await system.app.inject({ url: "/api/v1/rules", headers: headers() })
      ).json(),
    ).toHaveLength(20);
    expect(
      (await system.app.inject({ url: "/metrics", headers: headers() })).body,
    ).toContain("rules_http_duration_seconds");
  });
});
