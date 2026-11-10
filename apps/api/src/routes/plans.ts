import { eq } from "drizzle-orm";
import { RULE_CATALOGUE } from "@alberta-rules/core";
import { httpError } from "../services/security.js";
import { audit } from "../services/adjudication.js";
import * as s from "../db/schema.js";
import * as schemas from "../schemas.js";
import type { RoutesContext } from "./context.js";
export function registerPlansRoutes(context: RoutesContext) {
  const { app, db, any, admin, secure } = context;
  app.get(
    "/api/v1/plans",
    {
      preHandler: any,
      schema: {
        ...secure,
        summary: "List plans and immutable versions",
        tags: ["Plans"],
      },
    },
    async () => schemas.snake(await db.select().from(s.insurancePlans)),
  );
  app.get(
    "/api/v1/plans/:id",
    {
      preHandler: any,
      schema: {
        ...secure,
        params: schemas.idParams,
        summary: "Read plan versions",
        tags: ["Plans"],
      },
    },
    async (req) => {
      const [plan] = await db
        .select()
        .from(s.insurancePlans)
        .where(eq(s.insurancePlans.id, req.params.id));
      if (!plan) throw httpError(404, "Plan not found");
      return {
        ...schemas.snake(plan),
        versions: (
          await db
            .select()
            .from(s.planVersions)
            .where(eq(s.planVersions.planId, plan.id))
        ).map((v) => v.definition),
      };
    },
  );
  for (const version of [false, true])
    app.post(
      version ? "/api/v1/plans/:id/versions" : "/api/v1/plans",
      {
        preHandler: admin,
        schema: {
          ...secure,
          body: schemas.planWireSchema,
          ...(version ? { params: schemas.idParams } : {}),
          summary: version
            ? "Publish an immutable plan version"
            : "Create a versioned plan",
          tags: ["Plans"],
        },
      },
      async (req, reply) => {
        const plan = await db.transaction(async (tx) => {
          const b = req.body;
          let id: number;
          if (version) {
            id = (req.params as { id: number }).id;
            const [existing] = await tx
              .select()
              .from(s.insurancePlans)
              .where(eq(s.insurancePlans.id, id))
              .for("update");
            if (!existing) throw httpError(404, "Plan not found");
            if (existing.planId !== b.planId || existing.layer !== b.layer)
              throw httpError(
                422,
                "Version must retain plan ID and coverage layer",
              );
          } else {
            const [created] = await tx
              .insert(s.insurancePlans)
              .values({
                planId: b.planId,
                payerId: b.payerId,
                name: b.planId,
                layer: b.layer,
                planType: "configured",
              })
              .returning();
            id = created!.id;
          }
          const versions = await tx
            .select()
            .from(s.planVersions)
            .where(eq(s.planVersions.planId, id));
          if (
            versions.some(
              (v) =>
                v.version === b.version ||
                (v.effectiveFrom <= (b.effectiveTo ?? "9999-12-31") &&
                  (v.effectiveTo ?? "9999-12-31") >= b.effectiveFrom),
            )
          )
            throw httpError(
              409,
              "Plan version already exists or effective dates overlap",
            );
          await tx.insert(s.planVersions).values({
            planId: id,
            version: b.version,
            effectiveFrom: b.effectiveFrom,
            effectiveTo: b.effectiveTo,
            definition: b,
          });
          await audit(tx, req.actor!, "create", `plan:${id}`);
          return { id, definition: b };
        });
        return reply.code(201).send(plan);
      },
    );
  app.get(
    "/api/v1/rules",
    {
      preHandler: any,
      schema: { ...secure, summary: "Rule catalogue", tags: ["Rules"] },
    },
    async () => RULE_CATALOGUE,
  );
}
