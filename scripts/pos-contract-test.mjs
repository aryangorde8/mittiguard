import assert from "node:assert/strict";
import { buildInvoiceGateReceipt } from "../server.mjs";

const record = {
  id: "C-0042",
  createdAt: "2026-07-17T12:00:00.000Z",
  relay: { handoffCode: "MG-0042-GNT14" }
};
const gate = {
  saleState: "ON_HOLD",
  policyVersion: "MG-1.0",
  requiredEvidence: ["Current soil test / Soil Health Card"]
};
const receipt = buildInvoiceGateReceipt({ record, gate, invoiceId: "POS-INV-8841" });

assert.equal(receipt.contract, "MittiGuard POS Gate v1");
assert.equal(receipt.invoiceId, "POS-INV-8841");
assert.equal(receipt.saleAuthorization, "NOT_RELEASED");
assert.equal(receipt.saleState, "ON_HOLD");
assert.equal(receipt.handoffCode, "MG-0042-GNT14");
assert.match(receipt.decisionDigest, /^[A-F0-9]{16}$/);

console.log("PASS POS Gate contract returns an auditable no-release invoice receipt.");
