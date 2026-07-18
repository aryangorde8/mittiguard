import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "mittiguard-judge-proof-"));
const port = 34_000 + Math.floor(Math.random() * 1_000);
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    MITTIGUARD_STORE_PATH: join(directory, "ledger.json"),
    MITTIGUARD_MODE: "jury-demo",
    MODEL_PROVIDER: "disabled",
    AWS_BEARER_TOKEN_BEDROCK: "",
    OPENAI_API_KEY: "",
    MITTIGUARD_AUDIT_SECRET: "mittiguard-judge-verification-hmac-secret"
  },
  stdio: ["ignore", "ignore", "ignore"]
});

const base = `http://127.0.0.1:${port}`;

async function waitForServer() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // The isolated server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Judge-verification server did not start.");
}

try {
  await waitForServer();
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.deploymentMode, "jury-demo");

  const resetResponse = await fetch(`${base}/api/demo/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "RESET_DEMO_LEDGER" })
  });
  assert.equal(resetResponse.status, 200);

  const gateResponse = await fetch(`${base}/api/pos/gate-invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoiceId: "JUDGE-PROOF-01",
      case: {
        farmerName: "Jury Proof Farmer",
        fieldId: "GNT-14 · North plot",
        crop: "Chilli",
        cropStage: "Flowering",
        requestType: "pesticide",
        symptom: "Yellowing lower leaves after rain; spots on a few plants.",
        photoProvided: false,
        soilReportDate: "2024-01-11",
        lastInput: "Prior input, 10 days ago",
        // The browser/dealer claim is deliberately false. Field Memory must
        // independently preserve the unresolved prior outcome.
        previousInputFailed: false
      }
    })
  });
  const gate = await gateResponse.json();
  assert.equal(gateResponse.status, 200);
  assert.equal(gate.gate.repeatRisk.detected, true);
  assert.equal(gate.gate.saleState, "ON_HOLD");
  assert.equal(gate.receipt.saleAuthorization, "NOT_RELEASED");
  assert.ok(gate.case.relay.tasks.some((task) => task.ownerRole === "FIELD_CAPTURE"));

  const audit = await fetch(`${base}/api/ledger/verify`).then((response) => response.json());
  assert.equal(audit.auditProof.valid, true);
  assert.equal(audit.auditProof.sealed, true);

  const replay = await fetch(`${base}/api/evaluation/replay`).then((response) => response.json());
  assert.equal(replay.passed, true);
  assert.equal(replay.total, 45);
  assert.equal(replay.passedCount, 45);

  console.log("PASS judge verification resets the synthetic ledger, proves Evidence Debt overrides a dealer claim, returns NOT_RELEASED, verifies the HMAC audit, and replays 45 controls.");
} finally {
  child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
