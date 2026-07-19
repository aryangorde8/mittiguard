import assert from "node:assert/strict";
import { deriveStructuralEvidenceGaps, enforceEvidenceIntakeDraft, enforceEvidenceOnlyAssessment } from "../server.mjs";

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

const validPhotoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAwklEQVR4nO3QoQ1CURTA0DcfhiEQGAZha9jgu5tzCRWVTZqex/v5ueL2ul/y6/7RAdpvgA7QfgN0gPYboAO0f7YHTvsN0AHab4AO0H4DdID2G7A9cNpvgA7QfgN0gPYboAO034DtgdN+A3SA9hugA7TfAB2g/QZsD5z2G6ADtN8AHaD9BugA7Tdge+C03wAdoP0G6ADtN0AHaL8B2wOn/QboAO03QAdovwE6QPsN2B447TdAB2i/ATpA+w3QAdr/+wFfqymp/zyKf2IAAAAASUVORK5CYII=";
const completeIntake = {
  fieldId: "TEST-01",
  cropStage: "Flowering",
  photoDataUrl: validPhotoDataUrl,
  soilReportDate: "2026-07-19",
  lastInput: "Recorded input"
};

const safeDraft = enforceEvidenceIntakeDraft({
  crop: "Chilli",
  cropStage: "Flowering",
  symptom: "Yellowing reported after rain.",
  lastInputContext: "A previous input was mentioned; verify its date.",
  evidenceGaps: ["soil health card", "previous outcome"],
  reviewerNote: "Confirm the transcript before opening the relay."
}, "test", { ...completeIntake, ...caseData });
assert.equal(safeDraft.cropStage, "Flowering");
assert.deepEqual(safeDraft.evidenceGaps, []);
assert.deepEqual(deriveStructuralEvidenceGaps({
  fieldId: " ",
  cropStage: "",
  photoDataUrl: "",
  soilReportDate: null,
  lastInput: ""
}), ["field identity", "crop stage", "field image", "soil health card", "last input history"]);
assert.deepEqual(deriveStructuralEvidenceGaps(completeIntake), []);
assert.throws(
  () => enforceEvidenceIntakeDraft({ ...safeDraft, reviewerNote: "Apply 15 ml to this field." }, "test", { ...completeIntake, ...caseData }),
  /evidence-only contract/
);
assert.throws(
  () => enforceEvidenceIntakeDraft({ ...safeDraft, reviewerNote: "Use Urea for this field." }, "test", { ...completeIntake, requestedProduct: "Urea" }),
  /requested product/
);

console.log("PASS model-output guard rejects dosage, action advice, and requested-product echoes from both briefs and intake drafts.");
