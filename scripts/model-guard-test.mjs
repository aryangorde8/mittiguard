import assert from "node:assert/strict";
import { createSlidingWindowRateLimiter, enforceEvidenceIntakeDraft, enforceEvidenceOnlyAssessment } from "../server.mjs";

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

let clock = 0;
const limiter = createSlidingWindowRateLimiter({ limit: 2, windowMs: 1_000, now: () => clock });
assert.equal(limiter.take("judge").allowed, true);
assert.equal(limiter.take("judge").allowed, true);
assert.equal(limiter.take("judge").allowed, false);
clock = 1_001;
assert.equal(limiter.take("judge").allowed, true);

console.log("PASS model-output guard rejects dosage, action advice, and requested-product echoes from both briefs and intake drafts; live-model rate limiting safely falls back.");
