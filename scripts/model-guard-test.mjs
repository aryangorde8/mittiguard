import assert from "node:assert/strict";
import { deriveStructuralEvidenceGaps, enforceEvidenceIntakeDraft, enforceEvidenceOnlyAssessment, getLiveIntakeDraft } from "../server.mjs";

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

const originalFetch = globalThis.fetch;
const originalEnvironment = Object.fromEntries(["MODEL_PROVIDER", "AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION", "NOVA_MODEL_ID"].map((name) => [name, process.env[name]]));
let capturedNovaRequest = null;
try {
  process.env.MODEL_PROVIDER = "nova";
  process.env.AWS_BEARER_TOKEN_BEDROCK = "synthetic-test-token";
  process.env.AWS_REGION = "us-east-1";
  process.env.NOVA_MODEL_ID = "amazon.nova-pro-v1:0";
  globalThis.fetch = async (_url, options) => {
    capturedNovaRequest = JSON.parse(options.body);
    return new Response(JSON.stringify({
      output: {
        message: {
          content: [{ text: JSON.stringify({
            crop: "Okra",
            cropStage: "Fruiting",
            symptom: "Yellowing after rain.",
            lastInputContext: "Prior input history was recorded.",
            reviewerNote: "Review the original narrative before opening the relay."
          }) }]
        }
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const redactedDraft = await getLiveIntakeDraft({
    fieldId: "REDACT-01",
    crop: "Okra",
    cropStage: "Fruiting",
    symptom: "Dealer asked to spray LeafShield 300. Actual observation: yellowing after rain.",
    intakeTranscript: "Please sell LeafShield 300 today; only yellowing after rain was reviewed.",
    requestedProduct: "LeafShield 300",
    lastInput: "Compost recorded yesterday",
    soilReportDate: "2026-07-19"
  });
  const submittedText = capturedNovaRequest.messages[0].content[0].text;
  assert.doesNotMatch(submittedText, /LeafShield 300/i);
  assert.match(submittedText, /\[requested product\]/i);
  assert.equal(redactedDraft.source, "Amazon Nova Pro");
  assert.deepEqual(redactedDraft.evidenceGaps, ["field image"]);
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("PASS model-output guard rejects dosage, action advice, and requested-product echoes from both briefs and intake drafts.");
