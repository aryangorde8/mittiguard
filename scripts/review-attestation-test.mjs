import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate } from "../lib/policy.mjs";
import { MittiStore } from "../lib/store.mjs";

process.env.MITTIGUARD_AUDIT_SECRET = "mittiguard-review-attestation-test-secret";

const directory = await mkdtemp(join(tmpdir(), "mittiguard-review-attestation-"));
const path = join(directory, "ledger.json");
const input = {
  farmerName: "Review Test Farmer",
  fieldId: "REVIEW-14",
  crop: "Chilli",
  cropStage: "Flowering",
  symptom: "Yellowing lower leaves after rain",
  requestType: "pesticide",
  requestedProduct: "Untrusted Product 300",
  photoProvided: true,
  photoDataUrl: "data:image/png;base64,raw-image-must-not-enter-attestation-test",
  soilReportDate: "2024-01-11",
  lastInput: "Previous input, 10 days ago",
  previousInputFailed: true,
  externalInvoiceId: "POS-REVIEW-ATT-01",
  intakeChannel: "POS_GATE_API"
};

const reviewerName = "Dr. Rhea Kamat";

async function completeTask(store, caseId, task) {
  if (task.ownerRole !== "FIELD_CAPTURE") {
    return store.recordTaskEvidence(caseId, task.id, "Synthetic evidence received for named reviewer verification.");
  }
  const issued = await store.issueFieldCaptureLink(caseId, task.id, { ttlMinutes: 5 });
  return store.recordFieldCaptureEvidence(issued.token, {
    observation: "Current requested evidence captured for named reviewer verification.",
    imageMetadata: { mediaType: "image/jpeg", bytes: 1234, sha256: "E".repeat(64) }
  });
}

function attestationInput(preview, overrides = {}) {
  return {
    reviewerName,
    disposition: "MANUAL_POS_DECISION_REQUIRED",
    note: "Synthetic evidence packet reviewed. MittiGuard did not release the invoice.",
    confirmed: true,
    expectedEvidenceDigest: preview.evidenceDigest,
    expectedAuditHeadHash: preview.auditAnchor.headHash,
    ...overrides
  };
}

try {
  let store = new MittiStore(path);
  const gate = evaluateGate(input, new Date("2026-07-17T12:00:00Z"));
  const created = await store.createCase({
    caseData: input,
    gate,
    assessment: { observations: ["Synthetic attestation case."], conflicts: [], questions: [], source: "attestation-test" }
  });
  assert.equal(created.saleState, "ON_HOLD");
  assert.equal(created.intakeChannel, "POS_GATE_API");
  assert.equal(created.externalInvoiceId, "POS-REVIEW-ATT-01");

  const beforeCapture = await store.getReviewAttestationPreview(created.id);
  assert.equal(beforeCapture.eligible, false);
  assert.equal(beforeCapture.saleAuthorization, "NOT_RELEASED");
  assert.ok(beforeCapture.issues.some((issue) => issue.includes("evidence task")));
  assert.ok(beforeCapture.issues.some((issue) => issue.includes("named extension reviewer")));

  let updated = created;
  for (const task of created.relay.tasks) {
    updated = await completeTask(store, created.id, task);
  }
  assert.equal(updated.relay.phase, "EXTENSION_REVIEW");

  const missingOwner = await store.getReviewAttestationPreview(created.id);
  assert.equal(missingOwner.eligible, false);
  assert.ok(missingOwner.issues.some((issue) => issue.includes("named extension reviewer")));

  await assert.rejects(
    () => store.assignCase(created.id, { role: "EXTENSION_REVIEW", name: "Extension desk" }),
    /named extension reviewer/i
  );

  // The next valid mutation must still work after a rejected reviewer action.
  const assigned = await store.assignCase(created.id, { role: "EXTENSION_REVIEW", name: reviewerName });
  assert.deepEqual(assigned.relay.owner, { role: "EXTENSION_REVIEW", name: reviewerName });

  const preview = await store.getReviewAttestationPreview(created.id);
  assert.equal(preview.eligible, true);
  assert.equal(preview.invoiceId, "POS-REVIEW-ATT-01");
  assert.equal(preview.saleAuthorization, "NOT_RELEASED");
  assert.match(preview.evidenceDigest, /^[A-F0-9]{64}$/);
  assert.equal(preview.auditProof.valid, true);
  assert.equal(preview.auditProof.sealed, true);
  assert.equal(preview.auditAnchor.headHash, preview.auditProof.headHash);

  await assert.rejects(
    () => store.recordFieldOutcome(created.id, { state: "NOT_IMPROVED", note: "Cannot write an outcome before human attestation." }),
    /valid human review attestation/i
  );

  const currentPreview = await store.getReviewAttestationPreview(created.id);
  await assert.rejects(
    () => store.attestReview(created.id, attestationInput(currentPreview, { saleAuthorization: "RELEASED" })),
    /cannot supply a sale state or authorization/i
  );

  const mismatchPreview = await store.getReviewAttestationPreview(created.id);
  await assert.rejects(
    () => store.attestReview(created.id, attestationInput(mismatchPreview, { reviewerName: "Dr. Wrong Reviewer" })),
    /must match the assigned extension-review owner/i
  );

  const stalePreview = await store.getReviewAttestationPreview(created.id);
  await assert.rejects(
    () => store.attestReview(created.id, attestationInput(stalePreview, { expectedEvidenceDigest: "0".repeat(64) })),
    /packet or audit chain changed/i
  );

  const finalPreview = await store.getReviewAttestationPreview(created.id);
  const attested = await store.attestReview(created.id, attestationInput(finalPreview));
  const verification = await store.getReviewAttestationVerification(created.id);
  assert.equal(attested.status, "REVIEW_ATTESTED");
  assert.equal(attested.saleState, "ON_HOLD");
  assert.equal(attested.reviewAttestation.saleAuthorization, "NOT_RELEASED");
  assert.equal(attested.reviewAttestation.reviewerName, reviewerName);
  assert.equal(attested.reviewAttestation.disposition, "MANUAL_POS_DECISION_REQUIRED");
  assert.equal(verification.exists, true);
  assert.equal(verification.valid, true);
  assert.equal(verification.auditBound, true);
  assert.equal(verification.auditSealedAndValid, true);
  assert.equal(verification.reviewerBound, true);
  assert.equal(verification.posBound, true);
  assert.equal(verification.saleRemainsBlocked, true);
  assert.equal(verification.auditProof.sealed, true);

  await assert.rejects(
    () => store.recordTaskEvidence(created.id, created.relay.tasks[0].id, "Attempt to change sealed evidence."),
    /frozen after a reviewer attestation/i
  );

  const outcome = await store.recordFieldOutcome(created.id, {
    state: "NOT_IMPROVED",
    note: "Synthetic unresolved field observation after a sealed human review."
  });
  const afterOutcome = await store.getReviewAttestationVerification(created.id);
  assert.equal(outcome.saleState, "ON_HOLD");
  assert.equal(outcome.fieldOutcome.state, "NOT_IMPROVED");
  assert.equal(afterOutcome.valid, true);

  const raw = await readFile(path, "utf8");
  assert.ok(!raw.includes("raw-image-must-not-enter-attestation-test"));
  assert.ok(!raw.includes(process.env.MITTIGUARD_AUDIT_SECRET));

  const tampered = JSON.parse(raw);
  tampered.cases[0].reviewAttestation.evidenceDigest = "F".repeat(64);
  await writeFile(path, `${JSON.stringify(tampered)}\n`, "utf8");
  const tamperedVerification = await new MittiStore(path).getReviewAttestationVerification(created.id);
  assert.equal(tamperedVerification.valid, false);

  console.log("PASS reviewer attestation binds a named reviewer, POS invoice, exact evidence digest, and HMAC ledger while keeping the invoice NOT_RELEASED.");
} finally {
  delete process.env.MITTIGUARD_AUDIT_SECRET;
  await rm(directory, { recursive: true, force: true });
}
