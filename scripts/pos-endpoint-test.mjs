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
    OPENAI_API_KEY: ""
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
  const response = await fetch(`http://127.0.0.1:${port}/api/pos/authorize-sale`, {
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

  const cases = await fetch(`http://127.0.0.1:${port}/api/cases`).then((reply) => reply.json());
  assert.equal(cases.cases.length, 1);
  assert.equal(cases.cases[0].externalInvoiceId, "POS-INV-E2E-01");
  assert.equal(cases.cases[0].intakeChannel, "POS_GATE_API");
  console.log("PASS POS Gate end-to-end HTTP contract persists a no-release invoice decision in an isolated ledger.");
} finally {
  child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
