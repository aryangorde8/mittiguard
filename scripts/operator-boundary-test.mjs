import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mittiguard-operator-boundary-"));
const port = 33_000 + Math.floor(Math.random() * 1_000);
const operatorKey = "mittiguard-operator-boundary-test-key";
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    MITTIGUARD_STORE_PATH: join(directory, "ledger.json"),
    MITTIGUARD_MODE: "operations",
    MITTIGUARD_OPERATOR_KEY: operatorKey,
    MITTIGUARD_PUBLIC_BASE_URL: "https://jury.example.test",
    AWS_BEARER_TOKEN_BEDROCK: "",
    OPENAI_API_KEY: "",
    MITTIGUARD_AUDIT_SECRET: "mittiguard-operator-boundary-audit-secret"
  },
  stdio: ["ignore", "ignore", "ignore"]
});

async function waitForServer() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // The child is still binding its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Temporary operations-mode server did not start.");
}

function post(path, body, withOperatorKey = false) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withOperatorKey ? { "x-mittiguard-operator-key": operatorKey } : {})
    },
    body: JSON.stringify(body)
  });
}

try {
  await waitForServer();
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
  assert.equal(health.deploymentMode, "operations");
  assert.equal(health.writeAccess, "operator key required");
  assert.equal(health.fieldCapturePublicBaseUrlConfigured, true);

  assert.equal((await post("/api/demo/reset", { confirmation: "RESET_DEMO_LEDGER" })).status, 403);
  assert.equal((await post("/api/pos/gate-invoice", { invoiceId: "OPS-01", case: {} })).status, 403);

  const allowed = await post("/api/pos/gate-invoice", {
    invoiceId: "OPS-01",
    case: {
      farmerName: "Operator Test Farmer",
      fieldId: "OPS-14",
      crop: "Chilli",
      cropStage: "Flowering",
      requestType: "pesticide",
      symptom: "Yellowing after rain",
      photoProvided: true,
      soilReportDate: "2024-01-11",
      lastInput: "Prior input, 10 days ago",
      previousInputFailed: false
    }
  }, true);
  const allowedBody = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.equal(allowedBody.receipt.saleAuthorization, "NOT_RELEASED");

  const firstTask = allowedBody.case.relay.tasks[0];
  const taskPath = `/api/cases/${allowedBody.case.id}/tasks/${firstTask.id}/evidence-received`;
  assert.equal((await post(taskPath, { note: "No key." })).status, 403);

  const fieldTask = allowedBody.case.relay.tasks.find((task) => task.ownerRole === "FIELD_CAPTURE");
  assert.ok(fieldTask, "operations fixture must create a Field Capture task");
  const fieldLinkPath = `/api/cases/${allowedBody.case.id}/tasks/${fieldTask.id}/field-capture-link`;
  assert.equal((await post(fieldLinkPath, { ttlMinutes: 5 })).status, 403);
  const issuedLinkResponse = await post(fieldLinkPath, { ttlMinutes: 5 }, true);
  const issuedLink = await issuedLinkResponse.json();
  assert.equal(issuedLinkResponse.status, 201);
  assert.equal(issuedLink.saleAuthorization, "NOT_RELEASED");
  assert.match(issuedLink.fieldCaptureUrl, /^https:\/\/jury\.example\.test\/field-capture\.html#mgfc_/);
  const capability = decodeURIComponent(issuedLink.fieldCaptureUrl.split("#")[1]);

  const mobileContextResponse = await fetch(`http://127.0.0.1:${port}/api/field-capture/context`, {
    headers: { Authorization: `Bearer ${capability}` }
  });
  const mobileContext = await mobileContextResponse.json();
  assert.equal(mobileContextResponse.status, 200);
  assert.equal(mobileContext.context.task.id, fieldTask.id);
  assert.equal(mobileContext.context.saleAuthorization, "NOT_RELEASED");

  const mobileEvidenceResponse = await fetch(`http://127.0.0.1:${port}/api/field-capture/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${capability}`
    },
    body: JSON.stringify({
      observation: "Field image captured after rain; lower-leaf yellowing remains visible.",
      imageDataUrl: "data:image/jpeg;base64,/9j/2Q=="
    })
  });
  const mobileEvidence = await mobileEvidenceResponse.json();
  assert.equal(mobileEvidenceResponse.status, 200);
  assert.equal(mobileEvidence.task.id, fieldTask.id);
  assert.equal(mobileEvidence.saleAuthorization, "NOT_RELEASED");
  assert.equal(mobileEvidence.saleState, "ON_HOLD");
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/field-capture/context`, {
    headers: { Authorization: `Bearer ${capability}` }
  })).status, 404);

  let relayCase = (await fetch(`http://127.0.0.1:${port}/api/cases/${allowedBody.case.id}`).then((response) => response.json())).case;
  for (const task of relayCase.relay.tasks) {
    if (task.id === fieldTask.id) continue;
    const taskResponse = await post(`/api/cases/${allowedBody.case.id}/tasks/${task.id}/evidence-received`, {
      note: "Operator-key protected synthetic evidence."
    }, true);
    const taskBody = await taskResponse.json();
    assert.equal(taskResponse.status, 200);
    relayCase = taskBody.case;
  }
  assert.ok(relayCase.relay.tasks.every((task) => task.status === "EVIDENCE_RECEIVED"));

  const assignPath = `/api/cases/${allowedBody.case.id}/assign`;
  const reviewer = { role: "EXTENSION_REVIEW", name: "Dr. Sana Rao" };
  assert.equal((await post(assignPath, reviewer)).status, 403);
  const assignedResponse = await post(assignPath, reviewer, true);
  const assigned = await assignedResponse.json();
  assert.equal(assignedResponse.status, 200);
  assert.equal(assigned.case.relay.owner.name, reviewer.name);

  const previewPath = `/api/cases/${allowedBody.case.id}/review-attestation/preview`;
  const previewResponse = await fetch(`http://127.0.0.1:${port}${previewPath}`);
  const preview = await previewResponse.json();
  assert.equal(previewResponse.status, 200);
  assert.equal(preview.preview.eligible, true);

  const attestationPath = `/api/cases/${allowedBody.case.id}/review-attestation`;
  const attestationRequest = {
    reviewerName: reviewer.name,
    disposition: "MANUAL_POS_DECISION_REQUIRED",
    note: "Synthetic operations review; invoice remains outside MittiGuard release authority.",
    confirmed: true,
    expectedEvidenceDigest: preview.preview.evidenceDigest,
    expectedAuditHeadHash: preview.preview.auditAnchor.headHash
  };
  assert.equal((await post(attestationPath, attestationRequest)).status, 403);
  const attestationResponse = await post(attestationPath, attestationRequest, true);
  const attestation = await attestationResponse.json();
  assert.equal(attestationResponse.status, 200);
  assert.equal(attestation.attestation.saleAuthorization, "NOT_RELEASED");
  assert.equal(attestation.verification.valid, true);

  const outcomePath = `/api/cases/${allowedBody.case.id}/field-outcome`;
  const observedOutcome = { state: "NOT_IMPROVED", note: "Synthetic follow-up observation." };
  assert.equal((await post(outcomePath, observedOutcome)).status, 403);
  const outcomeResponse = await post(outcomePath, observedOutcome, true);
  const outcome = await outcomeResponse.json();
  assert.equal(outcomeResponse.status, 200);
  assert.equal(outcome.case.saleState, "ON_HOLD");
  assert.equal(outcome.case.reviewAttestation.saleAuthorization, "NOT_RELEASED");
  console.log("PASS operations mode keeps issuance and relay writes behind an operator key while a time-bound Field Capture capability can submit exactly one no-release evidence task.");
} finally {
  child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
