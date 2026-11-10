import { z } from "zod";
import { eq, isNotNull, lt, or } from "drizzle-orm";
import {
  hashPassword,
  verifyPassword,
  hashKey,
  newApiKey,
  newSessionToken,
  httpError,
} from "../services/security.js";
import { audit } from "../services/adjudication.js";
import * as s from "../db/schema.js";
import * as schemas from "../schemas.js";
import type { RoutesContext } from "./context.js";
export function registerAuthRoutes(context: RoutesContext) {
  const { app, db, config, now, any, admin, secure } = context;
  app.post(
    "/api/v1/auth/register",
    {
      preHandler: admin,
      schema: {
        ...secure,
        body: schemas.registerSchema,
        summary: "Provision a PostgreSQL-backed user account",
        tags: ["Authentication"],
      },
    },
    async (req, reply) => {
      const [user] = await db
        .insert(s.users)
        .values({
          email: req.body.email.toLowerCase(),
          hashedPassword: await hashPassword(req.body.password),
          role: req.body.role,
        })
        .returning({
          id: s.users.id,
          email: s.users.email,
          role: s.users.role,
        });
      return reply.code(201).send(user);
    },
  );
  app.post(
    "/api/v1/auth/login",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: schemas.loginSchema,
        summary: "Log in using username and password (JSON or form)",
        tags: ["Authentication"],
      },
    },
    async (req) => {
      const [user] = await db
        .select()
        .from(s.users)
        .where(eq(s.users.email, req.body.username.toLowerCase()));
      if (
        !user?.isActive ||
        !(await verifyPassword(req.body.password, user.hashedPassword))
      )
        throw httpError(401, "Invalid credentials");
      const token = newSessionToken();
      const expiresAt = new Date(
        now().getTime() + config.SESSION_TTL_MINUTES * 60_000,
      ).toISOString();
      await db
        .delete(s.authSessions)
        .where(
          or(
            lt(s.authSessions.expiresAt, now().toISOString()),
            isNotNull(s.authSessions.revokedAt),
          ),
        );
      await db.insert(s.authSessions).values({
        userId: user.id,
        tokenHash: hashKey(token),
        expiresAt,
        lastUsedAt: now().toISOString(),
      });
      await audit(
        db,
        { userId: user.id, role: user.role, ip: req.ip },
        "login",
        `user:${user.id}`,
      );
      return {
        access_token: token,
        token_type: "bearer",
        expires_at: expiresAt,
        user: { id: user.id, email: user.email, role: user.role },
      };
    },
  );
  app.post(
    "/api/v1/auth/logout",
    {
      preHandler: any,
      schema: {
        ...secure,
        summary: "Revoke the current PostgreSQL session",
        tags: ["Authentication"],
      },
    },
    async (req) => {
      const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (token)
        await db
          .update(s.authSessions)
          .set({ revokedAt: now().toISOString() })
          .where(eq(s.authSessions.tokenHash, hashKey(token)));
      await audit(db, req.actor!, "logout", `user:${req.actor!.userId}`);
      return { revoked: true };
    },
  );
  app.post(
    "/api/v1/api-keys",
    {
      preHandler: admin,
      schema: {
        ...secure,
        body: z.strictObject({
          name: z.string().min(1).max(100),
          scopes: z.array(z.enum(["evaluate:write", "claims:read"])).min(1),
        }),
        summary: "Issue a service key; shown once",
        tags: ["Authentication"],
      },
    },
    async (req, reply) => {
      const key = newApiKey();
      const [row] = await db
        .insert(s.apiKeys)
        .values({ ...req.body, keyHash: hashKey(key) })
        .returning({
          id: s.apiKeys.id,
          name: s.apiKeys.name,
          scopes: s.apiKeys.scopes,
        });
      await audit(db, req.actor!, "create", `api_key:${row!.id}`);
      return reply.code(201).send({ ...row, key });
    },
  );
  app.delete(
    "/api/v1/api-keys/:id",
    {
      preHandler: admin,
      schema: {
        ...secure,
        params: schemas.idParams,
        summary: "Revoke a service key",
        tags: ["Authentication"],
      },
    },
    async (req) => {
      const rows = await db
        .update(s.apiKeys)
        .set({ revokedAt: now().toISOString() })
        .where(eq(s.apiKeys.id, req.params.id))
        .returning();
      if (!rows.length) throw httpError(404, "API key not found");
      await audit(db, req.actor!, "delete", `api_key:${req.params.id}`);
      return { revoked: true };
    },
  );
}
