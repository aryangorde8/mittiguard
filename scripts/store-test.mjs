import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate } from "../lib/policy.mjs";
import { MittiStore } from "../lib/store.mjs";

process.env.MITTIGUARD_AUDIT_SECRET = "mittiguard-store-test-secret";

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
    caseData: {
      ...testInput,
      externalInvoiceId: "POS-STORE-01",
      intakeChannel: "POS_GATE_API"
    },
    gate,
    assessment: { observations: ["Test"], conflicts: [], questions: [], source: "test" }
  });
  const listed = await testStore.listCases();
  const field = await testStore.getField("TEST-01");
  let updated = record;
  for (const task of record.relay.tasks) {
    updated = await testStore.recordTaskEvidence(record.id, task.id, "Current evidence attached for reviewer verification.");
  }
  const assigned = await testStore.assignCase(record.id, { role: "EXTENSION_REVIEW", name: "Maya Nair" });
  const preview = await testStore.getReviewAttestationPreview(record.id);
  const reviewed = await testStore.attestReview(record.id, {
    reviewerName: "Maya Nair",
    disposition: "MANUAL_POS_DECISION_REQUIRED",
    note: "Synthetic evidence packet reviewed; no MittiGuard invoice release.",
    confirmed: true,
    expectedEvidenceDigest: preview.evidenceDigest,
    expectedAuditHeadHash: preview.auditAnchor.headHash
  });
  const attestation = await testStore.getReviewAttestationVerification(record.id);
  const outcome = await testStore.recordFieldOutcome(record.id, { state: "NOT_IMPROVED", note: "Same yellowing was observed at follow-up." });
  const fieldAfterOutcome = await testStore.getField("TEST-01");
  const raw = await (await import("node:fs/promises")).readFile(path, "utf8");
  const baseline = await testStore.resetDemoLedger();
  const resetCases = await testStore.listCases();
  const resetField = await testStore.getField("GNT-14 · North plot");
  const resetProof = await testStore.getLedgerVerification();
  const automaticRisk = await testStore.findRepeatRisk({
    fieldId: "GNT-14 · North plot",
    crop: "Chilli",
    symptom: "Yellowing lower leaves after rain"
  });
  const resolvedPath = join(directory, "resolved-outcome.json");
  await writeFile(resolvedPath, JSON.stringify({
    version: 3,
    cases: [{
      id: "C-RESOLVED",
      field: "RES-01",
      crop: "Chilli",
      symptom: "Yellowing lower leaves after rain",
      saleState: "ON_HOLD",
      previousInputFailed: true,
      fieldOutcome: { state: "IMPROVED" }
    }],
    fields: []
  }));
  const resolvedRisk = await new MittiStore(resolvedPath).findRepeatRisk({
    fieldId: "RES-01",
    crop: "Chilli",
    symptom: "Yellowing lower leaves after rain"
  });
  const ok = listed.length === 1
    && field?.events?.length === 1
    && record.relay?.tasks?.length > 0
    && updated.saleState === "ON_HOLD"
    && updated.relay?.audit?.some((event) => event.kind === "evidence")
    && assigned.relay?.owner?.name === "Maya Nair"
    && preview.eligible
    && preview.saleAuthorization === "NOT_RELEASED"
    && reviewed.status === "REVIEW_ATTESTED"
    && reviewed.saleState === "ON_HOLD"
    && reviewed.relay?.phase === "EXTENSION_REVIEW"
    && reviewed.reviewAttestation?.saleAuthorization === "NOT_RELEASED"
    && attestation.valid
    && attestation.auditSealedAndValid
    && outcome.saleState === "ON_HOLD"
    && outcome.fieldOutcome?.state === "NOT_IMPROVED"
    && fieldAfterOutcome?.events?.some((event) => event.kind === "input_outcome" && event.outcome === "not_improved")
    && baseline.cases.length === 0
    && resetCases.length === 0
    && resetField?.events?.length === 2
    && resetProof.coverage === "FROM_DEMO_RESET_FORWARD"
    && resetProof.seedHistoryUnsealed === true
    && resetProof.entryCount === 0
    && automaticRisk.detected
    && automaticRisk.matches.some((match) => match.type === "prior_outcome")
    && !resolvedRisk.detected
    && !raw.includes("should-not-be-persisted");
  if (!ok) throw new Error("Persistent store expectations were not met.");
  console.log("PASS Evidence Relay seals a named human review before an outcome can enter Field Memory, safely resets the jury demo, and never releases a sale or persists raw image data.");
} finally {
  delete process.env.MITTIGUARD_AUDIT_SECRET;
  await rm(directory, { recursive: true, force: true });
}
