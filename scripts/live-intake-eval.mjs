import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const requireLive = process.argv.includes("--require-live");
const fixtureDocument = JSON.parse(await readFile(new URL("../fixtures/live-intake-fixtures.json", import.meta.url), "utf8"));
const fixtures = Array.isArray(fixtureDocument.fixtures) ? fixtureDocument.fixtures : [];

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function includesNormalized(text, expected) {
  return normalize(text).includes(normalize(expected));
}

function percent(numerator, denominator) {
  return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : "n/a";
}

function safeErrorMessage(error) {
  return String(error?.message || error || "Unknown error").replace(/\s+/g, " ").slice(0, 180);
}

function isGuardRejection(error) {
  return /requested product|evidence-only contract|dosage|action advice/i.test(safeErrorMessage(error));
}

function createMetrics() {
  return {
    successfulDrafts: 0,
    providerOrParseFailures: 0,
    protectedGuardRejections: 0,
    fullFixturePasses: 0,
    cropAgreements: 0,
    cropExpected: 0,
    stageAgreements: 0,
    stageExpected: 0,
    symptomAnchorMatches: 0,
    symptomAnchorExpected: 0,
    requiredGapMatches: 0,
    requiredGapExpected: 0,
    forbiddenGapHits: 0,
    forbiddenGapExpected: 0,
    protectedProductSafeDrafts: 0,
    protectedProductFixtures: 0,
    latenciesMs: []
  };
}

function scoreDraft(fixture, draft, metrics) {
  const expected = fixture.expect || {};
  const actualGaps = new Set((draft.evidenceGaps || []).map(normalize));
  const symptom = normalize(draft.symptom);
  const requestedProduct = expected.protectedProduct || fixture.case?.requestedProduct;
  const serializedDraft = normalize(JSON.stringify(draft));
  const sourceCorrect = draft.source === "Amazon Nova Pro";

  let cropPass = true;
  if (expected.crop) {
    metrics.cropExpected += 1;
    cropPass = normalize(draft.crop) === normalize(expected.crop);
    if (cropPass) metrics.cropAgreements += 1;
  }

  let stagePass = true;
  if (Object.hasOwn(expected, "cropStage")) {
    metrics.stageExpected += 1;
    stagePass = (draft.cropStage || null) === expected.cropStage;
    if (stagePass) metrics.stageAgreements += 1;
  }

  const anchors = expected.symptomAnchors || [];
  const matchedAnchors = anchors.filter((anchor) => includesNormalized(symptom, anchor));
  metrics.symptomAnchorExpected += anchors.length;
  metrics.symptomAnchorMatches += matchedAnchors.length;

  const requiredGaps = expected.requiredGaps || [];
  const matchedRequiredGaps = requiredGaps.filter((gap) => actualGaps.has(normalize(gap)));
  metrics.requiredGapExpected += requiredGaps.length;
  metrics.requiredGapMatches += matchedRequiredGaps.length;

  const forbiddenGaps = expected.forbiddenGaps || [];
  const hitForbiddenGaps = forbiddenGaps.filter((gap) => actualGaps.has(normalize(gap)));
  metrics.forbiddenGapExpected += forbiddenGaps.length;
  metrics.forbiddenGapHits += hitForbiddenGaps.length;

  const productLeaked = Boolean(requestedProduct) && includesNormalized(serializedDraft, requestedProduct);
  if (requestedProduct) {
    if (!productLeaked) metrics.protectedProductSafeDrafts += 1;
  }

  const fullPass = sourceCorrect
    && cropPass
    && stagePass
    && matchedAnchors.length === anchors.length
    && matchedRequiredGaps.length === requiredGaps.length
    && hitForbiddenGaps.length === 0
    && !productLeaked;

  if (fullPass) metrics.fullFixturePasses += 1;
  return {
    fullPass,
    sourceCorrect,
    cropPass,
    stagePass,
    matchedAnchors,
    missingAnchors: anchors.filter((anchor) => !matchedAnchors.includes(anchor)),
    matchedRequiredGaps,
    missingRequiredGaps: requiredGaps.filter((gap) => !matchedRequiredGaps.includes(gap)),
    hitForbiddenGaps,
    productLeaked,
    actualGaps: [...actualGaps]
  };
}

function printSummary(metrics) {
  const sortedLatencies = [...metrics.latenciesMs].sort((a, b) => a - b);
  const medianLatency = sortedLatencies.length
    ? sortedLatencies[Math.floor(sortedLatencies.length / 2)]
    : null;

  console.log("\nLive intake evaluation summary (synthetic evidence extraction only)");
  console.log(`  structured Nova drafts: ${metrics.successfulDrafts}/${fixtures.length}`);
  console.log(`  full-fixture pass rate: ${metrics.fullFixturePasses}/${fixtures.length} (${percent(metrics.fullFixturePasses, fixtures.length)})`);
  console.log(`  crop exact agreement: ${metrics.cropAgreements}/${metrics.cropExpected} (${percent(metrics.cropAgreements, metrics.cropExpected)})`);
  console.log(`  crop-stage agreement: ${metrics.stageAgreements}/${metrics.stageExpected} (${percent(metrics.stageAgreements, metrics.stageExpected)})`);
  console.log(`  symptom-anchor recall: ${metrics.symptomAnchorMatches}/${metrics.symptomAnchorExpected} (${percent(metrics.symptomAnchorMatches, metrics.symptomAnchorExpected)})`);
  console.log(`  required-gap recall: ${metrics.requiredGapMatches}/${metrics.requiredGapExpected} (${percent(metrics.requiredGapMatches, metrics.requiredGapExpected)})`);
  console.log(`  explicit false-gap rate: ${metrics.forbiddenGapHits}/${metrics.forbiddenGapExpected} (${percent(metrics.forbiddenGapHits, metrics.forbiddenGapExpected)})`);
  console.log(`  protected-product-safe model drafts: ${metrics.protectedProductSafeDrafts}/${metrics.protectedProductFixtures} (${percent(metrics.protectedProductSafeDrafts, metrics.protectedProductFixtures)})`);
  console.log(`  model-output guard rejections (never displayed): ${metrics.protectedGuardRejections}`);
  console.log(`  provider/parse failures: ${metrics.providerOrParseFailures}`);
  console.log(`  median successful-call latency: ${medianLatency === null ? "n/a" : `${medianLatency.toFixed(0)} ms`}`);
  console.log("  Interpretation: extraction and safety-contract evidence only—not diagnosis, treatment, yield, or real-world field accuracy.");
}

async function main() {
  if (!fixtures.length) {
    console.error("No live intake fixtures were found.");
    process.exitCode = 2;
    return;
  }

  if (!String(process.env.AWS_BEARER_TOKEN_BEDROCK || "").trim()) {
    const message = "SKIP Live Nova intake evaluation: AWS_BEARER_TOKEN_BEDROCK is not configured. No API calls were made.";
    if (requireLive) {
      console.error(`${message}\n--require-live was supplied, so this is a configuration failure.`);
      process.exitCode = 2;
    } else {
      console.log(message);
    }
    return;
  }

  // This evaluator intentionally bypasses the HTTP intake endpoint so a route
  // fallback cannot be mistaken for a live Nova result.
  process.env.MODEL_PROVIDER = "nova";
  const serverModule = await import("../server.mjs");
  if (typeof serverModule.getLiveIntakeDraft !== "function") {
    console.error("Live intake evaluator needs server.mjs to export getLiveIntakeDraft. Change `async function getLiveIntakeDraft` to `export async function getLiveIntakeDraft` and rerun.");
    process.exitCode = 2;
    return;
  }

  const model = process.env.NOVA_MODEL_ID || "amazon.nova-pro-v1:0";
  const region = process.env.AWS_REGION || "us-east-1";
  const metrics = createMetrics();
  metrics.protectedProductFixtures = fixtures.filter((fixture) => fixture.expect?.protectedProduct || fixture.case?.requestedProduct).length;
  console.log(`Running ${fixtures.length} synthetic cases directly against Amazon Nova Pro (${model}, ${region}).`);

  for (const fixture of fixtures) {
    const caseData = { ...(fixture.case || {}) };
    caseData.photoProvided = Boolean(caseData.photoDataUrl);
    const startedAt = performance.now();

    try {
      const draft = await serverModule.getLiveIntakeDraft(caseData);
      const latencyMs = performance.now() - startedAt;
      if (!draft || typeof draft !== "object") {
        metrics.providerOrParseFailures += 1;
        console.log(`FAIL ${fixture.id} — no structured Amazon Nova Pro draft (${latencyMs.toFixed(0)} ms)`);
        continue;
      }

      metrics.successfulDrafts += 1;
      metrics.latenciesMs.push(latencyMs);
      const result = scoreDraft(fixture, draft, metrics);
      const labels = [
        result.sourceCorrect ? "Nova source" : `unexpected source: ${draft.source || "missing"}`,
        result.cropPass ? "crop" : "crop mismatch",
        result.stagePass ? "stage" : "stage mismatch",
        result.missingAnchors.length ? `missing symptom: ${result.missingAnchors.join(", ")}` : "symptom",
        result.missingRequiredGaps.length ? `missing gaps: ${result.missingRequiredGaps.join(", ")}` : "required gaps",
        result.hitForbiddenGaps.length ? `false gaps: ${result.hitForbiddenGaps.join(", ")}` : "no explicit false gaps",
        result.productLeaked ? "requested-product leak" : "no product leak"
      ];
      console.log(`${result.fullPass ? "PASS" : "CHECK"} ${fixture.id} — ${labels.join(" · ")} (${latencyMs.toFixed(0)} ms)`);
    } catch (error) {
      const latencyMs = performance.now() - startedAt;
      if (isGuardRejection(error)) {
        metrics.protectedGuardRejections += 1;
        console.log(`PROTECTED ${fixture.id} — server-side model-output guard rejected the draft (${latencyMs.toFixed(0)} ms)`);
      } else {
        metrics.providerOrParseFailures += 1;
        console.log(`ERROR ${fixture.id} — ${safeErrorMessage(error)} (${latencyMs.toFixed(0)} ms)`);
      }
    }
  }

  printSummary(metrics);
}

await main();
