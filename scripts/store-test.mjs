import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate } from "../lib/policy.mjs";
import { MittiStore } from "../lib/store.mjs";

const directory = await mkdtemp(join(tmpdir(), "mittiguard-store-"));
const path = join(directory, "store.json");
const testInput = {
  photoProvided: true,
  photoDataUrl: "data:image/png;base64,should-not-be-persisted",
  farmerName: "Test Farmer",
  fieldId: "TEST-01",
  crop: "Chilli",
  cropStage: "Flowering",
  symptom: "Yellowing leaves",
  requestType: "pesticide",
  soilReportDate: "2024-01-01",
  lastInput: "Fungicide, 10 days ago",
  previousInputFailed: true
};

try {
  await writeFile(path, JSON.stringify({ version: 1, cases: [], fields: [] }));
  const testStore = new MittiStore(path);
  const gate = evaluateGate(testInput, new Date("2026-07-17T12:00:00Z"));
  const record = await testStore.createCase({
    caseData: testInput,
    gate,
    assessment: { observations: ["Test"], conflicts: [], questions: [], source: "test" }
  });
  const listed = await testStore.listCases();
  const field = await testStore.getField("TEST-01");
  const firstTask = record.relay?.tasks?.[0];
  const updated = await testStore.recordTaskEvidence(record.id, firstTask.id, "Current evidence attached for reviewer verification.");
  const reviewed = await testStore.recordReview(record.id, "Evidence packet received.");
  const baseline = await testStore.resetDemoLedger();
  const resetCases = await testStore.listCases();
  const resetField = await testStore.getField("GNT-14 · North plot");
  const automaticRisk = await testStore.findRepeatRisk({
    fieldId: "GNT-14 · North plot",
    crop: "Chilli",
    symptom: "Yellowing lower leaves after rain"
  });
  const raw = await (await import("node:fs/promises")).readFile(path, "utf8");

  const ok = listed.length === 1
    && field?.events?.length === 1
    && record.relay?.tasks?.length > 0
    && updated.saleState === "ON_HOLD"
    && updated.relay?.audit?.some((event) => event.kind === "evidence")
    && reviewed.status === "EVIDENCE_RECEIVED"
    && reviewed.saleState === "ON_HOLD"
    && reviewed.relay?.phase === "EXTENSION_REVIEW"
    && baseline.cases.length === 0
    && resetCases.length === 0
    && resetField?.events?.length === 2
    && automaticRisk.detected
    && automaticRisk.matches.some((match) => match.type === "prior_outcome")
    && !raw.includes("should-not-be-persisted");
  if (!ok) throw new Error("Persistent store expectations were not met.");
  console.log("PASS Evidence Relay records task handoffs, matches Evidence Debt from field memory, safely resets the jury demo, and never releases a sale or persists raw image data.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
