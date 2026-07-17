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
  const reviewed = await testStore.recordReview(record.id, "Evidence packet received.");
  const raw = await (await import("node:fs/promises")).readFile(path, "utf8");

  const ok = listed.length === 1
    && field?.events?.length === 1
    && reviewed.status === "EVIDENCE_RECEIVED"
    && !raw.includes("should-not-be-persisted");
  if (!ok) throw new Error("Persistent store expectations were not met.");
  console.log("PASS persistent store records case state, field memory, and review updates without raw image data.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
