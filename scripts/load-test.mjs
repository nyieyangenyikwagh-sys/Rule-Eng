import "dotenv/config";
import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
const base = process.env.RULES_API_URL ?? "http://127.0.0.1:8000";
const duration = Number(process.env.LOAD_DURATION_SECONDS ?? 600);
const rps = Number(process.env.LOAD_RPS ?? 25);
const call = async (path, body, headers = {}) => {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Setup HTTP ${r.status}`);
  return data;
};
const login = await call("/api/v1/auth/login", {
  username: process.env.BOOTSTRAP_ADMIN_EMAIL,
  password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
});
const auth = { Authorization: `Bearer ${login.access_token}` };
const p = await call(
  "/api/v1/patients",
  {
    first_name: "Synthetic",
    last_name: "Loadtest",
    dob: "1990-01-01",
    gender: "unknown",
    insurance: {
      payer_id: "AHCIP",
      member_id: "LOAD-" + crypto.randomUUID(),
      health_card_number: "123456789",
      effective_date: "2020-01-01",
    },
  },
  auth,
);
const keyCount = Math.ceil((rps * 60) / 90);
const keys = [];
for (let i = 0; i < keyCount; i++)
  keys.push(
    await call(
      "/api/v1/api-keys",
      { name: `Synthetic load ${i + 1}`, scopes: ["evaluate:write"] },
      auth,
    ),
  );
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Edmonton",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const body = {
  patient_id: p.id,
  plan_id: p.insurance[0].plan_id,
  province: "AB",
  provider_billing_number: "123456",
  service_date: today,
  lines: [{ service_code: "03.03A", diagnosis_code: "J06.9", amount: 85 }],
};
const times = [];
let errors = 0;
let sent = 0;
const pending = new Set();
const start = performance.now();
const total = duration * rps;
try {
  for (let i = 0; i < total; i++) {
    const due = start + (i * 1000) / rps;
    const delay = due - performance.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const requestStart = performance.now();
    const task = fetch(base + "/api/v1/evaluate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": keys[i % keys.length].key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
      .then(async (r) => {
        const d = await r.json();
        if (r.status !== 200 || d.outcome !== "ACCEPT") errors++;
      })
      .catch(() => {
        errors++;
      })
      .finally(() => {
        times.push(performance.now() - requestStart);
        pending.delete(task);
      });
    pending.add(task);
    sent++;
    if (sent % (rps * 60) === 0)
      console.log(
        JSON.stringify({
          elapsed_seconds: Math.round((performance.now() - start) / 1000),
          sent,
          completed: times.length,
          errors,
        }),
      );
  }
  await Promise.all(pending);
  times.sort((a, b) => a - b);
  const result = {
    target_rps: rps,
    duration_seconds: duration,
    requests: sent,
    errors,
    p50_ms: times[Math.floor(times.length * 0.5)],
    p95_ms: times[Math.floor(times.length * 0.95)],
    p99_ms: times[Math.floor(times.length * 0.99)],
    tested_at: new Date().toISOString(),
    environment:
      "Local Windows HTTP API and PostgreSQL; not a 1-vCPU hosted deployment",
  };
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/load.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors || result.p95_ms > 300 || result.p99_ms > 800)
    process.exitCode = 1;
} finally {
  for (const key of keys)
    await fetch(base + `/api/v1/api-keys/${key.id}`, {
      method: "DELETE",
      headers: auth,
    });
}
