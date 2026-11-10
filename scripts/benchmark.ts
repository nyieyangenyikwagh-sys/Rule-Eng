import { performance } from "node:perf_hooks";
import { evaluateClaim } from "@alberta-rules/core";
import { input } from "../packages/core/test/fixtures.js";
const request = input();
request.claim.lines = Array.from({ length: 10 }, (_, i) => ({
  ...request.claim.lines[0]!,
  units: i + 1,
}));
const samples: number[] = [];
for (let i = 0; i < 1100; i++) {
  const start = performance.now();
  evaluateClaim(request);
  if (i >= 100) samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      iterations: samples.length,
      lines: 10,
      p50_ms: samples[500],
      p95_ms: samples[950],
      p99_ms: samples[990],
    },
    null,
    2,
  ),
);
if (samples[950]! > 20) process.exitCode = 1;
