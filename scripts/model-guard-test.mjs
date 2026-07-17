import assert from "node:assert/strict";
import { enforceEvidenceOnlyAssessment } from "../server.mjs";

const safeAssessment = {
  observations: ["Yellowing was reported after rain."],
  conflicts: ["Current soil evidence is unavailable."],
  questions: ["Can a current Soil Health Card be attached?"],
  farmerMessage: "The case needs more evidence before a qualified reviewer continues."
};

const caseData = { requestedProduct: "LeafShield 300" };
const safe = enforceEvidenceOnlyAssessment(safeAssessment, "test", caseData);
assert.equal(safe.source, "test");

assert.doesNotThrow(() => enforceEvidenceOnlyAssessment(
  { ...safeAssessment, farmerMessage: "This product request needs qualified review before the next step." },
  "test",
  { requestedProduct: "Named product intentionally withheld from model context" }
));

assert.throws(
  () => enforceEvidenceOnlyAssessment({ ...safeAssessment, farmerMessage: "Apply 15 ml before the next sale." }, "test", caseData),
  /evidence-only contract/
);

assert.throws(
  () => enforceEvidenceOnlyAssessment({ ...safeAssessment, farmerMessage: "Use LeafShield 300 for this field." }, "test", caseData),
  /requested product/
);

console.log("PASS model-output guard rejects dosage, action advice, and requested-product echoes.");
