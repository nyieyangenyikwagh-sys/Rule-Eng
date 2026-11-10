import { defineConfig } from "vitest/config";
import ts from "typescript";
const restricted = process.env.RESTRICTED_CHILD_PROCESSES === "true";
export default defineConfig({
  resolve: { preserveSymlinks: restricted },
  ...(restricted
    ? {
        esbuild: false as const,
        plugins: [
          {
            name: "typescript-without-child-process",
            enforce: "pre" as const,
            transform(code: string, id: string) {
              if (/\.tsx?(?:\?|$)/.test(id)) {
                const result = ts.transpileModule(code, {
                  fileName: id,
                  compilerOptions: {
                    target: ts.ScriptTarget.ES2022,
                    module: ts.ModuleKind.ESNext,
                    sourceMap: true,
                    inlineSources: true,
                  },
                });
                return { code: result.outputText, map: result.sourceMapText };
              }
            },
          },
        ],
      }
    : {}),
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts", "apps/api/src/**/*.ts"],
      exclude: ["apps/api/src/server.ts", "apps/api/src/db/schema.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        "packages/core/src/**": { lines: 95, branches: 95 },
        "apps/api/src/**": { lines: 85 },
      },
    },
  },
});
