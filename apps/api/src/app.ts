import { registerAuthRoutes } from "./routes/auth.js";
import { registerPatientsRoutes } from "./routes/patients.js";
import { registerPlansRoutes } from "./routes/plans.js";
import { registerClaimsRoutes } from "./routes/claims.js";
import Fastify, { type FastifyRequest, type FastifyError } from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import formbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { ZodError } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Registry, Counter, Histogram } from "prom-client";
import { GuardError } from "@alberta-rules/core";
import type { Config } from "./config.js";
import { connectDatabase } from "./db/client.js";
import * as s from "./db/schema.js";
import { hashKey, httpError } from "./services/security.js";
import { audit, type Actor } from "./services/adjudication.js";

declare module "fastify" {
  interface FastifyRequest {
    actor: Actor | null;
  }
}
export async function buildApp(
  config: Config,
  options: { now?: () => Date; logger?: boolean } = {},
) {
  const now = options.now ?? (() => new Date());
  const { db, pool } = connectDatabase(config.DATABASE_URL);
  const app = Fastify({
    bodyLimit: 256 * 1024,
    logger:
      options.logger === false
        ? false
        : {
            level: "info",
            redact: [
              "req.headers.authorization",
              'req.headers["x-api-key"]',
              "health_card_number",
              "first_name",
              "last_name",
              "dob",
              "member_id",
            ],
            serializers: {
              req: (r) => ({
                method: r.method,
                url: r.url?.split("?")[0],
                id: r.id,
              }),
            },
          },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest("actor", null);
  await app.register(formbody);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Alberta Insurance Rules Engine",
        version: "1.0.0",
        description:
          "Claims decision support with PostgreSQL-backed users, sessions, coverage records, plan versions, adjudications, and audit history.",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "Opaque session",
          },
          apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: "1 minute",
    keyGenerator: (req) =>
      typeof req.headers["x-api-key"] === "string"
        ? hashKey(req.headers["x-api-key"])
        : req.ip,
  });
  const metrics = new Registry();
  const requests = new Counter({
    name: "rules_http_requests_total",
    help: "Requests by route and status",
    labelNames: ["route", "status"],
    registers: [metrics],
  });
  const latency = new Histogram({
    name: "rules_http_duration_seconds",
    help: "HTTP latency",
    labelNames: ["route"],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.8, 2, 5],
    registers: [metrics],
  });
  const outcomes = new Counter({
    name: "rules_decisions_total",
    help: "Decisions by outcome",
    labelNames: ["outcome"],
    registers: [metrics],
  });
  const guardFailures = new Counter({
    name: "rules_guard_failures_total",
    help: "Eligibility guards",
    labelNames: ["code"],
    registers: [metrics],
  });
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions.url ?? "unmatched";
    requests.inc({ route, status: String(reply.statusCode) });
    latency.observe({ route }, reply.elapsedTime / 1000);
  });
  app.addHook("onClose", async () => {
    await pool.end();
  });
  app.addHook("onError", async (req, _reply) => {
    if (!req.actor) return;
    const patientId = (req.body as { patient_id?: unknown } | undefined)
      ?.patient_id;
    const claimId = (req.params as { id?: unknown } | undefined)?.id;
    const resource =
      typeof patientId === "number" && Number.isSafeInteger(patientId)
        ? `patient:${patientId}`
        : req.routeOptions.url?.startsWith("/api/v1/claims/") &&
            typeof claimId === "number"
          ? `claim:${claimId}`
          : null;
    if (resource)
      try {
        await audit(
          db,
          req.actor,
          "read",
          resource,
          "Request failed after authentication",
        );
      } catch {
        req.log.error({ requestId: req.id }, "Failure audit unavailable");
      }
  });
  app.setErrorHandler((caught, req, reply) => {
    const error = caught as FastifyError;
    if (error instanceof GuardError) {
      guardFailures.inc({ code: error.code });
      return reply.code(422).send({
        detail: error.message,
        code: error.code,
        ...(error.payerReason ? { payer_reason_code: error.payerReason } : {}),
      });
    }
    if (error instanceof ZodError)
      return reply.code(422).send({
        detail: "Validation failed",
        errors: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if (error.validation)
      return reply.code(422).send({
        detail: "Validation failed",
        errors: error.validation.map((i) => ({
          path: i.instancePath,
          message: i.message,
        })),
      });
    const pgCode =
      (error as { code?: string; cause?: { code?: string } }).cause?.code ??
      error.code;
    if (pgCode === "23505" || pgCode === "23P01")
      return reply
        .code(409)
        .send({ detail: "Resource already exists or effective dates overlap" });
    if (pgCode === "23503")
      return reply.code(404).send({ detail: "Referenced resource not found" });
    const status = error.statusCode ?? 500;
    if (status >= 500)
      req.log.error(
        { requestId: req.id, errorType: error.name },
        "Request failed",
      );
    return reply
      .code(status)
      .send({ detail: status >= 500 ? "Service unavailable" : error.message });
  });
  const authenticate = async (req: FastifyRequest) => {
    const key = req.headers["x-api-key"];
    if (typeof key === "string") {
      const [row] = await db
        .select()
        .from(s.apiKeys)
        .where(
          and(eq(s.apiKeys.keyHash, hashKey(key)), isNull(s.apiKeys.revokedAt)),
        );
      if (!row) throw httpError(401, "Invalid API key");
      req.actor = { apiKeyId: row.id, scopes: row.scopes, ip: req.ip };
      await db
        .update(s.apiKeys)
        .set({ lastUsedAt: now().toISOString() })
        .where(eq(s.apiKeys.id, row.id));
      return;
    }
    const authorization = req.headers.authorization;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw httpError(401, "Authentication required");
    const [session] = await db
      .select()
      .from(s.authSessions)
      .where(
        and(
          eq(s.authSessions.tokenHash, hashKey(token)),
          isNull(s.authSessions.revokedAt),
        ),
      );
    if (!session || Date.parse(session.expiresAt) <= now().getTime())
      throw httpError(401, "Session expired");
    const [user] = await db
      .select()
      .from(s.users)
      .where(eq(s.users.id, session.userId));
    if (!user?.isActive) throw httpError(401, "Inactive credentials");
    req.actor = { userId: user.id, role: user.role, ip: req.ip };
    await db
      .update(s.authSessions)
      .set({ lastUsedAt: now().toISOString() })
      .where(eq(s.authSessions.id, session.id));
  };
  const access =
    (roles: string[], scope?: string) => async (req: FastifyRequest) => {
      await authenticate(req);
      if (req.actor!.apiKeyId) {
        if (!scope || !req.actor!.scopes?.includes(scope))
          throw httpError(403, "Insufficient scope");
      } else if (!roles.includes(req.actor!.role!))
        throw httpError(403, "Insufficient role");
    };
  const any = access(["admin", "biller", "analyst"]);
  const write = access(["admin", "biller"]);
  const admin = access(["admin"]);
  const secure: { security: Record<string, string[]>[] } = {
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  };
  app.get(
    "/health",
    { schema: { summary: "Liveness", tags: ["Operations"] } },
    async () => ({
      status: "ok",
    }),
  );
  app.get(
    "/ready",
    { schema: { summary: "Database readiness", tags: ["Operations"] } },
    async (_req, reply) => {
      try {
        await db.execute(sql`select 1`);
        return { status: "ok" };
      } catch {
        return reply.code(503).send({ status: "unavailable" });
      }
    },
  );
  app.get(
    "/metrics",
    {
      preHandler: admin,
      schema: {
        ...secure,
        summary: "Prometheus metrics",
        tags: ["Operations"],
      },
    },
    async (_req, reply) =>
      reply.type(metrics.contentType).send(await metrics.metrics()),
  );
  const routeContext = {
    app,
    db,
    config,
    now,
    any,
    write,
    admin,
    access,
    secure,
    outcomes,
  };
  registerAuthRoutes(routeContext);
  registerPatientsRoutes(routeContext);
  registerPlansRoutes(routeContext);
  registerClaimsRoutes(routeContext);
  const webRoot = resolve(process.cwd(), "apps/web/dist");
  if (existsSync(resolve(webRoot, "index.html"))) {
    await app.register(fastifyStatic, {
      root: webRoot,
      decorateReply: true,
      cacheControl: config.ENVIRONMENT === "production",
      maxAge: config.ENVIRONMENT === "production" ? "1h" : 0,
    });
  }
  await app.ready();
  return { app, db, pool };
}
