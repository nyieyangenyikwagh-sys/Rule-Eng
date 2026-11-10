import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { planDefinitionSchema } from "@alberta-rules/core";
import { connectDatabase } from "../apps/api/src/db/client.js";
import * as s from "../apps/api/src/db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
const directory = process.env.PLAN_DIRECTORY;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!directory)
  throw new Error(
    "PLAN_DIRECTORY is required and must contain reviewed plan JSON files",
  );

const source = resolve(directory);
const files = (await readdir(source)).filter((name) => name.endsWith(".json"));
if (!files.length) throw new Error(`No plan JSON files found in ${source}`);

const { db, pool } = connectDatabase(databaseUrl);
try {
  for (const name of files.sort()) {
    const definition = planDefinitionSchema.parse(
      JSON.parse(await readFile(resolve(source, name), "utf8")),
    );
    await db.transaction(async (tx) => {
      let [plan] = await tx
        .select()
        .from(s.insurancePlans)
        .where(eq(s.insurancePlans.planId, definition.planId));
      if (!plan) {
        [plan] = await tx
          .insert(s.insurancePlans)
          .values({
            planId: definition.planId,
            payerId: definition.payerId,
            name: definition.planId,
            layer: definition.layer,
            planType: "configured",
          })
          .returning();
      }
      const versions = await tx
        .select()
        .from(s.planVersions)
        .where(eq(s.planVersions.planId, plan!.id));
      if (versions.some((version) => version.version === definition.version)) {
        console.log(
          `${definition.planId} v${definition.version} already exists.`,
        );
        return;
      }
      if (
        versions.some(
          (version) =>
            version.effectiveFrom <= (definition.effectiveTo ?? "9999-12-31") &&
            (version.effectiveTo ?? "9999-12-31") >= definition.effectiveFrom,
        )
      )
        throw new Error(
          `${definition.planId} has an overlapping effective-date window`,
        );
      await tx.insert(s.planVersions).values({
        planId: plan!.id,
        version: definition.version,
        effectiveFrom: definition.effectiveFrom,
        effectiveTo: definition.effectiveTo,
        definition,
      });
      await tx.insert(s.auditLogs).values({
        action: "create",
        resource: `plan:${plan!.id}`,
        reason: `Imported from ${name}`,
        ipAddress: "local-cli",
      });
      console.log(`Imported ${definition.planId} v${definition.version}.`);
    });
  }
} finally {
  await pool.end();
}
