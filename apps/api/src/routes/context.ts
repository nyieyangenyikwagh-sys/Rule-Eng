import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type {
  FastifyInstance,
  FastifyBaseLogger,
  FastifyRequest,
} from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Counter } from "prom-client";
import type { Config } from "../config.js";
import type { Database } from "../db/client.js";
export type Api = FastifyInstance<
  Server,
  IncomingMessage,
  ServerResponse,
  FastifyBaseLogger,
  ZodTypeProvider
>;
type Access = (request: FastifyRequest) => Promise<void>;
export interface RoutesContext {
  app: Api;
  db: Database;
  config: Config;
  now: () => Date;
  any: Access;
  write: Access;
  admin: Access;
  access: (roles: string[], scope?: string) => Access;
  secure: { security: Record<string, string[]>[] };
  outcomes: Counter<"outcome">;
}
