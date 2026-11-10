import type {
  ClaimDetail,
  ClaimInput,
  ClaimSummary,
  Decision,
  Eligibility,
  Patient,
  Plan,
  Rule,
} from "./types";

const TOKEN_KEY = "ab_rules_access_token";
const ROLE_KEY = "ab_rules_user_role";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(value: string | null, role?: string) {
  if (value) {
    localStorage.setItem(TOKEN_KEY, value);
    if (role) localStorage.setItem(ROLE_KEY, role);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  }
}

export function getTokenRole() {
  return localStorage.getItem(ROLE_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/v1/auth/login") {
      setToken(null);
      window.dispatchEvent(new Event("rules:unauthorized"));
    }
    const detail = payload.detail ?? `Request failed (${response.status})`;
    const issues = Array.isArray(payload.errors)
      ? ` ${payload.errors.map((e: { path?: string; message?: string }) => `${e.path}: ${e.message}`).join(" · ")}`
      : "";
    throw new Error(detail + issues);
  }
  return payload as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{
      access_token: string;
      expires_at: string;
      user: { id: number; email: string; role: string };
    }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ revoked: boolean }>("/api/v1/auth/logout", { method: "POST" }),
  patients: (q = "") =>
    request<Patient[]>(`/api/v1/patients?limit=100&q=${encodeURIComponent(q)}`),
  patient: (id: number) => request<Patient>(`/api/v1/patients/${id}`),
  createPatient: (body: Record<string, unknown>) =>
    request<Patient>("/api/v1/patients", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  verify: (
    patientInsuranceId: number,
    response: {
      source_reference: string;
      eligible: boolean;
      reason_code: string | null;
    },
  ) =>
    request<Eligibility>("/api/v1/insurance/verify", {
      method: "POST",
      body: JSON.stringify({
        patient_insurance_id: patientInsuranceId,
        ...response,
      }),
    }),
  plans: () => request<Plan[]>("/api/v1/plans"),
  plan: (id: number) => request<Plan>(`/api/v1/plans/${id}`),
  createPlan: (definition: Record<string, unknown>) =>
    request<{ id: number; definition: Record<string, unknown> }>(
      "/api/v1/plans",
      { method: "POST", body: JSON.stringify(definition) },
    ),
  rules: () => request<Rule[]>("/api/v1/rules"),
  claims: (status = "") =>
    request<ClaimSummary[]>(
      `/api/v1/claims?limit=100${status ? `&status=${status}` : ""}`,
    ),
  claim: (id: number) => request<ClaimDetail>(`/api/v1/claims/${id}`),
  evaluate: (body: ClaimInput) =>
    request<Decision>("/api/v1/evaluate?trace=true", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  submitClaim: (body: ClaimInput) =>
    request<{ id: number; status: string; decision: Decision }>(
      "/api/v1/claims",
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      },
    ),
};
