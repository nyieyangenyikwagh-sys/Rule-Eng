import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { planDefinitionSchema } from "@alberta-rules/core";
import { connectDatabase, type Database } from "../apps/api/src/db/client.js";
import * as s from "../apps/api/src/db/schema.js";
import { hashPassword } from "../apps/api/src/services/security.js";
export async function seedPlans(db: Database) {
  for (const name of (await readdir("examples/plans"))
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const p = planDefinitionSchema.parse(
      JSON.parse(await readFile(`examples/plans/${name}`, "utf8")),
    );
    await db
      .insert(s.insurancePlans)
      .values({
        planId: p.planId,
        payerId: p.layer === "auto" ? "AB_AUTO" : p.payerId,
        name: p.planId,
        layer: p.layer,
      })
      .onConflictDoNothing();
    const [row] = await db
      .select()
      .from(s.insurancePlans)
      .where(eq(s.insurancePlans.planId, p.planId));
    await db
      .insert(s.planVersions)
      .values({
        planId: row!.id,
        version: p.version,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        definition: p,
      })
      .onConflictDoNothing();
  }
}
export async function seedAdmin(db: Database, email: string, password: string) {
  if (password.length < 12)
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters");
  await db
    .insert(s.users)
    .values({
      email: email.toLowerCase(),
      hashedPassword: await hashPassword(password),
      role: "admin",
    })
    .onConflictDoNothing();
}
