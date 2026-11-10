import "dotenv/config";
import { z } from "zod";
export const configSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8000),
  HOST: z.string().default("127.0.0.1"),
  ENVIRONMENT: z
    .enum(["development", "test", "production"])
    .default("development"),
  SESSION_TTL_MINUTES: z.coerce.number().int().min(1).max(10080).default(480),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});
export type Config = z.infer<typeof configSchema>;
export function readConfig() {
  return configSchema.parse(process.env);
}
