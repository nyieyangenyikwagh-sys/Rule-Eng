import "dotenv/config";
import { eq } from "drizzle-orm";
import { connectDatabase } from "../apps/api/src/db/client.js";
import * as s from "../apps/api/src/db/schema.js";
import { hashPassword } from "../apps/api/src/services/security.js";

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!email) throw new Error("BOOTSTRAP_ADMIN_EMAIL is required");
if (!password || password.length < 12)
  throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters");

const { db, pool } = connectDatabase(databaseUrl);
try {
  const [existing] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.email, email));
  if (existing) {
    console.log("Administrator already exists; credentials were not changed.");
  } else {
    await db.insert(s.users).values({
      email,
      hashedPassword: await hashPassword(password),
      role: "admin",
    });
    console.log("Administrator account created in PostgreSQL.");
  }
} finally {
  await pool.end();
}
