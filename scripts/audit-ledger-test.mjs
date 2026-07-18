import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate } from "../lib/policy.mjs";
import { MittiStore } from "../lib/store.mjs";

process.env.MITTIGUARD_AUDIT_SECRET = "mittiguard-audit-test-secret";

const directory = await mkdtemp(join(tmpdir(), "mittiguard-audit-ledger-"));
const path = join(directory, "ledger.json");
const input = {
  farmerName: "Audit Test Farmer",
  fieldId: "AUDIT-14",
  crop: "Chilli",
  cropStage: "Flowering",
  symptom: "Yellowing lower leaves after rain",
  requestType: "pesticide",
  requestedProduct: "HiddenProduct 300",
  photoProvided: true,
  photoDataUrl: "data:image/png;base64,raw-image-must-not-enter-ledger",
  soilReportDate: "2024-01-11",
  lastInput: "Prior input, 10 days ago",
  previousInputFailed: true
};

async function completeTask(store, caseId, task) {
  if (task.ownerRole !== "FIELD_CAPTURE") {
    return store.recordTaskEvidence(caseId, task.id, "Synthetic evidence received.");
  }
  const issued = await store.issueFieldCaptureLink(caseId, task.id, { ttlMinutes: 5 });
  return store.recordFieldCaptureEvidence(issued.token, {
    observation: "Current requested evidence captured for audit verification.",
    imageMetadata: { mediaType: "image/jpeg", bytes: 1234, sha256: "D".repeat(64) }
  });
}

try {
  const store = new MittiStore(path);
  const gate = evaluateGate(input, new Date("2026-07-17T12:00:00Z"));
  const created = await store.createCase({
    caseData: {
      ...input,
      externalInvoiceId: "POS-AUDIT-01",
      intakeChannel: "POS_GATE_API"
    },
    gate,
    assessment: { observations: ["Synthetic audit case."], conflicts: [], questions: [], source: "audit-test" }
  });
  const firstProof = await store.getLedgerVerification(created.id);
  assert.equal(firstProof.valid, true);
  assert.equal(firstProof.sealed, true);
  assert.ok(firstProof.caseEntryCount >= 3);

  let updated = created;
  for (const task of created.relay.tasks) {
    updated = await completeTask(store, created.id, task);
  }
  const assigned = await store.assignCase(created.id, { role: "EXTENSION_REVIEW", name: "Dr. Neha Iyer" });
  const preview = await store.getReviewAttestationPreview(created.id);
  assert.equal(preview.eligible, true);
  assert.equal(preview.saleAuthorization, "NOT_RELEASED");
  assert.equal(preview.auditProof.sealed, true);
  const attested = await store.attestReview(created.id, {
    reviewerName: "Dr. Neha Iyer",
    disposition: "ESCALATE",
    note: "Synthetic review sealed; escalation does not release the invoice.",
    confirmed: true,
    expectedEvidenceDigest: preview.evidenceDigest,
    expectedAuditHeadHash: preview.auditAnchor.headHash
  });
  const attestation = await store.getReviewAttestationVerification(created.id);
  const outcome = await store.recordFieldOutcome(created.id, {
    state: "NOT_IMPROVED",
    note: "Synthetic unresolved observation."
  });
  const finalProof = await store.getLedgerVerification(created.id);
  const raw = await readFile(path, "utf8");
  assert.equal(updated.relay.phase, "EXTENSION_REVIEW");
  assert.equal(assigned.relay.owner.name, "Dr. Neha Iyer");
  assert.equal(attested.reviewAttestation.saleAuthorization, "NOT_RELEASED");
  assert.equal(attestation.valid, true);
  assert.equal(attestation.auditBound, true);
  assert.equal(outcome.saleState, "ON_HOLD");
  assert.equal(finalProof.valid, true);
  assert.equal(finalProof.sealed, true);
  assert.ok(finalProof.caseEntryCount > firstProof.caseEntryCount);
  assert.ok(!raw.includes("raw-image-must-not-enter-ledger"));
  assert.ok(!raw.includes(process.env.MITTIGUARD_AUDIT_SECRET));

  const headerTamperedPath = join(directory, "header-tampered.json");
  const headerTampered = JSON.parse(raw);
  headerTampered.auditLedger.ledgerId = "MGL-TAMPERED-HEADER";
  await writeFile(headerTamperedPath, `${JSON.stringify(headerTampered)}\n`, "utf8");
  const headerTamperedProof = await new MittiStore(headerTamperedPath).getLedgerVerification(created.id);
  assert.equal(headerTamperedProof.valid, false);

  const tampered = JSON.parse(raw);
  tampered.auditLedger.entries[0].detail = "Tampered ledger detail.";
  await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
  const tamperedProof = await store.getLedgerVerification(created.id);
  assert.equal(tamperedProof.valid, false);
  assert.equal(tamperedProof.firstInvalidSequence, 1);

  console.log("PASS HMAC-sealed audit ledger binds the named review attestation, detects tampering, preserves ON_HOLD, and excludes raw image data.");
} finally {
  delete process.env.MITTIGUARD_AUDIT_SECRET;
  await rm(directory, { recursive: true, force: true });
}
