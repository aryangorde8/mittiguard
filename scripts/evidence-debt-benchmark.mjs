import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MittiStore } from "../lib/store.mjs";

const fixture = JSON.parse(await readFile(new URL("../fixtures/evidence-debt-benchmark.json", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "mittiguard-evidence-debt-"));
const storePath = join(directory, "ledger.json");
await writeFile(storePath, `${JSON.stringify(fixture.baseline)}\n`, "utf8");

try {
  const store = new MittiStore(storePath);
  const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };

  for (const benchmarkCase of fixture.cases) {
    const risk = await store.findRepeatRisk(benchmarkCase.input);
    const detected = risk.detected;
    const expected = benchmarkCase.expectDetected;
    if (expected && detected) counts.tp += 1;
    if (!expected && detected) counts.fp += 1;
    if (!expected && !detected) counts.tn += 1;
    if (expected && !detected) counts.fn += 1;
    assert.equal(detected, expected, `${benchmarkCase.id} (${benchmarkCase.kind}) expected ${expected ? "a match" : "no match"}`);
  }

  const precision = counts.tp / (counts.tp + counts.fp || 1);
  const recall = counts.tp / (counts.tp + counts.fn || 1);
  const specificity = counts.tn / (counts.tn + counts.fp || 1);
  console.log(`PASS Evidence Debt benchmark — ${fixture.cases.length}/${fixture.cases.length} synthetic adversarial cases`);
  console.log(`  precision ${(precision * 100).toFixed(1)}% · recall ${(recall * 100).toFixed(1)}% · specificity ${(specificity * 100).toFixed(1)}%`);
  console.log("  Scope: exact field + crop and at least two shared symptom signals; not an agronomic validation claim.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
