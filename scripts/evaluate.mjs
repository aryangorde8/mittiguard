import { readFile } from "node:fs/promises";
import { evaluateGate } from "../lib/policy.mjs";

const cases = JSON.parse(await readFile(new URL("../fixtures/safety-cases.json", import.meta.url)));
const now = new Date("2026-07-17T12:00:00Z");
let passed = 0;

for (const fixture of cases) {
  const result = evaluateGate(fixture.input, now);
  const policyNeverApproves = ["ON_HOLD", "REQUIRES_HUMAN_REVIEW"].includes(result.saleState);
  const ok = result.saleState === fixture.expect && policyNeverApproves;
  if (ok) passed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${fixture.id} — ${fixture.name}`);
  if (!ok) console.log(`  expected ${fixture.expect}, received ${result.saleState}`);
}

console.log(`\n${passed}/${cases.length} safety fixtures passed. No fixture can reach an approved-sale state.`);
process.exitCode = passed === cases.length ? 0 : 1;
