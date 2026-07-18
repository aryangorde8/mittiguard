import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendLedgerEntry, ensureAuditLedger, resetAuditLedger, verifyAuditLedger } from "./audit-ledger.mjs";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const storePath = process.env.MITTIGUARD_STORE_PATH || join(moduleDir, "../data/store.json");
const demoStorePath = join(moduleDir, "../data/demo-store.json");
const RELAY_SLA_HOURS = 24;
const OUTCOME_STATES = new Set(["NOT_IMPROVED", "IMPROVED", "UNCERTAIN"]);
const REVIEW_ATTESTATION_DISPOSITIONS = new Set(["MANUAL_POS_DECISION_REQUIRED", "ESCALATE"]);
const GENERIC_REVIEWER_NAMES = new Set(["", "extension desk", "extension review", "reviewer", "unassigned", "unknown"]);
const FIELD_CAPTURE_TOKEN_PREFIX = "mgfc_";
const FIELD_CAPTURE_MINUTES_MIN = 5;
const FIELD_CAPTURE_MINUTES_MAX = 24 * 60;
const DEFAULT_FIELD_CAPTURE_MINUTES = 30;
const FIELD_CAPTURE_ADVICE_PATTERN = /\b(?:apply|spray|mix|treat|drench|dose|fertili[sz]e|recommend(?:ed|ing)?|prescrib(?:e|ed|ing))\b/i;

const emptyStore = () => ({ version: 3, cases: [], fields: [] });
const SYMPTOM_STOP_WORDS = new Set(["after", "before", "field", "from", "input", "issue", "leaf", "leaves", "lower", "plant", "plants", "previous", "prior", "reported", "this", "that", "with"]);
const SYMPTOM_ALIASES = new Map([["rainfall", "rain"], ["rainy", "rain"], ["yellow", "yellowing"]]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").toUpperCase();
}

function tokenHash(token) {
  return createHash("sha256").update(`mittiguard-field-capture-v1:${token}`).digest("hex").toUpperCase();
}

function safeStringEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""));
  const rightBytes = Buffer.from(String(right || ""));
  return leftBytes.length === rightBytes.length
    && leftBytes.length > 0
    && timingSafeEqual(leftBytes, rightBytes);
}

function normalizeFieldCaptureToken(value) {
  const token = String(value || "").trim();
  return new RegExp(`^${FIELD_CAPTURE_TOKEN_PREFIX}[A-Za-z0-9_-]{32,160}$`).test(token) ? token : null;
}

function fieldCaptureMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_FIELD_CAPTURE_MINUTES;
  return Math.min(FIELD_CAPTURE_MINUTES_MAX, Math.max(FIELD_CAPTURE_MINUTES_MIN, Math.round(parsed)));
}

function captureCapabilityIsUsable(capability, token, now = Date.now()) {
  return Boolean(
    capability
      && !capability.usedAt
      && Number.isFinite(Date.parse(capability.expiresAt))
      && Date.parse(capability.expiresAt) > now
      && safeStringEqual(capability.tokenHash, tokenHash(token))
  );
}

function fieldCaptureContext(record, task, capability) {
  return {
    workflow: "MittiGuard Field Capture",
    caseReference: record.relay?.handoffCode || record.id,
    field: record.field,
    crop: record.crop,
    cropStage: record.cropStage,
    task: {
      id: task.id,
      title: task.title,
      evidence: task.evidence,
      dueAt: task.dueAt
    },
    expiresAt: capability.expiresAt,
    saleAuthorization: "NOT_RELEASED",
    saleState: record.saleState,
    notice: "Evidence can move this task forward. It cannot release the invoice or authorize an input."
  };
}

function normalizeFieldCaptureObservation(value) {
  const observation = String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (FIELD_CAPTURE_ADVICE_PATTERN.test(observation)) {
    throw requestError("Field capture accepts neutral observations only; do not include treatment or product advice.");
  }
  return observation;
}

function normalizeFieldCaptureImage(input) {
  if (!input) return null;
  const mediaType = String(input.mediaType || "").toLowerCase();
  const bytes = Number(input.bytes);
  const digest = String(input.sha256 || "").toUpperCase();
  if (!/^image\/(?:png|jpeg|gif|webp)$/.test(mediaType)
    || !Number.isInteger(bytes)
    || bytes <= 0
    || bytes > 1_000_000
    || !/^[A-F0-9]{64}$/.test(digest)) {
    throw requestError("The field image metadata is invalid.");
  }
  return { mediaType, bytes, sha256: digest };
}

function evidencePayload(record, invoiceId) {
  return {
    version: 1,
    caseId: record.id,
    invoiceId,
    field: record.field,
    crop: record.crop,
    cropStage: record.cropStage,
    symptom: record.symptom,
    photoAttached: Boolean(record.photoAttached),
    soilReportDate: record.soilReportDate || null,
    lastInput: record.lastInput || null,
    intakeTranscriptDigest: record.intakeTranscript
      ? sha256({ version: 1, transcript: record.intakeTranscript })
      : null,
    requiredEvidence: [...(record.requiredEvidence || [])],
    saleState: record.saleState,
    policyVersion: record.policyVersion,
    tasks: (record.relay?.tasks || []).map((task) => ({
      id: task.id,
      evidence: task.evidence,
      ownerRole: task.ownerRole,
      status: task.status,
      completedAt: task.completedAt,
      note: task.note,
      // Field Capture stores a receipt, never a raw image. Binding that
      // receipt into the evidence digest prevents a later attestation from
      // silently referring to a different mobile submission.
      fieldCapture: task.fieldCapture ? {
        version: task.fieldCapture.version,
        submittedAt: task.fieldCapture.submittedAt,
        observation: task.fieldCapture.observation,
        image: task.fieldCapture.image ? {
          mediaType: task.fieldCapture.image.mediaType,
          bytes: task.fieldCapture.image.bytes,
          sha256: task.fieldCapture.image.sha256
        } : null
      } : null
    }))
  };
}

function attestationPayload(attestation) {
  return {
    version: 1,
    id: attestation.id,
    status: attestation.status,
    caseId: attestation.caseId,
    invoiceId: attestation.invoiceId,
    reviewerName: attestation.reviewerName,
    disposition: attestation.disposition,
    note: attestation.note,
    reviewedAt: attestation.reviewedAt,
    saleAuthorization: attestation.saleAuthorization,
    saleState: attestation.saleState,
    policyVersion: attestation.policyVersion,
    evidenceDigest: attestation.evidenceDigest,
    auditAnchor: attestation.auditAnchor,
    confirmed: attestation.confirmed
  };
}

function reviewDispositionLabel(disposition) {
  return disposition === "ESCALATE" ? "Escalate to qualified authority" : "Manual POS decision required";
}

function auditAnchorFromProof(proof) {
  return {
    ledgerId: proof.ledgerId,
    ledgerVersion: proof.ledgerVersion,
    algorithm: proof.algorithm,
    coverage: proof.coverage,
    headHash: proof.headHash,
    caseLastSequence: proof.caseLastSequence
  };
}

function isNamedReviewer(value) {
  const name = String(value || "").trim();
  return name.length >= 3 && !GENERIC_REVIEWER_NAMES.has(normalized(name));
}

function attestationAuditDetail(attestation) {
  return `Attestation ${attestation.id} · binding ${attestation.bindingDigest} · invoice ${attestation.invoiceId} · authorization NOT_RELEASED · evidence ${attestation.evidenceDigest} · anchor ${attestation.auditAnchor.ledgerId}/${attestation.auditAnchor.caseLastSequence ?? "NONE"}/${attestation.auditAnchor.headHash}`;
}

function reviewAttestationVerification(record, data) {
  const attestation = record?.reviewAttestation;
  if (!attestation) return { exists: false, valid: false, reason: "No reviewer attestation is recorded." };
  const evidenceDigest = sha256(evidencePayload(record, attestation.invoiceId));
  const bindingDigest = sha256(attestationPayload(attestation));
  const auditEvent = record.relay?.audit?.find((event) => event.id === attestation.auditEventId);
  const auditEntry = data?.auditLedger?.entries?.find((entry) => entry.id === attestation.ledgerEntryId);
  const auditDetail = attestationAuditDetail(attestation);
  const priorCaseEntry = data?.auditLedger?.entries
    ?.filter((entry) => entry.caseId === record.id && entry.sequence < attestation.ledgerSequence)
    .at(-1) || null;
  const auditBound = Boolean(auditEvent && auditEntry)
    && auditEvent.ledgerSequence === attestation.ledgerSequence
    && auditEvent.hash === attestation.auditHash
    && auditEvent.previousHash === attestation.auditAnchor?.headHash
    && auditEvent.actor === attestation.reviewerName
    && auditEvent.event === "Human review attested"
    && auditEvent.detail === auditDetail
    && auditEntry.sequence === attestation.ledgerSequence
    && auditEntry.hash === attestation.auditHash
    && auditEntry.previousHash === attestation.auditAnchor?.headHash
    && auditEntry.ledgerId === attestation.auditAnchor?.ledgerId
    && auditEntry.ledgerVersion === attestation.auditAnchor?.ledgerVersion
    && auditEntry.coverage === attestation.auditAnchor?.coverage
    && auditEntry.detail === auditDetail
    && auditEntry.actor === attestation.reviewerName
    && auditEntry.event === "Human review attested";
  const auditProof = data ? verifyAuditLedger(data, { caseId: record.id }) : null;
  const auditSealedAndValid = Boolean(auditProof?.valid && auditProof?.sealed);
  const anchorIdentityBound = Boolean(auditProof && attestation.auditAnchor)
    && auditProof.ledgerId === attestation.auditAnchor.ledgerId
    && auditProof.ledgerVersion === attestation.auditAnchor.ledgerVersion
    && auditProof.algorithm === attestation.auditAnchor.algorithm
    && auditProof.coverage === attestation.auditAnchor.coverage
    && (priorCaseEntry?.sequence || null) === (attestation.auditAnchor.caseLastSequence || null);
  const reviewerBound = isNamedReviewer(attestation.reviewerName)
    && record.relay?.owner?.role === "EXTENSION_REVIEW"
    && record.relay?.owner?.name === attestation.reviewerName;
  const posBound = record.intakeChannel === "POS_GATE_API"
    && Boolean(record.externalInvoiceId)
    && record.externalInvoiceId === attestation.invoiceId;
  const saleRemainsBlocked = ["ON_HOLD", "REQUIRES_HUMAN_REVIEW"].includes(record.saleState);
  return {
    exists: true,
    valid: evidenceDigest === attestation.evidenceDigest
      && bindingDigest === attestation.bindingDigest
      && auditBound
      && auditSealedAndValid
      && anchorIdentityBound
      && reviewerBound
      && posBound
      && attestation.saleAuthorization === "NOT_RELEASED"
      && saleRemainsBlocked,
    reviewerName: attestation.reviewerName,
    status: attestation.status,
    disposition: attestation.disposition,
    dispositionLabel: reviewDispositionLabel(attestation.disposition),
    invoiceId: attestation.invoiceId,
    evidenceDigest: attestation.evidenceDigest,
    bindingDigest: attestation.bindingDigest,
    reviewedAt: attestation.reviewedAt,
    ledgerSequence: attestation.ledgerSequence || null,
    auditHash: attestation.auditHash || null,
    saleState: record.saleState,
    saleRemainsBlocked,
    auditBound,
    auditSealedAndValid,
    anchorIdentityBound,
    reviewerBound,
    posBound,
    auditProof
  };
}

function normalized(value = "") {
  return String(value).trim().toLowerCase();
}

function symptomTokens(value = "") {
  return [...new Set(normalized(value).split(/[^a-z0-9]+/)
    .map((token) => SYMPTOM_ALIASES.get(token) || token)
    .filter((token) => token.length >= 4 && !SYMPTOM_STOP_WORDS.has(token)))];
}

function sharedSymptoms(current, previous) {
  const currentTokens = symptomTokens(current);
  const previousTokens = new Set(symptomTokens(previous));
  return currentTokens.filter((token) => previousTokens.has(token));
}

function addHours(isoDate, hours) {
  return new Date(new Date(isoDate).valueOf() + hours * 3_600_000).toISOString();
}

function taskOwner(requiredEvidence = "") {
  if (/photo|soil test|soil health/i.test(requiredEvidence)) return "FIELD_CAPTURE";
  if (/extension/i.test(requiredEvidence)) return "EXTENSION_REVIEW";
  return "DEALER_DESK";
}

function taskLabel(requiredEvidence = "") {
  if (/photo/i.test(requiredEvidence)) return "Capture whole-plant and close-up photos";
  if (/soil test|soil health/i.test(requiredEvidence)) return "Attach a current Soil Health Card / test";
  if (/extension/i.test(requiredEvidence)) return "Review the previous input outcome";
  if (/crop stage/i.test(requiredEvidence)) return "Confirm the crop stage";
  if (/field identity/i.test(requiredEvidence)) return "Link the sale to a field record";
  if (/last input/i.test(requiredEvidence)) return "Record the last input and date";
  return requiredEvidence;
}

function roleLabel(role) {
  return ({ FIELD_CAPTURE: "Field capture", EXTENSION_REVIEW: "Extension review", DEALER_DESK: "Dealer desk" })[role] || "Evidence relay";
}

function buildTasks(record, createdAt) {
  return (record.requiredEvidence || []).map((requiredEvidence, index) => ({
    id: `T-${record.id.replace("C-", "")}-${String(index + 1).padStart(2, "0")}`,
    title: taskLabel(requiredEvidence),
    evidence: requiredEvidence,
    ownerRole: taskOwner(requiredEvidence),
    status: "REQUESTED",
    dueAt: addHours(createdAt, RELAY_SLA_HOURS),
    completedAt: null,
    note: null
  }));
}

function relayPhase(record) {
  const tasks = record.relay?.tasks || [];
  const open = tasks.filter((task) => task.status !== "EVIDENCE_RECEIVED");
  if (record.status === "EVIDENCE_RECEIVED" || open.length === 0) return "EXTENSION_REVIEW";
  if (open.some((task) => task.ownerRole === "FIELD_CAPTURE")) return "FIELD_CAPTURE";
  if (open.some((task) => task.ownerRole === "EXTENSION_REVIEW")) return "EXTENSION_REVIEW";
  return "DEALER_INTAKE";
}

function handoffMessage(record) {
  const relay = record.relay;
  const tasks = (relay?.tasks || []).filter((task) => task.status !== "EVIDENCE_RECEIVED");
  const requested = tasks.length ? tasks.map((task) => `• ${task.title}`).join("\n") : "• Evidence packet is ready for qualified review";
  return [
    `MittiGuard Evidence Relay · ${relay?.handoffCode || record.id}`,
    `Field: ${record.field} · ${record.crop} (${record.cropStage})`,
    `Sale state: ${record.saleState.replaceAll("_", " ")} — this is not product authorization.`,
    "",
    "Please add the following evidence to the case:",
    requested,
    "",
    `Why the case is held: ${record.reasons[0] || "Qualified review is required."}`
  ].join("\n");
}

function addAudit(data, record, { at, actor, event, detail, kind = "relay" }) {
  const auditEvent = {
    id: `A-${Date.now()}-${record.relay.audit.length + 1}`,
    at,
    actor,
    event,
    detail,
    kind
  };
  record.relay.audit.unshift(auditEvent);
  if (data) appendLedgerEntry(data, record, auditEvent);
  return auditEvent;
}

function ensureRelay(record, data = null) {
  if (!record.relay) {
    const createdAt = record.createdAt || new Date().toISOString();
    const alreadyReceived = record.status === "EVIDENCE_RECEIVED";
    const tasks = buildTasks(record, createdAt).map((task) => alreadyReceived ? {
      ...task,
      status: "EVIDENCE_RECEIVED",
      completedAt: record.updatedAt || createdAt,
      note: record.reviewNote || "Evidence packet was received for qualified review."
    } : task);
    record.relay = {
      phase: "DEALER_INTAKE",
      owner: alreadyReceived ? { role: "EXTENSION_REVIEW", name: "Extension desk" } : { role: "DEALER_DESK", name: "Counter desk" },
      slaDueAt: addHours(createdAt, RELAY_SLA_HOURS),
      handoffCode: `MG-${record.id.replace("C-", "")}-${record.field.replace(/[^A-Za-z0-9]/g, "").slice(0, 5).toUpperCase() || "FIELD"}`,
      tasks,
      audit: []
    };
    addAudit(data, record, {
      at: createdAt,
      actor: "Policy MG-1.0",
      event: record.saleState === "ON_HOLD" ? "Invoice block created" : "Qualified-review gate created",
      detail: record.safetyNote || "A qualified reviewer owns the next step.",
      kind: "policy"
    });
    if (record.assessment?.source && record.assessment.source !== "Deterministic demo engine") {
      addAudit(data, record, {
        at: createdAt,
        actor: record.assessment.source,
        event: "Evidence-only brief generated",
        detail: "The model summary cannot change the sale state.",
        kind: "model"
      });
    }
    if (alreadyReceived) {
      addAudit(data, record, {
        at: record.updatedAt || createdAt,
        actor: "Extension desk",
        event: "Evidence packet received",
        detail: `${record.reviewNote || "Evidence packet acknowledged."} Sale state remains ${record.saleState.replaceAll("_", " ")}.`,
        kind: "evidence"
      });
    }
  }
  record.relay.phase = relayPhase(record);
  record.relay.handoffMessage = handoffMessage(record);
  return record.relay;
}

function normalizeRecord(record) {
  ensureRelay(record);
  return record;
}

function findFieldCaptureCapability(data, rawToken) {
  const token = normalizeFieldCaptureToken(rawToken);
  if (!token) return null;
  const now = Date.now();
  for (const record of data.cases || []) {
    ensureRelay(record, data);
    for (const task of record.relay?.tasks || []) {
      const capability = task.fieldCaptureCapability;
      if (task.ownerRole !== "FIELD_CAPTURE" || task.status === "EVIDENCE_RECEIVED" || record.reviewAttestation) continue;
      if (captureCapabilityIsUsable(capability, token, now)) return { record, task, capability, token };
    }
  }
  return null;
}

function fieldCaptureLinkError() {
  return requestError("This Field Capture link is invalid, expired, or has already been used.", 404);
}

function reviewAttestationPreview(data, record) {
  ensureRelay(record, data);
  const issues = [];
  const incompleteTasks = (record.relay.tasks || []).filter((task) => task.status !== "EVIDENCE_RECEIVED");
  const invoiceId = String(record.externalInvoiceId || "").trim();
  const auditProof = verifyAuditLedger(data, { caseId: record.id });

  if (record.intakeChannel !== "POS_GATE_API" || !invoiceId) {
    issues.push("A reviewer attestation must be bound to a POS Gate invoice.");
  }
  if (incompleteTasks.length) {
    issues.push(`${incompleteTasks.length} evidence task${incompleteTasks.length === 1 ? " is" : "s are"} still open.`);
  }
  if (record.relay.owner?.role !== "EXTENSION_REVIEW" || !isNamedReviewer(record.relay.owner?.name)) {
    issues.push("A named extension reviewer must acknowledge ownership first.");
  }
  if (!["ON_HOLD", "REQUIRES_HUMAN_REVIEW"].includes(record.saleState)) {
    issues.push("Only a still-blocked or review-owned case can be attested.");
  }
  if (!auditProof.valid || !auditProof.sealed) {
    issues.push("A valid HMAC-sealed audit ledger is required before attestation.");
  }
  if ((auditProof.ledgerVersion || 0) < 2) {
    issues.push("Reset the demo ledger into the current sealed-audit format before attestation.");
  }

  return {
    eligible: issues.length === 0,
    issues,
    caseId: record.id,
    invoiceId: invoiceId || null,
    saleAuthorization: "NOT_RELEASED",
    saleState: record.saleState,
    reviewerName: record.relay.owner?.role === "EXTENSION_REVIEW" ? record.relay.owner?.name || null : null,
    evidence: {
      received: (record.relay.tasks || []).length - incompleteTasks.length,
      total: (record.relay.tasks || []).length,
      openTaskIds: incompleteTasks.map((task) => task.id)
    },
    evidenceDigest: invoiceId ? sha256(evidencePayload(record, invoiceId)) : null,
    auditAnchor: auditAnchorFromProof(auditProof),
    auditProof
  };
}

function requestError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export class MittiStore {
  constructor(path = storePath) {
    this.path = path;
    this.writeChain = Promise.resolve();
  }

  async read() {
    try {
      return JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async update(mutator) {
    // A rejected write must not poison the serial write queue. Callers still
    // receive the original error, while a later independently valid action can
    // proceed against the last durable ledger state.
    const write = this.writeChain.catch(() => undefined).then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      data.version = 3;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      return clone(result);
    });
    this.writeChain = write.catch(() => undefined);
    return write;
  }

  async listCases() {
    const data = await this.read();
    return clone(data.cases.map(normalizeRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async getCase(id) {
    const data = await this.read();
    const record = data.cases.find((item) => item.id === id);
    return record ? clone(normalizeRecord(record)) : null;
  }

  async getLedgerVerification(caseId = null) {
    return verifyAuditLedger(await this.read(), { caseId });
  }

  async getField(fieldId) {
    const data = await this.read();
    const field = data.fields.find((item) => item.id === fieldId);
    return field ? clone(field) : null;
  }

  async findRepeatRisk(caseData = {}) {
    const fieldId = normalized(caseData.fieldId);
    const crop = normalized(caseData.crop);
    const symptom = caseData.symptom || "";
    if (!fieldId || !crop || !symptomTokens(symptom).length) {
      return { detected: false, matches: [], summary: null };
    }

    const data = await this.read();
    const matches = [];
    for (const record of data.cases) {
      if (normalized(record.field) !== fieldId || normalized(record.crop) !== crop) continue;
      const shared = sharedSymptoms(symptom, record.symptom);
      // An observed improvement resolves this prior record for repeat-risk
      // matching. Everything else is described precisely: a not-improved or
      // uncertain outcome, a reported prior failure, or an existing open hold.
      const outcomeState = record.fieldOutcome?.state;
      const source = outcomeState === "NOT_IMPROVED"
        ? "prior_outcome"
        : outcomeState === "UNCERTAIN"
          ? "uncertain_outcome"
          : outcomeState === "IMPROVED"
            ? null
            : record.previousInputFailed
              ? "reported_failure"
              : record.saleState === "ON_HOLD"
                ? "open_case"
                : null;
      // A single generic word is not enough to create Evidence Debt. The
      // matcher needs two symptom signals on the same field and crop.
      if (source && shared.length >= 2) {
        const summaries = {
          prior_outcome: `A prior field outcome was not improved and has a similar symptom signal: ${shared.slice(0, 3).join(", ")}.`,
          uncertain_outcome: `A prior field outcome remains uncertain and has a similar symptom signal: ${shared.slice(0, 3).join(", ")}.`,
          reported_failure: `A reported prior input failure has a similar symptom signal: ${shared.slice(0, 3).join(", ")}.`,
          open_case: `A related case is still on hold with a similar symptom signal: ${shared.slice(0, 3).join(", ")}.`
        };
        matches.push({
          type: source,
          id: record.id,
          at: record.updatedAt || record.createdAt,
          signal: shared.slice(0, 3).join(", "),
          summary: summaries[source]
        });
      }
    }

    const field = data.fields.find((item) => normalized(item.id) === fieldId);
    for (const [index, event] of (field?.events || []).entries()) {
      const eventText = `${event.title} ${event.detail} ${event.outcome || ""}`;
      const outcomeIsUnresolved = ["not_improved", "uncertain"].includes(normalized(event.outcome))
        || /no outcome|not improve|unsuccessful|unresolved|repeat|uncertain/i.test(eventText);
      if (event.kind !== "input_outcome" || !outcomeIsUnresolved) continue;
      if (event.crop && normalized(event.crop) !== crop) continue;
      const shared = event.symptom ? sharedSymptoms(symptom, event.symptom) : [];
      if (shared.length < 2) continue;
      matches.push({
        type: "prior_outcome",
        id: event.id || `FIELD-EVENT-${index + 1}`,
        at: event.at,
        signal: shared.slice(0, 3).join(", "),
        summary: `A prior field outcome was not improved and shares the signal: ${shared.slice(0, 3).join(", ")}.`
      });
    }

    const uniqueMatches = matches.filter((match, index, all) => all.findIndex((item) => `${item.type}:${item.id}` === `${match.type}:${match.id}`) === index).slice(0, 3);
    const detected = uniqueMatches.length > 0;
    return {
      detected,
      matches: uniqueMatches,
      summary: detected
        ? `Field memory found ${uniqueMatches.length} matching unresolved ${uniqueMatches.length === 1 ? "record" : "records"} with a similar symptom signal (${uniqueMatches.map((match) => match.signal).join("; ")}).`
        : null
    };
  }

  async createCase({ caseData, gate, assessment }) {
    return this.update((data) => {
      const serial = String(data.cases.length + 1).padStart(4, "0");
      const createdAt = new Date().toISOString();
      const id = `C-${serial}`;
      const extensionId = `EXT-${serial}`;
      const record = {
        id,
        extensionId,
        status: "OPEN",
        createdAt,
        updatedAt: createdAt,
        farmer: caseData.farmerName || "Unnamed farmer",
        field: caseData.fieldId || "Unlinked field",
        crop: caseData.crop || "Unspecified crop",
        cropStage: caseData.cropStage || "Unspecified",
        farmerLanguage: caseData.farmerLanguage || "English",
        externalInvoiceId: caseData.externalInvoiceId ? String(caseData.externalInvoiceId).slice(0, 120) : null,
        intakeChannel: caseData.intakeChannel || "CASE_DESK",
        intakeTranscript: String(caseData.intakeTranscript || "").slice(0, 1000) || null,
        symptom: caseData.symptom || "No symptom provided",
        requestType: caseData.requestType || "pesticide",
        requestedProduct: caseData.requestedProduct || "No product specified",
        photoAttached: Boolean(caseData.photoProvided),
        weather: caseData.weather || null,
        soilReportDate: caseData.soilReportDate || null,
        lastInput: caseData.lastInput || null,
        previousInputFailed: Boolean(caseData.previousInputFailed),
        repeatRisk: caseData.repeatRisk || { detected: false, matches: [], summary: null },
        saleState: gate.saleState,
        decision: gate.decision,
        policyVersion: gate.policyVersion,
        reasons: gate.reasons,
        requiredEvidence: gate.requiredEvidence,
        safetyNote: gate.safetyNote,
        assessment: {
          observations: assessment.observations,
          conflicts: assessment.conflicts,
          questions: assessment.questions,
          farmerMessage: assessment.farmerMessage,
          imageEvidence: assessment.imageEvidence,
          source: assessment.source || "deterministic demo engine"
        },
        reviewNote: null
      };
      ensureRelay(record, data);
      addAudit(data, record, {
        at: createdAt,
        actor: "Evidence Relay",
        event: "Evidence tasks generated",
        detail: `${record.relay.tasks.length} task${record.relay.tasks.length === 1 ? "" : "s"} assigned; sale state remains ${record.saleState.replaceAll("_", " ")}.`,
        kind: "relay"
      });
      if (record.repeatRisk?.detected) {
        addAudit(data, record, {
          at: createdAt,
          actor: "Field Memory Matcher",
          event: "Evidence Debt matched",
          detail: `${record.repeatRisk.summary} Dealer input cannot bypass this match.`,
          kind: "policy"
        });
      }
      data.cases.push(record);

      if (record.field !== "Unlinked field") {
        let field = data.fields.find((item) => item.id === record.field);
        if (!field) {
          field = { id: record.field, farmerName: record.farmer, crop: record.crop, events: [] };
          data.fields.push(field);
        }
        field.events.unshift({
          at: createdAt,
          kind: "gate_result",
          title: record.decision === "PAUSED" ? "Input sale paused" : "Evidence package sent to review",
          detail: record.reasons[0] || "Qualified review required before any next step.",
          severity: record.decision === "PAUSED" ? "warning" : "neutral",
          caseId: record.id
        });
        if (record.repeatRisk?.detected) {
          field.events.unshift({
            at: createdAt,
            kind: "evidence_debt",
            title: "Automatic repeat-risk match",
            detail: record.repeatRisk.summary,
            severity: "warning",
            caseId: record.id
          });
        }
      }
      return record;
    });
  }

  async issueFieldCaptureLink(id, taskId, options = {}) {
    return this.update((data) => {
      const record = data.cases.find((item) => item.id === id);
      if (!record) throw requestError("Case not found.", 404);
      ensureRelay(record, data);
      if (record.reviewAttestation) throw requestError("Evidence tasks are frozen after a reviewer attestation.");
      const task = record.relay.tasks.find((item) => item.id === taskId);
      if (!task) throw requestError("Evidence task not found.", 404);
      if (task.ownerRole !== "FIELD_CAPTURE") {
        throw requestError("Only a Field Capture task can receive a mobile capture link.");
      }
      if (task.status === "EVIDENCE_RECEIVED") {
        throw requestError("This evidence task is already complete.", 409);
      }

      const issuedAt = new Date().toISOString();
      const minutes = fieldCaptureMinutes(options.ttlMinutes);
      const token = `${FIELD_CAPTURE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const capability = {
        version: 1,
        tokenHash: tokenHash(token),
        issuedAt,
        expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
        usedAt: null
      };
      // Reissuing a task capability intentionally invalidates the previous
      // token: there is only one active, single-task authority at a time.
      task.fieldCaptureCapability = capability;
      record.updatedAt = issuedAt;
      addAudit(data, record, {
        at: issuedAt,
        actor: "Counter desk",
        event: `Field Capture link issued: ${task.title}`,
        detail: `A ${minutes}-minute single-task capability was issued for ${task.id}. The raw capability and any future image bytes are not stored. Sale state remains ${record.saleState.replaceAll("_", " ")}.`,
        kind: "handoff"
      });
      record.relay.handoffMessage = handoffMessage(record);
      return {
        token,
        context: fieldCaptureContext(record, task, capability)
      };
    });
  }

  async getFieldCaptureContext(rawToken) {
    const data = await this.read();
    const match = findFieldCaptureCapability(data, rawToken);
    if (!match) return null;
    return clone(fieldCaptureContext(match.record, match.task, match.capability));
  }

  async recordFieldCaptureEvidence(rawToken, input = {}) {
    return this.update((data) => {
      const match = findFieldCaptureCapability(data, rawToken);
      if (!match) throw fieldCaptureLinkError();
      const { record, task, capability } = match;
      const observation = normalizeFieldCaptureObservation(input.observation);
      const image = normalizeFieldCaptureImage(input.imageMetadata);
      if (!observation && !image) {
        throw requestError("Add a neutral observation or one image before submitting Field Capture evidence.");
      }

      const now = new Date().toISOString();
      task.status = "EVIDENCE_RECEIVED";
      task.completedAt = now;
      task.note = observation || "Image evidence metadata received for reviewer verification.";
      task.fieldCapture = {
        version: 1,
        submittedAt: now,
        observation: observation || null,
        image: image ? { ...image } : null
      };
      capability.usedAt = now;
      // The capability is single-use. Keep only non-sensitive lifecycle
      // metadata after consumption; the persisted store never needs a token
      // verifier once this exact task has been completed.
      capability.tokenHash = null;
      record.photoAttached = Boolean(record.photoAttached || image);
      record.updatedAt = now;
      const remaining = record.relay.tasks.filter((item) => item.status !== "EVIDENCE_RECEIVED");
      record.status = remaining.length ? "CAPTURING_EVIDENCE" : "EVIDENCE_RECEIVED";
      record.relay.phase = relayPhase(record);
      const imageDetail = image
        ? ` Image metadata and SHA-256 digest were retained; raw image bytes were not stored.`
        : " No image was attached.";
      addAudit(data, record, {
        at: now,
        actor: "Field Capture link",
        event: `Mobile evidence received: ${task.title}`,
        detail: `${task.note}${imageDetail} Sale state remains ${record.saleState.replaceAll("_", " ")}.`,
        kind: "evidence"
      });
      record.relay.handoffMessage = handoffMessage(record);

      const field = data.fields.find((item) => item.id === record.field);
      if (field) {
        field.events.unshift({
          at: now,
          kind: "relay_evidence",
          title: `Mobile evidence received — ${task.title}`,
          detail: `${task.note}${imageDetail} Sale remains ${record.saleState.replaceAll("_", " ")}.`,
          severity: "neutral",
          caseId: record.id
        });
      }
      return record;
    });
  }

  async recordTaskEvidence(id, taskId, note) {
    return this.update((data) => {
      const record = data.cases.find((item) => item.id === id);
      if (!record) throw new Error("Case not found.");
      ensureRelay(record, data);
      if (record.reviewAttestation) throw new Error("Evidence tasks are frozen after a reviewer attestation.");
      const task = record.relay.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("Evidence task not found.");
      if (task.status === "EVIDENCE_RECEIVED") return record;

      const now = new Date().toISOString();
      task.status = "EVIDENCE_RECEIVED";
      task.completedAt = now;
      task.note = String(note || "Evidence received for reviewer verification.").slice(0, 500);
      record.updatedAt = now;
      const remaining = record.relay.tasks.filter((item) => item.status !== "EVIDENCE_RECEIVED");
      record.status = remaining.length ? "CAPTURING_EVIDENCE" : "EVIDENCE_RECEIVED";
      record.relay.phase = relayPhase(record);
      addAudit(data, record, {
        at: now,
        actor: roleLabel(task.ownerRole),
        event: `Evidence received: ${task.title}`,
        detail: `${task.note} Sale state remains ${record.saleState.replaceAll("_", " ")}.`,
        kind: "evidence"
      });
      record.relay.handoffMessage = handoffMessage(record);

      const field = data.fields.find((item) => item.id === record.field);
      if (field) {
        field.events.unshift({
          at: now,
          kind: "relay_evidence",
          title: `Evidence received — ${task.title}`,
          detail: `${task.note} Sale remains ${record.saleState.replaceAll("_", " ")}.`,
          severity: "neutral",
          caseId: record.id
        });
      }
      return record;
    });
  }

  async assignCase(id, owner) {
    return this.update((data) => {
      const record = data.cases.find((item) => item.id === id);
      if (!record) throw new Error("Case not found.");
      ensureRelay(record, data);
      if (record.reviewAttestation) throw new Error("Reviewer ownership is frozen after attestation.");
      const now = new Date().toISOString();
      const role = owner?.role === "EXTENSION_REVIEW" ? "EXTENSION_REVIEW" : record.relay.owner.role;
      const name = String(owner?.name || "Extension desk").trim().slice(0, 80);
      if (role === "EXTENSION_REVIEW" && !isNamedReviewer(name)) {
        throw requestError("Use a named extension reviewer; generic desk identities cannot attest a case.");
      }
      record.relay.owner = { role, name };
      record.updatedAt = now;
      addAudit(data, record, {
        at: now,
        actor: record.relay.owner.name,
        event: "Case ownership acknowledged",
        detail: `Owner set to ${roleLabel(role)}. Sale state remains ${record.saleState.replaceAll("_", " ")}.`,
        kind: "handoff"
      });
      return record;
    });
  }

  async recordReview(id, note) {
    return this.update((data) => {
      const record = data.cases.find((item) => item.id === id);
      if (!record) throw new Error("Case not found.");
      ensureRelay(record, data);
      if (record.reviewAttestation) throw new Error("A reviewer attestation is already recorded for this case.");
      if (record.relay.tasks.some((task) => task.status !== "EVIDENCE_RECEIVED")) {
        throw new Error("Complete every evidence task before recording a review packet.");
      }
      const now = new Date().toISOString();
      record.status = "EVIDENCE_RECEIVED";
      record.updatedAt = now;
      record.reviewNote = String(note || "Evidence received for qualified review.").slice(0, 500);
      record.relay.phase = "EXTENSION_REVIEW";
      if (record.relay.owner?.role !== "EXTENSION_REVIEW") {
        record.relay.owner = { role: "EXTENSION_REVIEW", name: "Extension desk" };
      }
      addAudit(data, record, {
        at: now,
        actor: "Extension desk",
        event: "Evidence packet received",
        detail: `${record.reviewNote} Sale state remains ${record.saleState.replaceAll("_", " ")}.`,
        kind: "evidence"
      });
      record.relay.handoffMessage = handoffMessage(record);
      const field = data.fields.find((item) => item.id === record.field);
      if (field) {
        field.events.unshift({
          at: now,
          kind: "review_update",
          title: "Extension evidence received",
          detail: `${record.reviewNote} Sale remains ${record.saleState.replaceAll("_", " ")}.`,
          severity: "neutral",
          caseId: record.id
        });
      }
      return record;
    });
  }

  async getReviewAttestationPreview(id) {
    const data = await this.read();
    const record = data.cases.find((item) => item.id === id);
    if (!record) return null;
    return clone(reviewAttestationPreview(data, record));
  }

  async attestReview(id, input = {}) {
    return this.update((data) => {
      const record = data.cases.find((item) => item.id === id);
      if (!record) throw new Error("Case not found.");
      ensureRelay(record, data);
      if (record.reviewAttestation) throw new Error("A reviewer attestation is already recorded for this case.");
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw requestError("Reviewer attestation must be a JSON object.");
      }
      if (Object.hasOwn(input, "saleState") || Object.hasOwn(input, "saleAuthorization") || Object.hasOwn(input, "authorization")) {
        throw requestError("A client cannot supply a sale state or authorization to an attestation.");
      }
      const preview = reviewAttestationPreview(data, record);
      if (!preview.eligible) throw requestError(preview.issues[0]);
      if (input.expectedEvidenceDigest !== preview.evidenceDigest || input.expectedAuditHeadHash !== preview.auditAnchor.headHash) {
        throw requestError("The evidence packet or audit chain changed. Reload the reviewer preview before attesting.", 409);
      }

      const reviewerName = String(input.reviewerName || "").trim().slice(0, 80);
      if (!isNamedReviewer(reviewerName)) throw requestError("A named reviewer is required for attestation.");
      if (reviewerName !== record.relay.owner.name) {
        throw requestError("The attesting reviewer must match the assigned extension-review owner.");
      }
      if (input.confirmed !== true) throw new Error("The reviewer must confirm that the listed evidence was reviewed.");
      const disposition = String(input.disposition || "").trim();
      if (!REVIEW_ATTESTATION_DISPOSITIONS.has(disposition)) {
        throw requestError("Attestation disposition must be MANUAL_POS_DECISION_REQUIRED or ESCALATE.");
      }

      const now = new Date().toISOString();
      const invoiceId = preview.invoiceId;
      const attestation = {
        version: 1,
        id: `MGA-${record.id.replace("C-", "")}-${String(Date.now()).slice(-8)}`,
        status: "ATTESTED",
        caseId: record.id,
        invoiceId,
        reviewerName,
        disposition,
        note: String(input.note || "Evidence packet reviewed; MittiGuard does not authorize the invoice.").slice(0, 500),
        reviewedAt: now,
        saleAuthorization: "NOT_RELEASED",
        saleState: record.saleState,
        policyVersion: record.policyVersion,
        evidenceDigest: preview.evidenceDigest,
        auditAnchor: preview.auditAnchor,
        confirmed: true
      };
      attestation.bindingDigest = sha256(attestationPayload(attestation));
      record.reviewAttestation = attestation;
      record.status = "REVIEW_ATTESTED";
      record.updatedAt = now;
      record.reviewNote = attestation.note;
      record.relay.owner = { role: "EXTENSION_REVIEW", name: reviewerName };
      record.relay.phase = "EXTENSION_REVIEW";

      const auditEvent = addAudit(data, record, {
        at: now,
        actor: reviewerName,
        event: "Human review attested",
        detail: attestationAuditDetail(attestation),
        kind: "review"
      });
      attestation.auditEventId = auditEvent.id;
      attestation.ledgerSequence = auditEvent.ledgerSequence;
      attestation.auditHash = auditEvent.hash;
      attestation.ledgerEntryId = `L-${String(auditEvent.ledgerSequence).padStart(8, "0")}`;
      if (!reviewAttestationVerification(record, data).valid) {
        throw new Error("Reviewer attestation could not be sealed into the audit ledger.");
      }
      record.relay.handoffMessage = handoffMessage(record);

      const field = data.fields.find((item) => item.id === record.field);
      if (field) {
        field.events.unshift({
          at: now,
          kind: "review_attestation",
          title: `Human review attested — ${reviewDispositionLabel(disposition)}`,
          detail: `Reviewer ${reviewerName} attested the evidence packet. MittiGuard did not release invoice ${invoiceId}.`,
          severity: disposition === "ESCALATE" ? "warning" : "neutral",
          caseId: record.id
        });
      }
      return record;
    });
  }

  async getReviewAttestationVerification(id) {
    const data = await this.read();
    const record = data.cases.find((item) => item.id === id);
    if (!record) return null;
    ensureRelay(record);
    return {
      ...reviewAttestationVerification(record, data),
      auditProof: verifyAuditLedger(data, { caseId: id })
    };
  }

  async recordFieldOutcome(id, outcome = {}) {
    return this.update((data) => {
      const record = data.cases.find((item) => item.id === id);
      if (!record) throw new Error("Case not found.");
      ensureRelay(record, data);
      if (record.relay.phase !== "EXTENSION_REVIEW") {
        throw new Error("Field outcomes can only be recorded after the evidence packet reaches extension review.");
      }
      if (!record.reviewAttestation || !reviewAttestationVerification(record, data).valid) {
        throw new Error("A valid human review attestation is required before recording an observed field outcome.");
      }
      const state = OUTCOME_STATES.has(outcome.state) ? outcome.state : "UNCERTAIN";
      const note = String(outcome.note || "No additional field observation recorded.").slice(0, 500);
      const now = new Date().toISOString();
      const labels = {
        NOT_IMPROVED: "Observed outcome — not improved",
        IMPROVED: "Observed outcome — improvement recorded",
        UNCERTAIN: "Observed outcome — still uncertain"
      };
      const details = {
        NOT_IMPROVED: "The observed issue did not improve. Future similar sales should trigger Evidence Debt.",
        IMPROVED: "An observed improvement was recorded. This does not authorize any future sale.",
        UNCERTAIN: "The field outcome remains uncertain. Future cases still require policy review."
      };
      record.fieldOutcome = { state, note, recordedAt: now };
      record.updatedAt = now;
      addAudit(data, record, {
        at: now,
        actor: record.reviewAttestation.reviewerName,
        event: labels[state],
        detail: `${details[state]} ${note}`,
        kind: "memory"
      });
      const field = data.fields.find((item) => item.id === record.field);
      if (field) {
        field.events.unshift({
          at: now,
          kind: "input_outcome",
          title: labels[state],
          detail: `${details[state]} ${note}`,
          crop: record.crop,
          symptom: record.symptom,
          outcome: state.toLowerCase(),
          severity: state === "NOT_IMPROVED" ? "warning" : "neutral",
          caseId: record.id
        });
      }
      return record;
    });
  }

  async resetDemoLedger() {
    const write = this.writeChain.catch(() => undefined).then(async () => {
      const baseline = JSON.parse(await readFile(demoStorePath, "utf8"));
      baseline.version = 3;
      resetAuditLedger(baseline);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      return clone(baseline);
    });
    this.writeChain = write.catch(() => undefined);
    return write;
  }
}

export const store = new MittiStore();
