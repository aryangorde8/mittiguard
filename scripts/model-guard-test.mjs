import assert from "node:assert/strict";
import { enforceEvidenceIntakeDraft, enforceEvidenceOnlyAssessment } from "../server.mjs";

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

assert.throws(
  () => enforceEvidenceOnlyAssessment({ ...safeAssessment, farmerMessage: "Use Urea for this field." }, "test", { requestedProduct: "Urea" }),
  /requested product/
);

assert.throws(
  () => enforceEvidenceOnlyAssessment({ ...safeAssessment, farmerMessage: "Recommend a pesticide for this field." }, "test", { requestedProduct: "Unspecified" }),
  /evidence-only contract/
);

assert.throws(
  () => enforceEvidenceOnlyAssessment({ ...safeAssessment, farmerMessage: "Spray the field after rain." }, "test", { requestedProduct: "DAP" }),
  /evidence-only contract/
);

for (const farmerMessage of [
  "Recommend Urea for this field.",
  "Neem oil is recommended.",
  "Use NPK 19:19:19.",
  "Consider a treatment after rain."
]) {
  assert.throws(
    () => enforceEvidenceOnlyAssessment({ ...safeAssessment, farmerMessage }, "test", { requestedProduct: "DAP" }),
    /evidence-only contract/
  );
}

const safeDraft = enforceEvidenceIntakeDraft({
  crop: "Chilli",
  cropStage: "Flowering",
  symptom: "Yellowing reported after rain.",
  lastInputContext: "A previous input was mentioned; verify its date.",
  evidenceGaps: ["soil health card", "previous outcome"],
  reviewerNote: "Confirm the transcript before opening the relay."
}, "test", caseData);
assert.equal(safeDraft.cropStage, "Flowering");
assert.deepEqual(safeDraft.evidenceGaps, ["soil health card", "previous outcome"]);
assert.throws(
  () => enforceEvidenceIntakeDraft({ ...safeDraft, reviewerNote: "Apply 15 ml to this field." }, "test", caseData),
  /evidence-only contract/
);
assert.throws(
  () => enforceEvidenceIntakeDraft({ ...safeDraft, reviewerNote: "Use Urea for this field." }, "test", { requestedProduct: "Urea" }),
  /requested product/
);

console.log("PASS model-output guard rejects dosage, action advice, and requested-product echoes from both briefs and intake drafts.");
