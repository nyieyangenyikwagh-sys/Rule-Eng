# Operations

## Configuration and secrets

The application requires PostgreSQL through DATABASE_URL. Set ENVIRONMENT=production, HOST=0.0.0.0, the platform-provided PORT, and SESSION_TTL_MINUTES as required. Redis and a JWT signing secret are not used.

The first administrator is created by npm run bootstrap:admin from BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD. The command is idempotent and never resets an existing password. Remove those bootstrap values from the runtime service after initialization when the platform permits separate pre-deploy secrets.

Login tokens are 48 random bytes. PostgreSQL stores only their SHA-256 hashes, expiry, last-use time, and revocation time. API keys are 32 random bytes, disclosed once, hashed, scoped, and revocable.

## Deployment and rollback

1. Run build, typecheck, and dependency audit.
2. Build and tag the Docker image with the release SHA.
3. Back up the target database.
4. Run npm run db:migrate, then npm run bootstrap:admin for a new environment.
5. Start the same image and check /health, /ready, /docs/, login, and a reviewed non-production evaluation.
6. Monitor error counts, latency, authentication failures, and decision outcomes.

docker-compose.yml carries out migration and bootstrap before starting the application. render.yaml and railway.json use the same pre-deploy commands. Point DATABASE_URL at managed PostgreSQL with the provider's required TLS configuration.

Roll back to the previous application image when needed. Migrations are forward-only and must remain compatible with the preceding release until it is retired. Never delete or rewrite immutable adjudications, plan versions, status history, or audit records during rollback.

## Database safeguards

Claim creation locks patient and accumulator rows in one transaction. Idempotency keys use transaction advisory locks, are scoped to the actor, and expire after 24 hours. Failed transactions leave neither claims nor partial ledger changes.

Database triggers prevent updates and deletes of adjudications, line results, plan versions, status history, and audit entries. Monetary constraints enforce nonnegative values and conservation of eligible amounts. Adjudications retain input snapshots for replay.

Use a dedicated, non-superuser PostgreSQL role in hosted environments. Restrict network access to the application and administrative paths. The test database must remain separate and disposable.

## Authentication operations

- POST /api/v1/auth/login creates an opaque PostgreSQL session.
- POST /api/v1/auth/logout revokes the current session.
- Every authenticated request confirms that the session is unexpired, unrevoked, and attached to an active user.
- Administrators provision users; public registration is unavailable.
- Disabling a user blocks all of that user's sessions immediately.

Expired and revoked sessions can be removed independently:

```sql
DELETE FROM auth_sessions
WHERE expires_at < now() OR revoked_at IS NOT NULL;
```

## Eligibility and plan operations

Coverage verification records a payer response supplied by an integration or authorized operator. A source confirmation or transaction reference is mandatory and is written to both the coverage record and audit history. Changing coverage dates clears verification and flags affected claims.

Plan configuration is never seeded in production. Import reviewed plan JSON through the administrator portal, POST /api/v1/plans, or npm run plans:import. Plan versions are immutable; create a new version for every effective change.

The application does not contain credentials or contracts for payer connectivity. An automated connector must authenticate with the payer, map its response into the verification schema, preserve the payer reference, and undergo organization security and privacy review.

## Observability

- /health: public process liveness.
- /ready: public PostgreSQL connectivity; returns 503 when unavailable.
- /metrics: administrator session required.
- Request logs include request ID, route, and status. Bodies are not logged; authorization headers and sensitive fields are redacted.
- The trace query option returns deterministic rule evidence. Stored adjudications retain the complete trace.

Alert on HTTP 5xx, readiness failure, repeated authentication failure, p95 latency outside the approved target, and material changes in decision outcomes.

## Backups, recovery, and retention

Enable daily backups and point-in-time recovery. Quarterly, restore into isolated staging, validate stored input snapshots and decisions, and record recovery time.

Do not purge adjudication or audit records until the data custodian approves a retention policy and archival process. Expired idempotency rows may be deleted independently:

```sql
DELETE FROM idempotency_keys WHERE expires_at < now();
```

Privacy review, approved data residency, retention, role assignment, authoritative plan data, and payer integration validation remain deployment responsibilities.
