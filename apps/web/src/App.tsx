import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { api, getToken, getTokenRole, setToken } from "./api";
import type {
  ClaimDetail,
  ClaimInput,
  ClaimSummary,
  Decision,
  Page,
  Patient,
  Plan,
  Rule,
} from "./types";

const money = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});
const date = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const today = new Date().toISOString().slice(0, 10);

function StatusPill({ value }: { value: string | null | undefined }) {
  const label = value || "Unknown";
  const tone = ["ACCEPT", "paid", "active", "payable"].includes(label)
    ? "positive"
    : [
          "PEND",
          "pended",
          "submitted",
          "appeal_pending",
          "PARTIAL",
          "partial",
        ].includes(label)
      ? "warning"
      : ["DENY", "REJECT", "denied", "rejected"].includes(label)
        ? "negative"
        : "neutral";
  return (
    <span className={`status ${tone}`}>
      <span />
      {label.replaceAll("_", " ")}
    </span>
  );
}

function EmptyState({
  icon: Icon = FileText,
  title,
  body,
}: {
  icon?: typeof FileText;
  title: string;
  body: string;
}) {
  return (
    <div className="empty">
      <Icon size={28} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.login(username, password);
      setToken(result.access_token, result.user.role);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="province-mark">
          <span>AB</span>
        </div>
        <div>
          <p className="eyebrow light">Claims decision support</p>
          <h1>
            Clear decisions.
            <br />
            Defensible rules.
          </h1>
          <p className="login-intro">
            A focused operations console for Alberta coverage verification,
            claim adjudication, and auditable rule outcomes.
          </p>
        </div>
        <div className="login-assurances">
          <span>
            <ShieldCheck size={18} /> HIA-aware access logging
          </span>
          <span>
            <FileCheck2 size={18} /> Versioned plan decisions
          </span>
          <span>
            <Activity size={18} /> Explainable rule traces
          </span>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-logo">
            <div className="province-mark small">
              <span>AB</span>
            </div>
            <strong>Rules Engine</strong>
          </div>
          <p className="eyebrow">Operations portal</p>
          <h2>Welcome back</h2>
          <p className="muted">
            Sign in with your provisioned administrator, biller, or analyst
            account.
          </p>
          <label>
            Email address
            <input
              autoFocus
              type="email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="name@organization.ca"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </label>
          {error && (
            <div className="form-error">
              <XCircle size={16} />
              {error}
            </div>
          )}
          <button className="button primary wide" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                Sign in <ArrowRight size={18} />
              </>
            )}
          </button>
          <div className="login-note">
            <ShieldCheck size={16} />
            <span>
              Access is limited to provisioned users. Sessions are revocable and
              stored in PostgreSQL.
            </span>
          </div>
        </form>
      </section>
    </main>
  );
}

const navigation = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "adjudicate" as const, label: "Adjudicate", icon: Sparkles },
  { id: "patients" as const, label: "Patients", icon: Users },
  { id: "claims" as const, label: "Claims", icon: ClipboardCheck },
  { id: "rules" as const, label: "Plans & rules", icon: BookOpen },
];

function Shell({
  page,
  setPage,
  onLogout,
  children,
}: {
  page: Page;
  setPage: (p: Page) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const active = navigation.find((item) => item.id === page)!;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <div className="brand">
          <div className="province-mark small">
            <span>AB</span>
          </div>
          <div>
            <strong>Rules Engine</strong>
            <small>Claims operations</small>
          </div>
        </div>
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setMenu(false);
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
              {page === id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="engine-state">
            <span className="live-dot" />
            <div>
              <strong>Engine online</strong>
              <small>Version 1.0.0</small>
            </div>
          </div>
          <button className="logout" onClick={onLogout}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>
      {menu && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <button
            className="menu-button"
            aria-label="Open navigation"
            onClick={() => setMenu(true)}
          >
            <Menu size={22} />
          </button>
          <div>
            <p>{active.label}</p>
            <span>Alberta insurance operations</span>
          </div>
          <div className="top-actions">
            <a className="docs-link" href="/docs/" target="_blank">
              API docs
            </a>
            <div className="avatar">
              {(getTokenRole() || "user").slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>
        <div className="page-container">{children}</div>
      </div>
    </div>
  );
}

function Dashboard({
  claims,
  patients,
  plans,
  loading,
  navigate,
  openClaim,
}: {
  claims: ClaimSummary[];
  patients: Patient[];
  plans: Plan[];
  loading: boolean;
  navigate: (p: Page) => void;
  openClaim: (id: number) => void;
}) {
  const totals = useMemo(
    () => ({
      billed: claims.reduce((sum, c) => sum + c.billed_amount, 0),
      payable: claims.reduce((sum, c) => sum + c.plan_pays_total, 0),
      attention: claims.filter((c) =>
        ["pended", "rejected", "denied"].includes(c.status),
      ).length,
      acceptRate: claims.length
        ? Math.round(
            (claims.filter((c) => c.outcome === "ACCEPT").length /
              claims.length) *
              100,
          )
        : 0,
    }),
    [claims],
  );
  const maxCount = Math.max(
    1,
    ...["ACCEPT", "PARTIAL", "PEND", "DENY", "REJECT"].map(
      (o) => claims.filter((c) => c.outcome === o).length,
    ),
  );
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Decision operations</p>
          <h1>
            Good{" "}
            {new Date().getHours() < 12
              ? "morning"
              : new Date().getHours() < 18
                ? "afternoon"
                : "evening"}
            .
          </h1>
          <p>Here’s the current picture across your claim workflow.</p>
        </div>
        <button
          className="button primary"
          onClick={() => navigate("adjudicate")}
        >
          <Plus size={18} /> New adjudication
        </button>
      </section>
      <section className="metrics-grid">
        <article className="metric feature">
          <div className="metric-icon">
            <CircleDollarSign size={20} />
          </div>
          <p>Total billed</p>
          <strong>{money.format(totals.billed)}</strong>
          <span>{claims.length} claims in view</span>
        </article>
        <article className="metric">
          <div className="metric-icon green">
            <BadgeCheck size={20} />
          </div>
          <p>Plan liability</p>
          <strong>{money.format(totals.payable)}</strong>
          <span>Across adjudicated claims</span>
        </article>
        <article className="metric">
          <div className="metric-icon amber">
            <Clock3 size={20} />
          </div>
          <p>Needs attention</p>
          <strong>{totals.attention}</strong>
          <span>Pended, denied, or rejected</span>
        </article>
        <article className="metric">
          <div className="metric-icon blue">
            <Gauge size={20} />
          </div>
          <p>Acceptance rate</p>
          <strong>{totals.acceptRate}%</strong>
          <span>
            {patients.length} patients · {plans.length} plans
          </span>
        </article>
      </section>
      <section className="dashboard-grid">
        <article className="panel recent-panel">
          <div className="panel-head">
            <div>
              <h2>Recent claims</h2>
              <p>Latest persisted adjudications</p>
            </div>
            <button className="text-button" onClick={() => navigate("claims")}>
              View all <ArrowRight size={16} />
            </button>
          </div>
          {loading ? (
            <div className="loading-row">
              <LoaderCircle className="spin" /> Loading claims
            </div>
          ) : claims.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Patient</th>
                    <th>Service date</th>
                    <th>Outcome</th>
                    <th className="right">Billed</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.slice(0, 6).map((claim) => (
                    <tr key={claim.id} onClick={() => openClaim(claim.id)}>
                      <td>
                        <strong>CLM-{String(claim.id).padStart(5, "0")}</strong>
                        <small>{claim.plan_code}</small>
                      </td>
                      <td>{claim.patient_name}</td>
                      <td>
                        {date.format(
                          new Date(`${claim.service_date}T12:00:00`),
                        )}
                      </td>
                      <td>
                        <StatusPill value={claim.outcome || claim.status} />
                      </td>
                      <td className="right">
                        <strong>{money.format(claim.billed_amount)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No claims yet"
              body="Run and submit your first adjudication to populate this queue."
            />
          )}
        </article>
        <article className="panel outcome-panel">
          <div className="panel-head">
            <div>
              <h2>Decision mix</h2>
              <p>Latest outcome per claim</p>
            </div>
          </div>
          <div className="outcome-bars">
            {["ACCEPT", "PARTIAL", "PEND", "DENY", "REJECT"].map((outcome) => {
              const count = claims.filter((c) => c.outcome === outcome).length;
              return (
                <div className="bar-row" key={outcome}>
                  <div>
                    <StatusPill value={outcome} />
                    <b>{count}</b>
                  </div>
                  <div className="bar-track">
                    <span
                      className={`bar-fill ${outcome.toLowerCase()}`}
                      style={{
                        width: `${Math.max(count ? 8 : 0, (count / maxCount) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="queue-callout">
            <div>
              <Clock3 size={19} />
              <span>
                <strong>{totals.attention} claims</strong> may need review
              </span>
            </div>
            <button onClick={() => navigate("claims")}>Open queue</button>
          </div>
        </article>
      </section>
    </>
  );
}

function PatientModal({
  plans,
  onClose,
  onCreated,
}: {
  plans: Plan[];
  onClose: () => void;
  onCreated: (p: Patient) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    dob: "",
    gender: "unknown",
    email: "",
    phone: "",
    payer_id: plans[0]?.payer_id || "",
    member_id: "",
    effective_date: today,
  });
  const set = (key: string, value: string) =>
    setForm((old) => ({ ...old, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const patient = await api.createPatient({
        first_name: form.first_name,
        last_name: form.last_name,
        dob: form.dob,
        gender: form.gender,
        province: "AB",
        ...(form.email ? { email: form.email } : {}),
        ...(form.phone ? { phone: form.phone } : {}),
        insurance: {
          payer_id: form.payer_id,
          member_id: form.member_id,
          effective_date: form.effective_date,
          termination_date: null,
          priority: "primary",
          relationship: "self",
        },
      });
      onCreated(patient);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create patient",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-scrim" onClick={onClose} aria-label="Close" />
      <form className="modal-card" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">New record</p>
            <h2>Add patient</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="form-grid two">
          <label>
            First name
            <input
              value={form.first_name}
              onChange={(e) => set("first_name", e.target.value)}
              required
            />
          </label>
          <label>
            Last name
            <input
              value={form.last_name}
              onChange={(e) => set("last_name", e.target.value)}
              required
            />
          </label>
          <label>
            Date of birth
            <input
              type="date"
              max={today}
              value={form.dob}
              onChange={(e) => set("dob", e.target.value)}
              required
            />
          </label>
          <label>
            Gender
            <select
              value={form.gender}
              onChange={(e) => set("gender", e.target.value)}
            >
              <option value="unknown">Unknown</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Email <span>optional</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </label>
          <label>
            Phone <span>optional</span>
            <input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </label>
        </div>
        <div className="form-divider">
          <span>Primary coverage</span>
        </div>
        <div className="form-grid two">
          <label>
            Payer
            <select
              value={form.payer_id}
              onChange={(e) => set("payer_id", e.target.value)}
              required
            >
              {plans.map((p) => (
                <option key={p.id} value={p.payer_id}>
                  {p.name} · {p.layer}
                </option>
              ))}
            </select>
          </label>
          <label>
            Member ID
            <input
              value={form.member_id}
              onChange={(e) => set("member_id", e.target.value)}
              placeholder="Member identifier"
              required
            />
          </label>
          <label>
            Effective date
            <input
              type="date"
              value={form.effective_date}
              onChange={(e) => set("effective_date", e.target.value)}
              required
            />
          </label>
        </div>
        {error && (
          <div className="form-error">
            <XCircle size={16} />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                <UserPlus size={17} /> Add patient
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function EligibilityModal({
  coverage,
  onClose,
  onSaved,
}: {
  coverage: Patient["insurance"][number];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [eligible, setEligible] = useState(true);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.verify(coverage.id, {
        source_reference: reference,
        eligible,
        reason_code: eligible ? null : reason,
      });
      onSaved(
        `Eligibility recorded as ${result.eligible ? "eligible" : "ineligible"}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Verification could not be saved",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-scrim" onClick={onClose} aria-label="Close" />
      <form className="modal-card eligibility-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Payer response</p>
            <h2>Record eligibility</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="coverage-context">
          <ShieldCheck size={19} />
          <div>
            <strong>{coverage.plan_name || coverage.payer_id}</strong>
            <small>{coverage.member_id}</small>
          </div>
        </div>
        <div className="form-grid two">
          <label>
            Eligibility status
            <select
              value={eligible ? "eligible" : "ineligible"}
              onChange={(event) =>
                setEligible(event.target.value === "eligible")
              }
            >
              <option value="eligible">Eligible</option>
              <option value="ineligible">Ineligible</option>
            </select>
          </label>
          <label>
            Payer reference
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Confirmation or transaction ID"
              required
            />
          </label>
          {!eligible && (
            <label>
              Reason code
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Payer response code"
                required
              />
            </label>
          )}
        </div>
        {error && (
          <div className="form-error">
            <XCircle size={16} /> {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                <BadgeCheck size={17} /> Save payer response
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function PatientsPage({
  patients,
  plans,
  loading,
  refresh,
}: {
  patients: Patient[];
  plans: Plan[];
  loading: boolean;
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [verification, setVerification] = useState<
    Patient["insurance"][number] | null
  >(null);
  const [message, setMessage] = useState("");
  const filtered = patients.filter((p) =>
    `${p.first_name} ${p.last_name} ${p.email || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="page-heading compact">
        <div>
          <p className="eyebrow">Coverage registry</p>
          <h1>Patients</h1>
          <p>Member records and payer-confirmed insurance eligibility.</p>
        </div>
        <button className="button primary" onClick={() => setModal(true)}>
          <UserPlus size={18} /> Add patient
        </button>
      </section>
      <section className="panel">
        <div className="toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
            />
          </div>
          <span className="record-count">{filtered.length} records</span>
        </div>
        {message && <div className="inline-message">{message}</div>}
        {loading ? (
          <div className="loading-row">
            <LoaderCircle className="spin" /> Loading patients
          </div>
        ) : filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Coverage</th>
                  <th>Member ID</th>
                  <th>Effective</th>
                  <th>Verification</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient) => {
                  const coverage = patient.insurance[0];
                  return (
                    <tr key={patient.id}>
                      <td>
                        <div className="person">
                          <span>
                            {patient.first_name[0]}
                            {patient.last_name[0]}
                          </span>
                          <div>
                            <strong>
                              {patient.first_name} {patient.last_name}
                            </strong>
                            <small>
                              PT-{String(patient.id).padStart(5, "0")} · born{" "}
                              {patient.dob}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong>
                          {coverage?.plan_name ||
                            coverage?.payer_id ||
                            "No coverage"}
                        </strong>
                        <small>{coverage?.priority}</small>
                      </td>
                      <td className="mono">{coverage?.member_id || "—"}</td>
                      <td>{coverage?.effective_date || "—"}</td>
                      <td>
                        {coverage?.last_verified_at ? (
                          <span className="verified">
                            <CheckCircle2 size={16} />{" "}
                            <span>
                              {date.format(new Date(coverage.last_verified_at))}
                              {coverage.eligibility_source_reference && (
                                <small>
                                  {coverage.eligibility_source_reference}
                                </small>
                              )}
                            </span>
                          </span>
                        ) : (
                          <span className="muted">Not verified</span>
                        )}
                      </td>
                      <td className="right">
                        {coverage && (
                          <button
                            className="button tiny secondary"
                            onClick={() => setVerification(coverage)}
                          >
                            <RefreshCw size={15} /> Record response
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No matching patients"
            body="Add a patient or adjust the search."
          />
        )}
      </section>
      {modal && (
        <PatientModal
          plans={plans}
          onClose={() => setModal(false)}
          onCreated={() => {
            setModal(false);
            void refresh();
          }}
        />
      )}
      {verification && (
        <EligibilityModal
          coverage={verification}
          onClose={() => setVerification(null)}
          onSaved={(savedMessage) => {
            setMessage(savedMessage);
            setVerification(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function AdjudicatePage({
  patients,
  plans,
  refreshClaims,
  openClaim,
}: {
  patients: Patient[];
  plans: Plan[];
  refreshClaims: () => Promise<void>;
  openClaim: (id: number) => void;
}) {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [form, setForm] = useState<ClaimInput>({
    patient_id: patients[0]?.id || 0,
    plan_id: patients[0]?.insurance[0]?.plan_id || plans[0]?.id || 0,
    province: "AB",
    provider_billing_number: "AB123456",
    service_date: today,
    received_date: today,
    injury_classification: "unknown",
    lines: [
      { service_code: "03.03A", diagnosis_code: "M54.5", units: 1, amount: 85 },
    ],
  });
  const selectedPatient = patients.find((p) => p.id === form.patient_id);
  useEffect(() => {
    if (!form.patient_id && patients[0])
      setForm((old) => ({
        ...old,
        patient_id: patients[0]!.id,
        plan_id: patients[0]!.insurance[0]?.plan_id || plans[0]?.id || 0,
      }));
  }, [patients, plans, form.patient_id]);
  const selectPatient = (id: number) => {
    const p = patients.find((item) => item.id === id);
    setForm((old) => ({
      ...old,
      patient_id: id,
      plan_id: p?.insurance[0]?.plan_id || old.plan_id,
    }));
  };
  const setLine = (index: number, key: string, value: string | number) =>
    setForm((old) => ({
      ...old,
      lines: old.lines.map((line, i) =>
        i === index ? { ...line, [key]: value } : line,
      ),
    }));
  const addLine = () =>
    setForm((old) => ({
      ...old,
      lines: [
        ...old.lines,
        { service_code: "", diagnosis_code: "", units: 1, amount: 0 },
      ],
    }));
  const removeLine = (index: number) =>
    setForm((old) => ({
      ...old,
      lines: old.lines.filter((_, i) => i !== index),
    }));
  async function evaluate() {
    setBusy(true);
    setError("");
    try {
      setDecision(await api.evaluate(form));
      setSavedId(null);
      setStep(3);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evaluation failed");
    } finally {
      setBusy(false);
    }
  }
  async function submitClaim() {
    setBusy(true);
    setError("");
    try {
      const result = await api.submitClaim(form);
      setDecision(result.decision);
      setSavedId(result.id);
      await refreshClaims();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Claim submission failed",
      );
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setStep(1);
    setDecision(null);
    setSavedId(null);
    setError("");
  }
  return (
    <>
      <section className="page-heading compact">
        <div>
          <p className="eyebrow">Claim workbench</p>
          <h1>Adjudicate a claim</h1>
          <p>Build, inspect, and persist a traceable decision.</p>
        </div>
      </section>
      <div className="stepper">
        <span className={step >= 1 ? "active" : ""}>
          <b>{step > 1 ? <Check size={15} /> : "1"}</b> Patient & plan
        </span>
        <i />
        <span className={step >= 2 ? "active" : ""}>
          <b>{step > 2 ? <Check size={15} /> : "2"}</b> Service lines
        </span>
        <i />
        <span className={step >= 3 ? "active" : ""}>
          <b>3</b> Decision
        </span>
      </div>
      {step === 1 && (
        <section className="panel workbench">
          <div className="section-title">
            <span>
              <Users size={19} />
            </span>
            <div>
              <h2>Select patient and coverage</h2>
              <p>Choose the member whose coverage applies to this claim.</p>
            </div>
          </div>
          {patients.length ? (
            <div className="form-grid two">
              <label>
                Patient
                <select
                  value={form.patient_id}
                  onChange={(e) => selectPatient(Number(e.target.value))}
                >
                  {patients.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.first_name} {p.last_name} · PT-{p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Plan
                <select
                  value={form.plan_id}
                  onChange={(e) =>
                    setForm({ ...form, plan_id: Number(e.target.value) })
                  }
                >
                  {plans.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.name} · {p.layer}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="A patient is required"
              body="Add a patient and coverage from the Patients section first."
            />
          )}
          {selectedPatient && (
            <div className="member-summary">
              <div className="person large">
                <span>
                  {selectedPatient.first_name[0]}
                  {selectedPatient.last_name[0]}
                </span>
                <div>
                  <strong>
                    {selectedPatient.first_name} {selectedPatient.last_name}
                  </strong>
                  <small>
                    Born {selectedPatient.dob} · {selectedPatient.province}
                  </small>
                </div>
              </div>
              <div>
                {selectedPatient.insurance.map((c) => (
                  <div className="coverage-chip" key={c.id}>
                    <ShieldCheck size={16} />
                    <span>
                      <strong>
                        {c.plan_name || c.payer_id || `Plan ${c.plan_id}`}
                      </strong>
                      <small>
                        {c.member_id} ·{" "}
                        {c.last_verified_at
                          ? "Verified"
                          : "Verification required"}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="form-actions">
            <span />
            <button
              className="button primary"
              disabled={!form.patient_id || !form.plan_id}
              onClick={() => setStep(2)}
            >
              Continue <ArrowRight size={17} />
            </button>
          </div>
        </section>
      )}
      {step === 2 && (
        <section className="panel workbench">
          <div className="section-title">
            <span>
              <FileText size={19} />
            </span>
            <div>
              <h2>Claim details and service lines</h2>
              <p>
                Enter billed services using the plan’s configured code system.
              </p>
            </div>
          </div>
          <div className="form-grid three">
            <label>
              Provider billing number
              <input
                value={form.provider_billing_number}
                onChange={(e) =>
                  setForm({ ...form, provider_billing_number: e.target.value })
                }
                required
              />
            </label>
            <label>
              Service date
              <input
                type="date"
                value={form.service_date}
                onChange={(e) =>
                  setForm({ ...form, service_date: e.target.value })
                }
              />
            </label>
            <label>
              Received date
              <input
                type="date"
                value={form.received_date}
                onChange={(e) =>
                  setForm({ ...form, received_date: e.target.value })
                }
              />
            </label>
            <label>
              Injury classification
              <select
                value={form.injury_classification}
                onChange={(e) =>
                  setForm({
                    ...form,
                    injury_classification: e.target
                      .value as ClaimInput["injury_classification"],
                  })
                }
              >
                <option value="unknown">Not applicable / unknown</option>
                <option value="minor">Minor injury</option>
                <option value="non_minor">Non-minor injury</option>
              </select>
            </label>
            <label>
              Date of loss <span>auto claims</span>
              <input
                type="date"
                value={form.date_of_loss || ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    date_of_loss: e.target.value || undefined,
                  })
                }
              />
            </label>
          </div>
          <div className="lines-head">
            <div>
              <h3>Service lines</h3>
              <p>{form.lines.length} of 50 lines</p>
            </div>
            <button className="button secondary small" onClick={addLine}>
              <Plus size={16} /> Add line
            </button>
          </div>
          <div className="service-lines">
            {form.lines.map((line, index) => (
              <div className="service-line" key={index}>
                <div className="line-number">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <label>
                  Service code
                  <input
                    value={line.service_code}
                    onChange={(e) =>
                      setLine(index, "service_code", e.target.value)
                    }
                    placeholder="03.03A"
                  />
                </label>
                <label>
                  Diagnosis
                  <input
                    value={line.diagnosis_code}
                    onChange={(e) =>
                      setLine(index, "diagnosis_code", e.target.value)
                    }
                    placeholder="M54.5"
                  />
                </label>
                <label>
                  Units
                  <input
                    type="number"
                    min="1"
                    value={line.units}
                    onChange={(e) =>
                      setLine(index, "units", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Amount (CAD)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.amount}
                    onChange={(e) =>
                      setLine(index, "amount", Number(e.target.value))
                    }
                  />
                </label>
                {form.lines.length > 1 && (
                  <button
                    className="remove-line"
                    aria-label="Remove line"
                    onClick={() => removeLine(index)}
                  >
                    <X size={17} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {error && (
            <div className="form-error">
              <XCircle size={16} />
              {error}
            </div>
          )}
          <div className="form-actions">
            <button className="button secondary" onClick={() => setStep(1)}>
              <ArrowLeft size={17} /> Back
            </button>
            <button
              className="button primary"
              onClick={evaluate}
              disabled={
                busy ||
                form.lines.some(
                  (l) => !l.service_code || !l.diagnosis_code || l.amount <= 0,
                )
              }
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <>
                  <Sparkles size={17} /> Run evaluation
                </>
              )}
            </button>
          </div>
        </section>
      )}
      {step === 3 && decision && (
        <DecisionView
          decision={decision}
          savedId={savedId}
          busy={busy}
          onSubmit={submitClaim}
          onOpen={() => savedId && openClaim(savedId)}
          onReset={reset}
        />
      )}
    </>
  );
}

function DecisionView({
  decision,
  savedId,
  busy,
  onSubmit,
  onOpen,
  onReset,
}: {
  decision: Decision;
  savedId: number | null;
  busy: boolean;
  onSubmit: () => void;
  onOpen: () => void;
  onReset: () => void;
}) {
  const icon = ["ACCEPT", "PARTIAL"].includes(decision.outcome)
    ? CheckCircle2
    : decision.outcome === "PEND"
      ? Clock3
      : XCircle;
  const Icon = icon;
  const fired = decision.trace?.filter((t) => t.fired) || [];
  return (
    <section className="decision-layout">
      <article className={`decision-hero ${decision.outcome.toLowerCase()}`}>
        <div className="decision-symbol">
          <Icon size={30} />
        </div>
        <div>
          <p className="eyebrow">Engine decision</p>
          <h2>{decision.outcome}</h2>
          <p>
            {decision.primary_reason_code
              ? `Primary reason: ${decision.primary_reason_code}`
              : "All required checks passed."}
          </p>
        </div>
        <StatusPill value={decision.suggested_status} />
      </article>
      <div className="decision-columns">
        <article className="panel">
          <div className="panel-head">
            <div>
              <h2>Financial summary</h2>
              <p>
                Calculated across {decision.lines.length} service line
                {decision.lines.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="money-grid">
            <div>
              <span>Billed</span>
              <strong>{money.format(decision.billed_amount)}</strong>
            </div>
            <div className="plan-pay">
              <span>Plan pays</span>
              <strong>{money.format(decision.plan_pays_total)}</strong>
            </div>
            <div>
              <span>Member pays</span>
              <strong>{money.format(decision.member_pays_total)}</strong>
            </div>
          </div>
          <div className="decision-lines">
            {decision.lines.map((line) => (
              <div key={line.line_no}>
                <span className="line-index">{line.line_no}</span>
                <div>
                  <strong>Service line {line.line_no}</strong>
                  <small>
                    {line.reasons[0]?.message ||
                      `${line.allowed_units} unit(s) allowed`}
                  </small>
                </div>
                <StatusPill value={line.outcome} />
                <b>{money.format(line.plan_pays)}</b>
              </div>
            ))}
          </div>
        </article>
        <article className="panel trace-panel">
          <div className="panel-head">
            <div>
              <h2>Rule trace</h2>
              <p>
                {fired.length} rule{fired.length === 1 ? "" : "s"} fired ·
                engine {decision.engine_version}
              </p>
            </div>
          </div>
          {fired.length ? (
            <div className="trace-list">
              {fired.map((trace, i) => (
                <div key={`${trace.rule}-${i}`}>
                  <span className="trace-node" />
                  <div>
                    <strong>{trace.rule}</strong>
                    <small>
                      Stage {trace.stage}
                      {trace.line_no ? ` · Line ${trace.line_no}` : ""}
                    </small>
                  </div>
                  <StatusPill value={trace.outcome} />
                </div>
              ))}
            </div>
          ) : (
            <div className="all-clear">
              <ShieldCheck size={24} />
              <div>
                <strong>No exception rules fired</strong>
                <p>
                  The claim passed configured eligibility and benefit checks.
                </p>
              </div>
            </div>
          )}
          {decision.review_prompts.length > 0 && (
            <div className="review-prompts">
              {decision.review_prompts.map((prompt) => (
                <p key={prompt}>
                  <Clock3 size={15} />
                  {prompt}
                </p>
              ))}
            </div>
          )}
        </article>
      </div>
      {errorBlock(decision.errors)}
      <div className="decision-actions">
        <button className="button secondary" onClick={onReset}>
          Start another
        </button>
        {savedId ? (
          <button className="button primary" onClick={onOpen}>
            Open claim CLM-{String(savedId).padStart(5, "0")}{" "}
            <ArrowRight size={17} />
          </button>
        ) : (
          <button className="button primary" onClick={onSubmit} disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                <FileCheck2 size={17} /> Submit claim
              </>
            )}
          </button>
        )}
      </div>
    </section>
  );
}

function errorBlock(errors: Decision["errors"]) {
  return errors.length ? (
    <div className="decision-notes">
      <strong>Decision reasons</strong>
      {errors.map((e) => (
        <p key={e.code}>
          <span>{e.code}</span>
          {e.message}
        </p>
      ))}
    </div>
  ) : null;
}

function ClaimsPage({
  claims,
  loading,
  openClaim,
}: {
  claims: ClaimSummary[];
  loading: boolean;
  openClaim: (id: number) => void;
}) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const shown = claims.filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      `${c.id} ${c.patient_name} ${c.plan_code || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <section className="page-heading compact">
        <div>
          <p className="eyebrow">Operations queue</p>
          <h1>Claims</h1>
          <p>Review persisted decisions, outcomes, and payment liability.</p>
        </div>
      </section>
      <section className="panel">
        <div className="toolbar claims-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search claim, patient, or plan"
            />
          </div>
          <div className="filter-tabs">
            {["all", "paid", "pended", "denied", "rejected"].map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={filter === item ? "active" : ""}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="loading-row">
            <LoaderCircle className="spin" /> Loading claims
          </div>
        ) : shown.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Claim</th>
                  <th>Patient</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Service date</th>
                  <th className="right">Billed</th>
                  <th className="right">Plan pays</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((claim) => (
                  <tr key={claim.id} onClick={() => openClaim(claim.id)}>
                    <td>
                      <strong>CLM-{String(claim.id).padStart(5, "0")}</strong>
                      <small>{date.format(new Date(claim.created_at))}</small>
                    </td>
                    <td>
                      <strong>{claim.patient_name}</strong>
                      <small>
                        PT-{String(claim.patient_id).padStart(5, "0")}
                      </small>
                    </td>
                    <td>{claim.plan_code || "—"}</td>
                    <td>
                      <StatusPill value={claim.outcome || claim.status} />
                    </td>
                    <td>{claim.service_date}</td>
                    <td className="right">
                      {money.format(claim.billed_amount)}
                    </td>
                    <td className="right">
                      <strong>{money.format(claim.plan_pays_total)}</strong>
                    </td>
                    <td>
                      <ChevronRight size={17} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="No matching claims"
            body="Adjust the filters or submit an adjudication."
          />
        )}
      </section>
    </>
  );
}

function ClaimDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .claim(id)
      .then(setClaim)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <div className="drawer-layer">
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label="Close claim"
      />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Claim detail</p>
            <h2>CLM-{String(id).padStart(5, "0")}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        {error ? (
          <div className="form-error">{error}</div>
        ) : !claim ? (
          <div className="loading-row">
            <LoaderCircle className="spin" /> Loading claim
          </div>
        ) : (
          <div className="drawer-content">
            <div className="claim-summary">
              <div>
                <span>Current status</span>
                <StatusPill value={claim.status} />
              </div>
              <div>
                <span>Billed amount</span>
                <strong>{money.format(claim.billed_amount)}</strong>
              </div>
              <div>
                <span>Patient</span>
                <strong>PT-{String(claim.patient_id).padStart(5, "0")}</strong>
              </div>
            </div>
            {claim.decision && (
              <>
                <div
                  className={`drawer-outcome ${claim.decision.outcome.toLowerCase()}`}
                >
                  <div>
                    <span>Decision</span>
                    <h3>{claim.decision.outcome}</h3>
                  </div>
                  <div>
                    <span>Plan pays</span>
                    <h3>{money.format(claim.decision.plan_pays_total)}</h3>
                  </div>
                  <div>
                    <span>Member pays</span>
                    <h3>{money.format(claim.decision.member_pays_total)}</h3>
                  </div>
                </div>
                {errorBlock(claim.decision.errors)}
                <h3 className="drawer-section-title">Service lines</h3>
                <div className="drawer-lines">
                  {claim.decision.lines.map((line) => (
                    <div key={line.line_no}>
                      <span>{line.line_no}</span>
                      <div>
                        <strong>
                          {money.format(line.eligible_amount)} eligible
                        </strong>
                        <small>
                          {line.reasons[0]?.message ||
                            `${line.allowed_units} units allowed`}
                        </small>
                      </div>
                      <StatusPill value={line.outcome} />
                    </div>
                  ))}
                </div>
              </>
            )}
            <h3 className="drawer-section-title">Status history</h3>
            <div className="history-list">
              {claim.status_history.map((item) => (
                <div key={item.id}>
                  <span />
                  <div>
                    <strong>
                      {item.from_status} → {item.to_status}
                    </strong>
                    <small>
                      {date.format(new Date(item.created_at))}
                      {item.reason_code ? ` · ${item.reason_code}` : ""}
                    </small>
                  </div>
                </div>
              ))}
            </div>
            {claim.flags
              .filter((f) => !f.cleared_at)
              .map((flag) => (
                <div className="flag" key={flag.id}>
                  <Clock3 size={16} />
                  {flag.flag.replaceAll("_", " ")}
                </div>
              ))}
          </div>
        )}
      </aside>
    </div>
  );
}

function PlanImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [definition, setDefinition] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const parsed = JSON.parse(definition) as Record<string, unknown>;
      await api.createPlan(parsed);
      onImported();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Plan import failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-scrim" onClick={onClose} aria-label="Close" />
      <form className="modal-card plan-import-modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Versioned configuration</p>
            <h2>Import reviewed plan</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <p className="muted import-guidance">
          Paste a complete plan definition supplied and reviewed by your payer
          or benefits administrator. Monetary configuration uses integer cents.
        </p>
        <label>
          Plan JSON
          <textarea
            value={definition}
            onChange={(event) => setDefinition(event.target.value)}
            placeholder='{"planId":"...","version":1,"payerId":"..."}'
            spellCheck={false}
            required
          />
        </label>
        {error && (
          <div className="form-error">
            <XCircle size={16} /> {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !definition.trim()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <>
                <FileCheck2 size={17} /> Import plan
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function RulesPage({
  plans,
  rules,
  refresh,
}: {
  plans: Plan[];
  rules: Rule[];
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"plans" | "rules">("plans");
  const [importing, setImporting] = useState(false);
  const stages = [
    "Eligibility gates",
    "Claim validity",
    "Benefit eligibility",
    "Benefit calculation",
  ];
  return (
    <>
      <section className="page-heading compact">
        <div>
          <p className="eyebrow">Configuration library</p>
          <h1>Plans & rules</h1>
          <p>
            Inspect the versioned definitions that make every decision
            reproducible.
          </p>
        </div>
        <div className="heading-actions">
          <a className="button secondary" href="/docs/" target="_blank">
            <BookOpen size={17} /> API reference
          </a>
          {getTokenRole() === "admin" && (
            <button
              className="button primary"
              onClick={() => setImporting(true)}
            >
              <Plus size={17} /> Import plan
            </button>
          )}
        </div>
      </section>
      <div className="subtabs">
        <button
          className={tab === "plans" ? "active" : ""}
          onClick={() => setTab("plans")}
        >
          Coverage plans <span>{plans.length}</span>
        </button>
        <button
          className={tab === "rules" ? "active" : ""}
          onClick={() => setTab("rules")}
        >
          Rule catalogue <span>{rules.length}</span>
        </button>
      </div>
      {tab === "plans" ? (
        <section className="plan-grid">
          {plans.map((plan) => (
            <article className="plan-card" key={plan.id}>
              <div className={`plan-icon ${plan.layer}`}>
                <ShieldCheck size={22} />
              </div>
              <div className="plan-card-head">
                <div>
                  <span className="layer-label">{plan.layer} coverage</span>
                  <h2>{plan.name}</h2>
                </div>
                <StatusPill value="active" />
              </div>
              <dl>
                <div>
                  <dt>Plan code</dt>
                  <dd>{plan.plan_id}</dd>
                </div>
                <div>
                  <dt>Payer ID</dt>
                  <dd>{plan.payer_id}</dd>
                </div>
                <div>
                  <dt>Plan type</dt>
                  <dd>{plan.plan_type}</dd>
                </div>
              </dl>
              <div className="plan-foot">
                <span>
                  <FileCheck2 size={16} /> Versioned definition
                </span>
                <span>ID {plan.id}</span>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="rule-stages">
          {stages.map((name, stage) => (
            <article className="panel rule-stage" key={name}>
              <div className="stage-marker">
                <span>{stage}</span>
                <i />
              </div>
              <div>
                <div className="stage-title">
                  <h2>{name}</h2>
                  <span>
                    {rules.filter((r) => r.stage === stage).length} rules
                  </span>
                </div>
                <div className="rule-list">
                  {rules
                    .filter((r) => r.stage === stage)
                    .map((rule) => (
                      <div key={rule.id}>
                        <code>{rule.id}</code>
                        <strong>{rule.description}</strong>
                        <span>Stage {rule.stage}</span>
                      </div>
                    ))}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
      {importing && (
        <PlanImportModal
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            void refresh();
          }}
        />
      )}
    </>
  );
}

export function App() {
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  const [page, setPage] = useState<Page>("overview");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [claimId, setClaimId] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!getToken()) return;
    setLoading(true);
    setError("");
    try {
      const [patientRows, planRows, claimRows, ruleRows] = await Promise.all([
        api.patients(),
        api.plans(),
        api.claims(),
        api.rules(),
      ]);
      setPatients(patientRows);
      setPlans(planRows);
      setClaims(claimRows);
      setRules(ruleRows);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load workspace",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  const refreshPatients = useCallback(
    async () => setPatients(await api.patients()),
    [],
  );
  const refreshClaims = useCallback(
    async () => setClaims(await api.claims()),
    [],
  );
  const refreshPlans = useCallback(async () => setPlans(await api.plans()), []);
  useEffect(() => {
    if (authenticated) void load();
    const unauthorized = () => setAuthenticated(false);
    window.addEventListener("rules:unauthorized", unauthorized);
    return () => window.removeEventListener("rules:unauthorized", unauthorized);
  }, [authenticated, load]);
  if (!authenticated) return <Login onSuccess={() => setAuthenticated(true)} />;
  const logout = () => {
    void api.logout().finally(() => {
      setToken(null);
      setAuthenticated(false);
    });
  };
  return (
    <Shell page={page} setPage={setPage} onLogout={logout}>
      {error && (
        <div className="banner-error">
          <XCircle size={18} />
          <span>{error}</span>
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {page === "overview" && (
        <Dashboard
          claims={claims}
          patients={patients}
          plans={plans}
          loading={loading}
          navigate={setPage}
          openClaim={setClaimId}
        />
      )}
      {page === "adjudicate" && (
        <AdjudicatePage
          patients={patients}
          plans={plans}
          refreshClaims={refreshClaims}
          openClaim={setClaimId}
        />
      )}
      {page === "patients" && (
        <PatientsPage
          patients={patients}
          plans={plans}
          loading={loading}
          refresh={refreshPatients}
        />
      )}
      {page === "claims" && (
        <ClaimsPage claims={claims} loading={loading} openClaim={setClaimId} />
      )}
      {page === "rules" && (
        <RulesPage plans={plans} rules={rules} refresh={refreshPlans} />
      )}
      {claimId && <ClaimDrawer id={claimId} onClose={() => setClaimId(null)} />}
    </Shell>
  );
}
