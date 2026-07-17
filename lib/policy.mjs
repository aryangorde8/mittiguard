/**
 * MittiGuard's policy engine is deliberately deterministic.
 * A model may describe evidence and uncertainty, but this module alone controls
 * the case state that a point-of-sale integration receives.
 */

const CURRENT_SOIL_REPORT_DAYS = 365;

export function ageInDays(dateString, now = new Date()) {
  if (!dateString) return Number.POSITIVE_INFINITY;
  const reportDate = new Date(dateString);
  if (Number.isNaN(reportDate.valueOf())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.valueOf() - reportDate.valueOf()) / 86_400_000);
}

export function getSoilStatus(soilReportDate, now = new Date()) {
  const age = ageInDays(soilReportDate, now);
  if (!Number.isFinite(age)) return { status: "missing", age: null };
  if (age > CURRENT_SOIL_REPORT_DAYS) return { status: "stale", age };
  return { status: "current", age };
}

export function evaluateGate(caseData, now = new Date()) {
  const reasons = [];
  const requiredEvidence = [];
  const soil = getSoilStatus(caseData.soilReportDate, now);
  const symptom = (caseData.symptom || "").toLowerCase();
  const requestType = caseData.requestType || "pesticide";
  const previousInputFailed = Boolean(caseData.previousInputFailed);
  const repeatRisk = caseData.repeatRisk?.detected ? caseData.repeatRisk : { detected: false, matches: [], summary: null };
  const isYellowing = /yellow|chlorosis|pale|wilting/.test(symptom);

  if (!caseData.photoProvided) {
    reasons.push("No field image is attached to this sale.");
    requiredEvidence.push("Whole-plant and close-up leaf photos");
  }

  if (!caseData.cropStage) {
    reasons.push("Crop stage is missing.");
    requiredEvidence.push("Crop stage");
  }

  if (!caseData.fieldId) {
    reasons.push("This case is not tied to a specific field record.");
    requiredEvidence.push("Field identity");
  }

  if (requestType === "fertiliser" && soil.status !== "current") {
    reasons.push(soil.status === "missing"
      ? "A fertiliser request has no soil report."
      : `The soil report is ${soil.age} days old and is no longer current.`);
    requiredEvidence.push("Current soil test / Soil Health Card");
  }

  if (isYellowing && soil.status !== "current") {
    reasons.push("Yellowing can reflect nutrient stress as well as disease, but current soil evidence is unavailable.");
    requiredEvidence.push("Current soil test / Soil Health Card");
  }

  if (previousInputFailed || repeatRisk.detected) {
    reasons.push(repeatRisk.detected
      ? `Automatic Field Memory match: ${repeatRisk.summary} Do not repeat a sale without review.`
      : "The field ledger records an unsuccessful prior input; do not repeat a sale without review.");
    requiredEvidence.push("Extension review of the previous outcome");
  }

  if (!caseData.lastInput) {
    reasons.push("Previous input history is incomplete.");
    requiredEvidence.push("Last input name and date");
  }

  const dedupedEvidence = [...new Set(requiredEvidence)];
  const mustHold = reasons.length > 0;

  return {
    decision: mustHold ? "PAUSED" : "REVIEW_READY",
    saleState: mustHold ? "ON_HOLD" : "REQUIRES_HUMAN_REVIEW",
    reasons,
    requiredEvidence: dedupedEvidence,
    policyVersion: "MG-1.0",
    soil,
    repeatRisk,
    safetyNote: mustHold
      ? "No pesticide or fertiliser recommendation is generated while this case is paused."
      : "This is not product authorization. A qualified reviewer still owns the next step."
  };
}

export function buildExtensionCase(caseData, gate) {
  const id = `EXT-${String(Date.now()).slice(-6)}`;
  return {
    id,
    status: "OPEN",
    priority: gate.decision === "PAUSED" ? "REVIEW NEEDED" : "READY FOR REVIEW",
    farmer: caseData.farmerName || "Unnamed farmer",
    field: caseData.fieldId || "Unlinked field",
    crop: caseData.crop || "Unspecified crop",
    createdAt: new Date().toISOString(),
    requiredEvidence: gate.requiredEvidence,
    summary: gate.reasons[0] || "Evidence package requires qualified review."
  };
}
