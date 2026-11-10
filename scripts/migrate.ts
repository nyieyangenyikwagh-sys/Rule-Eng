import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../apps/api/src/db/client.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const { db, pool } = connectDatabase(process.env.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
