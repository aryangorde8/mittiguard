import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGate } from "./policy.mjs";
import { MittiStore } from "./store.mjs";

const FIXTURE_NOW = new Date("2026-07-17T12:00:00Z");

async function readFixture(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

async function replayPolicyFixtures() {
  const fixtures = await readFixture("../fixtures/safety-cases.json");
  const results = fixtures.map((fixture) => {
    const gate = evaluateGate(fixture.input, FIXTURE_NOW);
    const passed = gate.saleState === fixture.expect && ["ON_HOLD", "REQUIRES_HUMAN_REVIEW"].includes(gate.saleState);
    return { id: fixture.id, label: fixture.name, passed };
  });
  return {
    id: "policy-gate",
    label: "Policy gate fixtures",
    detail: "Each case must end in ON HOLD or qualified review—never approved sale.",
    passed: results.every((result) => result.passed),
    passedCount: results.filter((result) => result.passed).length,
    total: results.length
  };
}

async function replayEvidenceDebt(directory) {
  const fixture = await readFixture("../fixtures/evidence-debt-benchmark.json");
  const storePath = join(directory, "evidence-debt.json");
  await writeFile(storePath, `${JSON.stringify(fixture.baseline)}\n`, "utf8");
  const localStore = new MittiStore(storePath);
  const results = [];
  for (const benchmarkCase of fixture.cases) {
    const risk = await localStore.findRepeatRisk(benchmarkCase.input);
    results.push({ id: benchmarkCase.id, passed: risk.detected === benchmarkCase.expectDetected });
  }
  return {
    id: "evidence-debt",
    label: "Evidence Debt adversarial replay",
    detail: "Exact field + crop + two shared signals; 12 repeat matches and 12 hard negatives.",
    passed: results.every((result) => result.passed),
    passedCount: results.filter((result) => result.passed).length,
    total: results.length
  };
}

async function replayRelayIntegrity(directory) {
  const storePath = join(directory, "relay-integrity.json");
  const localStore = new MittiStore(storePath);
  const input = {
    farmerName: "Evaluation Farmer",
    fieldId: "EVAL-14",
    crop: "Chilli",
    cropStage: "Flowering",
    symptom: "Yellowing lower leaves after rain",
    requestType: "pesticide",
    requestedProduct: "Evaluation product",
    photoProvided: true,
    photoDataUrl: "data:image/png;base64,raw-image-must-not-persist",
    soilReportDate: "2024-01-11",
    lastInput: "Previous input, 10 days ago",
    previousInputFailed: true,
    externalInvoiceId: "POS-EVAL-01",
    intakeChannel: "POS_GATE_API"
  };
  const gate = evaluateGate(input, FIXTURE_NOW);
  const record = await localStore.createCase({
    caseData: input,
    gate,
    assessment: { observations: ["Synthetic evaluation case."], conflicts: [], questions: [], source: "evaluation" }
  });
  let updated = record;
  for (const task of record.relay.tasks) {
    updated = await localStore.recordTaskEvidence(record.id, task.id, "Synthetic evidence received for replay.");
  }
  const reviewerName = "Synthetic Evaluation Reviewer";
  const assigned = await localStore.assignCase(record.id, { role: "EXTENSION_REVIEW", name: reviewerName });
  const preview = await localStore.getReviewAttestationPreview(record.id);
  let attestation = null;
  let verification = null;
  let outcome = null;
  let deniedAttestation = false;
  let deniedOutcome = false;

  if (preview.eligible) {
    attestation = await localStore.attestReview(record.id, {
      reviewerName,
      disposition: "MANUAL_POS_DECISION_REQUIRED",
      note: "Synthetic sealed-review replay; no MittiGuard release authority.",
      confirmed: true,
      expectedEvidenceDigest: preview.evidenceDigest,
      expectedAuditHeadHash: preview.auditAnchor.headHash
    });
    verification = await localStore.getReviewAttestationVerification(record.id);
    outcome = await localStore.recordFieldOutcome(record.id, {
      state: "NOT_IMPROVED",
      note: "Synthetic follow-up observation: unresolved."
    });
  } else {
    // The public jury demo can run without an HMAC secret. In that case it
    // must fail closed: an unsealed audit chain cannot create an attestation
    // or unlock the Field Memory outcome path.
    try {
      await localStore.attestReview(record.id, {
        reviewerName,
        disposition: "MANUAL_POS_DECISION_REQUIRED",
        note: "This must be rejected while the replay ledger is unsealed.",
        confirmed: true,
        expectedEvidenceDigest: preview.evidenceDigest,
        expectedAuditHeadHash: preview.auditAnchor.headHash
      });
    } catch {
      deniedAttestation = true;
    }
    try {
      await localStore.recordFieldOutcome(record.id, {
        state: "NOT_IMPROVED",
        note: "This must be rejected before a valid human attestation."
      });
    } catch {
      deniedOutcome = true;
    }
  }
  const audit = await localStore.getLedgerVerification(record.id);
  const current = await localStore.getCase(record.id);
  const raw = await readFile(storePath, "utf8");
  const checks = [
    gate.saleState === "ON_HOLD",
    record.intakeChannel === "POS_GATE_API" && record.externalInvoiceId === "POS-EVAL-01",
    record.relay.tasks.length > 0,
    updated.relay.tasks.every((task) => task.status === "EVIDENCE_RECEIVED"),
    updated.relay.phase === "EXTENSION_REVIEW",
    assigned.relay.owner?.name === reviewerName,
    preview.saleAuthorization === "NOT_RELEASED",
    preview.eligible
      ? verification?.valid === true && verification.saleRemainsBlocked === true && attestation?.reviewAttestation?.saleAuthorization === "NOT_RELEASED"
      : deniedAttestation && !preview.auditProof.sealed,
    preview.eligible
      ? outcome?.fieldOutcome?.state === "NOT_IMPROVED" && outcome.saleState === "ON_HOLD"
      : deniedOutcome,
    current?.saleState === "ON_HOLD",
    audit.valid,
    !raw.includes("raw-image-must-not-persist")
  ];
  return {
    id: "relay-integrity",
    label: "Gate-to-review relay integrity",
    detail: preview.eligible
      ? "A sealed replay binds a named reviewer, exact evidence packet, and no-release POS invoice before an outcome is recorded."
      : "Without a sealing secret, reviewer attestation and field-outcome writes both fail closed; the invoice remains on hold.",
    passed: checks.every(Boolean),
    passedCount: checks.filter(Boolean).length,
    total: checks.length
  };
}

export async function runEvaluationReplay() {
  const directory = await mkdtemp(join(tmpdir(), "mittiguard-evaluation-"));
  try {
    const groups = await Promise.all([
      replayPolicyFixtures(),
      replayEvidenceDebt(directory),
      replayRelayIntegrity(directory)
    ]);
    const passedCount = groups.reduce((total, group) => total + group.passedCount, 0);
    const total = groups.reduce((count, group) => count + group.total, 0);
    return {
      passed: groups.every((group) => group.passed),
      passedCount,
      total,
      groups,
      ranAt: new Date().toISOString(),
      scope: "Deterministic product-policy replay only. It does not assess agronomic diagnosis accuracy or real-world yield outcomes."
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
