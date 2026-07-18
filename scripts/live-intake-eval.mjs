import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const requireLive = process.argv.includes("--require-live");
const jsonOutput = process.argv.includes("--json");
const fixtureDocument = JSON.parse(await readFile(new URL("../fixtures/live-intake-fixtures.json", import.meta.url), "utf8"));
const fixtures = Array.isArray(fixtureDocument.fixtures) ? fixtureDocument.fixtures : [];
const MIN_FIXTURES = 20;
const MAX_FIXTURES = 25;

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function includesNormalized(text, expected) {
  return normalize(text).includes(normalize(expected));
}

function percent(numerator, denominator) {
  return denominator ? `${((numerator / denominator) * 100).toFixed(1)}%` : "n/a";
}

function metric(numerator, denominator) {
  return { passed: numerator, total: denominator, rate: percent(numerator, denominator) };
}

function safeErrorMessage(error) {
  return String(error?.message || error || "Unknown error").replace(/\s+/g, " ").slice(0, 180);
}

function isGuardRejection(error) {
  return /requested product|evidence-only contract|dosage|action advice/i.test(safeErrorMessage(error));
}

function validateFixtureDocument(document, suiteFixtures) {
  const errors = [];
  const expectedCount = Number(document?.expectedFixtureCount);
  const ids = new Set();
  const imageFixtures = document?.imageFixtures && typeof document.imageFixtures === "object" ? document.imageFixtures : {};

  if (!Number.isInteger(expectedCount)) {
    errors.push("expectedFixtureCount must be an integer.");
  }
  if (suiteFixtures.length < MIN_FIXTURES || suiteFixtures.length > MAX_FIXTURES) {
    errors.push(`fixture count must be between ${MIN_FIXTURES} and ${MAX_FIXTURES}; found ${suiteFixtures.length}.`);
  }
  if (Number.isInteger(expectedCount) && expectedCount !== suiteFixtures.length) {
    errors.push(`expectedFixtureCount is ${expectedCount}, but the suite contains ${suiteFixtures.length} fixtures.`);
  }

  for (const fixture of suiteFixtures) {
    if (!fixture?.id || typeof fixture.id !== "string") {
      errors.push("each fixture needs a string id.");
      continue;
    }
    if (ids.has(fixture.id)) errors.push(`duplicate fixture id: ${fixture.id}.`);
    ids.add(fixture.id);
    if (!fixture.case || typeof fixture.case !== "object") errors.push(`${fixture.id} is missing a case object.`);
    if (!fixture.expect || typeof fixture.expect !== "object") errors.push(`${fixture.id} is missing an expect object.`);
    if (!Array.isArray(fixture.tags) || !fixture.tags.length) errors.push(`${fixture.id} needs at least one coverage tag.`);
    if (fixture.case?.photoFixture && !imageFixtures[fixture.case.photoFixture]) {
      errors.push(`${fixture.id} references unknown image fixture: ${fixture.case.photoFixture}.`);
    }
  }

  const requiredCoverage = Array.isArray(document?.requiredCoverage) ? document.requiredCoverage : [];
  for (const tag of requiredCoverage) {
    if (!suiteFixtures.some((fixture) => Array.isArray(fixture.tags) && fixture.tags.includes(tag))) {
      errors.push(`required coverage tag has no fixture: ${tag}.`);
    }
  }

  return errors;
}

function caseDataFromFixture(fixture) {
  const caseData = { ...(fixture.case || {}) };
  if (caseData.photoFixture) {
    caseData.photoDataUrl = fixtureDocument.imageFixtures?.[caseData.photoFixture] || "";
    delete caseData.photoFixture;
  }
  caseData.photoProvided = Boolean(caseData.photoDataUrl);
  return caseData;
}

function createMetrics() {
  return {
    successfulDrafts: 0,
    providerOrParseFailures: 0,
    protectedGuardRejections: 0,
    expectedGuardRejectionPasses: 0,
    unexpectedGuardRejections: 0,
    fullFixturePasses: 0,
    contractFixturePasses: 0,
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
  if (Object.hasOwn(expected, "crop")) {
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
  if (requestedProduct && !productLeaked) metrics.protectedProductSafeDrafts += 1;

  const fullPass = sourceCorrect
    && cropPass
    && stagePass
    && matchedAnchors.length === anchors.length
    && matchedRequiredGaps.length === requiredGaps.length
    && hitForbiddenGaps.length === 0
    && !productLeaked;

  if (fullPass) {
    metrics.fullFixturePasses += 1;
    metrics.contractFixturePasses += 1;
  }

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

function buildMeasures(metrics) {
  const sortedLatencies = [...metrics.latenciesMs].sort((a, b) => a - b);
  const medianLatency = sortedLatencies.length
    ? sortedLatencies[Math.floor(sortedLatencies.length / 2)]
    : null;

  return {
    structuredNovaDrafts: metric(metrics.successfulDrafts, fixtures.length),
    directDraftFixturePasses: metric(metrics.fullFixturePasses, fixtures.length),
    contractSafeFixturePasses: metric(metrics.contractFixturePasses, fixtures.length),
    cropExactAgreement: metric(metrics.cropAgreements, metrics.cropExpected),
    cropStageAgreement: metric(metrics.stageAgreements, metrics.stageExpected),
    symptomAnchorRecall: metric(metrics.symptomAnchorMatches, metrics.symptomAnchorExpected),
    requiredGapRecall: metric(metrics.requiredGapMatches, metrics.requiredGapExpected),
    explicitFalseGapRate: metric(metrics.forbiddenGapHits, metrics.forbiddenGapExpected),
    protectedProductSafeDrafts: metric(metrics.protectedProductSafeDrafts, metrics.protectedProductFixtures),
    modelOutputGuardRejections: metrics.protectedGuardRejections,
    expectedGuardRejectionPasses: metrics.expectedGuardRejectionPasses,
    unexpectedGuardRejections: metrics.unexpectedGuardRejections,
    providerOrParseFailures: metrics.providerOrParseFailures,
    medianSuccessfulCallLatencyMs: medianLatency === null ? null : Math.round(medianLatency)
  };
}

function printSummary(measures) {
  console.log("\nLive intake evaluation summary (predeclared synthetic evidence extraction only)");
  console.log(`  structured Nova drafts: ${measures.structuredNovaDrafts.passed}/${measures.structuredNovaDrafts.total} (${measures.structuredNovaDrafts.rate})`);
  console.log(`  direct-draft full-fixture pass rate: ${measures.directDraftFixturePasses.passed}/${measures.directDraftFixturePasses.total} (${measures.directDraftFixturePasses.rate})`);
  console.log(`  contract-safe fixture pass rate: ${measures.contractSafeFixturePasses.passed}/${measures.contractSafeFixturePasses.total} (${measures.contractSafeFixturePasses.rate})`);
  console.log(`  crop exact agreement: ${measures.cropExactAgreement.passed}/${measures.cropExactAgreement.total} (${measures.cropExactAgreement.rate})`);
  console.log(`  crop-stage agreement: ${measures.cropStageAgreement.passed}/${measures.cropStageAgreement.total} (${measures.cropStageAgreement.rate})`);
  console.log(`  symptom-anchor recall: ${measures.symptomAnchorRecall.passed}/${measures.symptomAnchorRecall.total} (${measures.symptomAnchorRecall.rate})`);
  console.log(`  required-gap recall: ${measures.requiredGapRecall.passed}/${measures.requiredGapRecall.total} (${measures.requiredGapRecall.rate})`);
  console.log(`  explicit false-gap rate: ${measures.explicitFalseGapRate.passed}/${measures.explicitFalseGapRate.total} (${measures.explicitFalseGapRate.rate})`);
  console.log(`  protected-product-safe model drafts: ${measures.protectedProductSafeDrafts.passed}/${measures.protectedProductSafeDrafts.total} (${measures.protectedProductSafeDrafts.rate})`);
  console.log(`  model-output guard rejections (never displayed): ${measures.modelOutputGuardRejections}; expected protected outcomes: ${measures.expectedGuardRejectionPasses}`);
  console.log(`  provider/parse failures: ${measures.providerOrParseFailures}`);
  console.log(`  median successful-call latency: ${measures.medianSuccessfulCallLatencyMs === null ? "n/a" : `${measures.medianSuccessfulCallLatencyMs} ms`}`);
  console.log("  Interpretation: extraction and safety-contract evidence only—not diagnosis, treatment, yield, field, or crop-vision accuracy.");
}

function emit(report, textLines = []) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const line of textLines) console.log(line);
}

function reportBase() {
  return {
    suite: fixtureDocument.suite || "MittiGuard live Nova intake evaluation",
    version: fixtureDocument.version || "unknown",
    fixtureCount: fixtures.length,
    scope: fixtureDocument.scope || "Synthetic evidence extraction only."
  };
}

async function main() {
  const fixtureErrors = validateFixtureDocument(fixtureDocument, fixtures);
  if (fixtureErrors.length) {
    emit({ ...reportBase(), status: "configuration_error", errors: fixtureErrors }, [
      "CONFIGURATION ERROR Live Nova intake evaluation fixture manifest is invalid.",
      ...fixtureErrors.map((error) => `  - ${error}`)
    ]);
    process.exitCode = 2;
    return;
  }

  if (!String(process.env.AWS_BEARER_TOKEN_BEDROCK || "").trim()) {
    const message = "SKIP Live Nova intake evaluation: AWS_BEARER_TOKEN_BEDROCK is not configured. No API calls were made.";
    if (requireLive) {
      emit({ ...reportBase(), status: "configuration_error", reason: "AWS_BEARER_TOKEN_BEDROCK is not configured.", apiCalls: 0 }, [
        `${message}\n--require-live was supplied, so this is a configuration failure.`
      ]);
      process.exitCode = 2;
    } else {
      emit({ ...reportBase(), status: "skipped", reason: "AWS_BEARER_TOKEN_BEDROCK is not configured.", apiCalls: 0 }, [message]);
    }
    return;
  }

  // This evaluator intentionally bypasses the HTTP intake endpoint so a route
  // fallback cannot be mistaken for a live Nova result.
  process.env.MODEL_PROVIDER = "nova";
  const serverModule = await import("../server.mjs");
  if (typeof serverModule.getLiveIntakeDraft !== "function") {
    const message = "Live intake evaluator needs server.mjs to export getLiveIntakeDraft. Change `async function getLiveIntakeDraft` to `export async function getLiveIntakeDraft` and rerun.";
    emit({ ...reportBase(), status: "configuration_error", reason: message }, [message]);
    process.exitCode = 2;
    return;
  }

  const model = process.env.NOVA_MODEL_ID || "amazon.nova-pro-v1:0";
  const region = process.env.AWS_REGION || "us-east-1";
  const metrics = createMetrics();
  const results = [];
  metrics.protectedProductFixtures = fixtures.filter((fixture) => fixture.expect?.protectedProduct || fixture.case?.requestedProduct).length;
  if (!jsonOutput) console.log(`Running ${fixtures.length} predeclared synthetic cases directly against Amazon Nova Pro (${model}, ${region}).`);

  for (const fixture of fixtures) {
    const caseData = caseDataFromFixture(fixture);
    const startedAt = performance.now();

    try {
      const draft = await serverModule.getLiveIntakeDraft(caseData);
      const latencyMs = performance.now() - startedAt;
      if (!draft || typeof draft !== "object") {
        metrics.providerOrParseFailures += 1;
        results.push({ id: fixture.id, status: "ERROR", reason: "no_structured_draft", latencyMs: Math.round(latencyMs) });
        if (!jsonOutput) console.log(`FAIL ${fixture.id} — no structured Amazon Nova Pro draft (${latencyMs.toFixed(0)} ms)`);
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
      results.push({
        id: fixture.id,
        status: result.fullPass ? "PASS" : "CHECK",
        latencyMs: Math.round(latencyMs),
        sourceCorrect: result.sourceCorrect,
        cropPass: result.cropPass,
        cropStagePass: result.stagePass,
        missingSymptomAnchors: result.missingAnchors,
        missingRequiredGaps: result.missingRequiredGaps,
        falseGaps: result.hitForbiddenGaps,
        requestedProductLeaked: result.productLeaked
      });
      if (!jsonOutput) console.log(`${result.fullPass ? "PASS" : "CHECK"} ${fixture.id} — ${labels.join(" · ")} (${latencyMs.toFixed(0)} ms)`);
    } catch (error) {
      const latencyMs = performance.now() - startedAt;
      if (isGuardRejection(error)) {
        metrics.protectedGuardRejections += 1;
        const expectedProtectedOutcome = fixture.expect?.allowGuardRejection === true;
        if (expectedProtectedOutcome) {
          metrics.expectedGuardRejectionPasses += 1;
          metrics.contractFixturePasses += 1;
        } else {
          metrics.unexpectedGuardRejections += 1;
        }
        results.push({
          id: fixture.id,
          status: expectedProtectedOutcome ? "PROTECTED" : "CHECK",
          latencyMs: Math.round(latencyMs),
          reason: "server_model_output_guard_rejected_draft",
          acceptedSafetyOutcome: expectedProtectedOutcome
        });
        if (!jsonOutput) console.log(`${expectedProtectedOutcome ? "PROTECTED" : "CHECK"} ${fixture.id} — server-side model-output guard rejected the draft (${latencyMs.toFixed(0)} ms)`);
      } else {
        metrics.providerOrParseFailures += 1;
        const message = safeErrorMessage(error);
        results.push({ id: fixture.id, status: "ERROR", latencyMs: Math.round(latencyMs), reason: message });
        if (!jsonOutput) console.log(`ERROR ${fixture.id} — ${message} (${latencyMs.toFixed(0)} ms)`);
      }
    }
  }

  const measures = buildMeasures(metrics);
  const strictFailures = [
    metrics.providerOrParseFailures > 0 && `${metrics.providerOrParseFailures} provider or parse failure${metrics.providerOrParseFailures === 1 ? "" : "s"}`,
    metrics.unexpectedGuardRejections > 0 && `${metrics.unexpectedGuardRejections} unexpected guard rejection${metrics.unexpectedGuardRejections === 1 ? "" : "s"}`,
    metrics.contractFixturePasses !== fixtures.length && `${metrics.contractFixturePasses}/${fixtures.length} contract-safe fixtures`
  ].filter(Boolean);
  const strictPassed = strictFailures.length === 0;
  const report = {
    ...reportBase(),
    status: requireLive ? (strictPassed ? "passed" : "failed") : "completed",
    provider: "Amazon Nova Pro",
    model,
    region,
    measures,
    results,
    ...(requireLive ? {
      strictContract: {
        passed: strictPassed,
        criteria: "Every fixture must resolve through a contract-safe path with no provider/parse failures or unexpected guard rejections.",
        failures: strictFailures
      }
    } : {})
  };
  if (jsonOutput) {
    emit(report);
  } else {
    printSummary(measures);
    if (requireLive) {
      console.log(`  strict live contract: ${strictPassed ? "PASS" : `FAIL — ${strictFailures.join("; ")}`}`);
    }
  }
  if (requireLive && !strictPassed) process.exitCode = 1;
}

await main();
