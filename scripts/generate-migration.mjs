import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { mkdir, writeFile, access } from "node:fs/promises";
import * as schema from "../apps/api/dist/db/schema.js";
await mkdir("drizzle/meta", { recursive: true });
try {
  await access("drizzle/meta/_journal.json");
  throw new Error(
    "Initial migration already exists; use drizzle-kit for subsequent migrations",
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const empty = generateDrizzleJson({});
const snapshot = generateDrizzleJson(schema, empty.id);
const statements = await generateMigration(empty, snapshot);
await writeFile(
  "drizzle/0000_initial.sql",
  statements.join("\n--> statement-breakpoint\n"),
);
await writeFile(
  "drizzle/meta/0000_snapshot.json",
  JSON.stringify(snapshot, null, 2),
);
await writeFile(
  "drizzle/meta/_journal.json",
  JSON.stringify(
    {
      version: "7",
      dialect: "postgresql",
      entries: [
        {
          idx: 0,
          version: "7",
          when: 1791907200000,
          tag: "0000_initial",
          breakpoints: true,
        },
      ],
    },
    null,
    2,
  ),
);
console.log("Generated initial schema migration");
