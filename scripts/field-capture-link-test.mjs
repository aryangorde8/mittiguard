import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate } from "../lib/policy.mjs";
import { MittiStore } from "../lib/store.mjs";

process.env.MITTIGUARD_AUDIT_SECRET = "mittiguard-field-capture-test-secret";

const directory = await mkdtemp(join(tmpdir(), "mittiguard-field-capture-"));
const path = join(directory, "ledger.json");
const input = {
  farmerName: "Mobile Capture Test Farmer",
  fieldId: "MOBILE-14",
  crop: "Chilli",
  cropStage: "Flowering",
  symptom: "Yellowing lower leaves after rain",
  requestType: "pesticide",
  requestedProduct: "Product name must not enter the mobile context",
  photoProvided: false,
  photoDataUrl: "data:image/png;base64,raw-image-must-never-be-persisted",
  soilReportDate: "2026-07-10",
  lastInput: "Prior input, 10 days ago",
  previousInputFailed: false,
  externalInvoiceId: "POS-MOBILE-CAPTURE-01",
  intakeChannel: "POS_GATE_API"
};

try {
  const store = new MittiStore(path);
  const gate = evaluateGate(input, new Date("2026-07-17T12:00:00Z"));
  const created = await store.createCase({
    caseData: input,
    gate,
    assessment: { observations: ["Synthetic mobile capture case."], conflicts: [], questions: [], source: "field-capture-test" }
  });
  const fieldTask = created.relay.tasks.find((task) => task.ownerRole === "FIELD_CAPTURE");
  assert.ok(fieldTask, "fixture must create a Field Capture task");

  const issued = await store.issueFieldCaptureLink(created.id, fieldTask.id, { ttlMinutes: 5 });
  assert.match(issued.token, /^mgfc_[A-Za-z0-9_-]{32,}$/);
  assert.equal(issued.context.saleAuthorization, "NOT_RELEASED");
  assert.equal(issued.context.task.id, fieldTask.id);
  assert.equal(issued.context.task.captureRequirement, "FIELD_PHOTO");
  assert.equal(issued.context.task.imageRequired, true);
  const storedAfterIssue = await readFile(path, "utf8");
  assert.ok(storedAfterIssue.includes("tokenHash"));
  assert.ok(!storedAfterIssue.includes(issued.token));
  assert.ok(!storedAfterIssue.includes("raw-image-must-never-be-persisted"));

  const context = await store.getFieldCaptureContext(issued.token);
  assert.equal(context.caseReference, issued.context.caseReference);
  assert.equal(context.saleAuthorization, "NOT_RELEASED");
  assert.equal(context.task.id, fieldTask.id);
  assert.ok(!JSON.stringify(context).includes(input.requestedProduct));
  assert.ok(!JSON.stringify(context).includes(input.symptom));
  assert.equal(await store.getFieldCaptureContext("mgfc_not-a-real-capability-token-000000000000000000000000000"), null);

  await assert.rejects(
    () => store.recordFieldCaptureEvidence(issued.token, { observation: "Apply a treatment immediately." }),
    /neutral observations only/i
  );
  await assert.rejects(
    () => store.recordTaskEvidence(created.id, fieldTask.id, "A desktop shortcut must not complete Field Capture."),
    /time-bound Field Capture link/i
  );
  await assert.rejects(
    () => store.recordFieldCaptureEvidence(issued.token, { observation: "Yellowing remains visible after rain." }),
    /requires a field image/i
  );

  const submitted = await store.recordFieldCaptureEvidence(issued.token, {
    observation: "Whole-plant image captured after rain; yellowing is visible on lower leaves.",
    imageMetadata: {
      mediaType: "image/jpeg",
      bytes: 1234,
      sha256: "A".repeat(64)
    }
  });
  const submittedTask = submitted.relay.tasks.find((task) => task.id === fieldTask.id);
  assert.equal(submitted.saleState, "ON_HOLD");
  assert.equal(submitted.status, "EVIDENCE_RECEIVED");
  assert.equal(submittedTask.status, "EVIDENCE_RECEIVED");
  assert.equal(submittedTask.fieldCapture.image.sha256, "A".repeat(64));
  assert.equal(submittedTask.fieldCaptureCapability.tokenHash, null);
  assert.ok(submittedTask.fieldCaptureCapability.usedAt);
  assert.ok(submitted.relay.tasks.every((task) => task.id === fieldTask.id || task.status !== "EVIDENCE_RECEIVED"));
  await assert.rejects(
    () => store.recordFieldCaptureEvidence(issued.token, { observation: "A duplicate mobile upload." }),
    /link is invalid, expired, or has already been used/i
  );

  const assigned = await store.assignCase(created.id, { role: "EXTENSION_REVIEW", name: "Dr. Nila Varma" });
  assert.equal(assigned.saleState, "ON_HOLD");
  const digestBeforeReceiptChange = (await store.getReviewAttestationPreview(created.id)).evidenceDigest;
  const persisted = JSON.parse(await readFile(path, "utf8"));
  persisted.cases[0].relay.tasks.find((task) => task.id === fieldTask.id).fieldCapture.image.sha256 = "B".repeat(64);
  await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
  const digestAfterReceiptChange = (await new MittiStore(path).getReviewAttestationPreview(created.id)).evidenceDigest;
  assert.notEqual(digestAfterReceiptChange, digestBeforeReceiptChange, "mobile receipt metadata must bind into the attestation digest");

  const storedAfterSubmit = await readFile(path, "utf8");
  assert.ok(!storedAfterSubmit.includes(issued.token));
  assert.ok(!storedAfterSubmit.includes("data:image/"));
  console.log("PASS Field Capture uses a time-bound single-task capability, stores only image metadata/digest, binds it into review evidence, and keeps the POS invoice NOT_RELEASED.");
} finally {
  delete process.env.MITTIGUARD_AUDIT_SECRET;
  await rm(directory, { recursive: true, force: true });
}
