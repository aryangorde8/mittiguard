import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mittiguard-pos-gate-"));
const port = 32_000 + Math.floor(Math.random() * 1_000);
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    MITTIGUARD_STORE_PATH: join(directory, "ledger.json"),
    AWS_BEARER_TOKEN_BEDROCK: "",
    OPENAI_API_KEY: "",
    MITTIGUARD_AUDIT_SECRET: "mittiguard-pos-endpoint-test-secret"
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
      // The process is still binding its local port.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Temporary POS Gate server did not start.");
}

try {
  await waitForServer();
  const response = await fetch(`http://127.0.0.1:${port}/api/pos/gate-invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoiceId: "POS-INV-E2E-01",
      case: {
        farmerName: "Test farmer",
        fieldId: "E2E-14",
        crop: "Chilli",
        cropStage: "Flowering",
        requestType: "pesticide",
        symptom: "Yellowing after rain",
        photoProvided: true,
        soilReportDate: "2024-01-11",
        lastInput: "Prior input, 10 days ago",
        previousInputFailed: false
      }
    })
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.receipt.contract, "MittiGuard POS Gate v1");
  assert.equal(result.receipt.invoiceId, "POS-INV-E2E-01");
  assert.equal(result.receipt.saleAuthorization, "NOT_RELEASED");
  assert.equal(result.gate.saleState, "ON_HOLD");
  assert.equal(result.auditProof.valid, true);
  assert.equal(result.auditProof.sealed, true);
  assert.equal(result.receipt.auditProof.verified, true);
  assert.equal(result.receipt.auditProof.sealed, true);
  const initialAuditResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/audit-proof`);
  const initialAudit = await initialAuditResponse.json();
  assert.equal(initialAuditResponse.status, 200);
  assert.equal(initialAudit.auditProof.valid, true);
  assert.equal(initialAudit.auditProof.headHash, result.receipt.auditProof.headHash);

  const initialPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/review-attestation/preview`);
  const initialPreview = await initialPreviewResponse.json();
  assert.equal(initialPreviewResponse.status, 200);
  assert.equal(initialPreview.preview.eligible, false);
  assert.equal(initialPreview.preview.saleAuthorization, "NOT_RELEASED");

  let relayCase = result.case;
  for (const task of result.case.relay.tasks) {
    if (task.ownerRole === "FIELD_CAPTURE") {
      const bypassResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/tasks/${task.id}/evidence-received`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "A browser cannot mark a required image task complete." })
      });
      assert.equal(bypassResponse.status, 422);
      const linkResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/tasks/${task.id}/field-capture-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlMinutes: 5 })
      });
      const link = await linkResponse.json();
      assert.equal(linkResponse.status, 201);
      const capability = decodeURIComponent(link.fieldCaptureUrl.split("#")[1]);
      const taskResponse = await fetch(`http://127.0.0.1:${port}/api/field-capture/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${capability}`
        },
        body: JSON.stringify({
          observation: `Synthetic requested image received for ${task.id}.`,
          imageDataUrl: "data:image/jpeg;base64,/9j/2Q=="
        })
      });
      const taskResult = await taskResponse.json();
      assert.equal(taskResponse.status, 200);
      assert.equal(taskResult.receipt.image.mediaType, "image/jpeg");
      relayCase = (await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}`).then((item) => item.json())).case;
      continue;
    }
    const taskResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/tasks/${task.id}/evidence-received`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: `Synthetic evidence received for ${task.id}.` })
    });
    const taskResult = await taskResponse.json();
    assert.equal(taskResponse.status, 200);
    relayCase = taskResult.case;
  }
  assert.ok(relayCase.relay.tasks.every((task) => task.status === "EVIDENCE_RECEIVED"));

  const assignResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "EXTENSION_REVIEW", name: "Dr. Arjun Mehta" })
  });
  const assigned = await assignResponse.json();
  assert.equal(assignResponse.status, 200);
  assert.deepEqual(assigned.case.relay.owner, { role: "EXTENSION_REVIEW", name: "Dr. Arjun Mehta" });

  const previewResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/review-attestation/preview`);
  const previewBody = await previewResponse.json();
  assert.equal(previewResponse.status, 200);
  assert.equal(previewBody.preview.eligible, true);
  assert.equal(previewBody.preview.invoiceId, "POS-INV-E2E-01");
  assert.equal(previewBody.preview.saleAuthorization, "NOT_RELEASED");
  assert.equal(previewBody.preview.auditProof.sealed, true);

  const attestationResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/review-attestation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reviewerName: "Dr. Arjun Mehta",
      disposition: "MANUAL_POS_DECISION_REQUIRED",
      note: "Synthetic evidence packet reviewed; MittiGuard did not release the POS invoice.",
      confirmed: true,
      expectedEvidenceDigest: previewBody.preview.evidenceDigest,
      expectedAuditHeadHash: previewBody.preview.auditAnchor.headHash
    })
  });
  const attestationBody = await attestationResponse.json();
  assert.equal(attestationResponse.status, 200);
  assert.equal(attestationBody.saleAuthorization, "NOT_RELEASED");
  assert.equal(attestationBody.attestation.saleAuthorization, "NOT_RELEASED");
  assert.equal(attestationBody.case.saleState, "ON_HOLD");
  assert.equal(attestationBody.verification.valid, true);
  assert.equal(attestationBody.verification.auditBound, true);
  assert.equal(attestationBody.verification.auditProof.sealed, true);

  const verificationResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/review-attestation`);
  const verification = await verificationResponse.json();
  assert.equal(verificationResponse.status, 200);
  assert.equal(verification.saleAuthorization, "NOT_RELEASED");
  assert.equal(verification.verification.valid, true);

  const outcomeResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/field-outcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: "NOT_IMPROVED", note: "Yellowing remained at follow-up." })
  });
  const outcome = await outcomeResponse.json();
  assert.equal(outcomeResponse.status, 200);
  assert.equal(outcome.case.fieldOutcome.state, "NOT_IMPROVED");
  assert.equal(outcome.case.saleState, "ON_HOLD");

  const cases = await fetch(`http://127.0.0.1:${port}/api/cases`).then((reply) => reply.json());
  assert.equal(cases.cases.length, 1);
  assert.equal(cases.cases[0].externalInvoiceId, "POS-INV-E2E-01");
  assert.equal(cases.cases[0].intakeChannel, "POS_GATE_API");
  assert.equal(cases.cases[0].fieldOutcome.state, "NOT_IMPROVED");
  assert.equal(cases.cases[0].reviewAttestation.saleAuthorization, "NOT_RELEASED");
  assert.equal(cases.cases[0].saleState, "ON_HOLD");
  const auditResponse = await fetch(`http://127.0.0.1:${port}/api/cases/${result.case.id}/audit-proof`);
  const audit = await auditResponse.json();
  assert.equal(auditResponse.status, 200);
  assert.equal(audit.auditProof.valid, true);
  assert.ok(audit.auditProof.caseLastSequence > result.receipt.auditProof.caseLastSequence);
  console.log("PASS POS Gate end-to-end binds a named human attestation to evidence and invoice before an outcome, while never releasing the sale.");
} finally {
  child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
