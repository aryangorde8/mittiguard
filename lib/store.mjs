import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const storePath = join(moduleDir, "../data/store.json");
const demoStorePath = join(moduleDir, "../data/demo-store.json");
const RELAY_SLA_HOURS = 24;

const emptyStore = () => ({ version: 2, cases: [], fields: [] });
const SYMPTOM_STOP_WORDS = new Set(["after", "before", "field", "from", "input", "issue", "leaf", "leaves", "lower", "plant", "plants", "previous", "prior", "reported", "this", "that", "with"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalized(value = "") {
  return String(value).trim().toLowerCase();
}

function symptomTokens(value = "") {
  return [...new Set(normalized(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 4 && !SYMPTOM_STOP_WORDS.has(token)))];
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

function addAudit(record, { at, actor, event, detail, kind = "relay" }) {
  record.relay.audit.unshift({
    id: `A-${Date.now()}-${record.relay.audit.length + 1}`,
    at,
    actor,
    event,
    detail,
    kind
  });
}

function ensureRelay(record) {
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
    addAudit(record, {
      at: createdAt,
      actor: "Policy MG-1.0",
      event: record.saleState === "ON_HOLD" ? "Invoice block created" : "Qualified-review gate created",
      detail: record.safetyNote || "A qualified reviewer owns the next step.",
      kind: "policy"
    });
    if (record.assessment?.source && record.assessment.source !== "Deterministic demo engine") {
      addAudit(record, {
        at: createdAt,
        actor: record.assessment.source,
        event: "Evidence-only brief generated",
        detail: "The model summary cannot change the sale state.",
        kind: "model"
      });
    }
    if (alreadyReceived) {
      addAudit(record, {
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
    this.writeChain = this.writeChain.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      data.version = 2;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      return clone(result);
    });
    return this.writeChain;
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
      const unresolved = record.saleState === "ON_HOLD" || record.previousInputFailed;
      if (unresolved && shared.length) {
        matches.push({
          type: "prior_case",
          id: record.id,
          at: record.updatedAt || record.createdAt,
          signal: shared.slice(0, 3).join(", "),
          summary: `Unresolved case ${record.id} has a similar symptom signal: ${shared.slice(0, 3).join(", ")}.`
        });
      }
    }

    const field = data.fields.find((item) => normalized(item.id) === fieldId);
    for (const [index, event] of (field?.events || []).entries()) {
      if (event.kind !== "input_outcome" || !/no outcome|not improve|unsuccessful|unresolved|repeat/i.test(`${event.title} ${event.detail} ${event.outcome || ""}`)) continue;
      if (event.crop && normalized(event.crop) !== crop) continue;
      const shared = event.symptom ? sharedSymptoms(symptom, event.symptom) : [];
      if (!shared.length) continue;
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
        ? `Field memory found ${uniqueMatches.length} unresolved ${uniqueMatches.length === 1 ? "record" : "records"} with a similar symptom signal (${uniqueMatches.map((match) => match.signal).join("; ")}).`
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
        intakeTranscript: String(caseData.intakeTranscript || "").slice(0, 1000) || null,
        symptom: caseData.symptom || "No symptom provided",
        requestType: caseData.requestType || "pesticide",
        requestedProduct: caseData.requestedProduct || "No product specified",
        photoAttached: Boolean(caseData.photoProvided),
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
      ensureRelay(record);
      addAudit(record, {
        at: createdAt,
        actor: "Evidence Relay",
        event: "Evidence tasks generated",
        detail: `${record.relay.tasks.length} task${record.relay.tasks.length === 1 ? "" : "s"} assigned; sale state remains ${record.saleState.replaceAll("_", " ")}.`,
        kind: "relay"
      });
      if (record.repeatRisk?.detected) {
        addAudit(record, {
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

  async recordTaskEvidence(id, taskId, note) {
    return this.update((data) => {
      const record = data.cases.find((item) => item.id === id);
      if (!record) throw new Error("Case not found.");
      ensureRelay(record);
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
      if (record.relay.phase === "EXTENSION_REVIEW") record.relay.owner = { role: "EXTENSION_REVIEW", name: "Extension desk" };
      addAudit(record, {
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
      ensureRelay(record);
      const now = new Date().toISOString();
      const role = owner?.role === "EXTENSION_REVIEW" ? "EXTENSION_REVIEW" : record.relay.owner.role;
      record.relay.owner = { role, name: String(owner?.name || "Extension desk").slice(0, 80) };
      record.updatedAt = now;
      addAudit(record, {
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
      ensureRelay(record);
      const now = new Date().toISOString();
      record.status = "EVIDENCE_RECEIVED";
      record.updatedAt = now;
      record.reviewNote = String(note || "Evidence received for qualified review.").slice(0, 500);
      record.relay.tasks.forEach((task) => {
        if (task.status !== "EVIDENCE_RECEIVED") {
          task.status = "EVIDENCE_RECEIVED";
          task.completedAt = now;
          task.note = record.reviewNote;
        }
      });
      record.relay.phase = "EXTENSION_REVIEW";
      record.relay.owner = { role: "EXTENSION_REVIEW", name: "Extension desk" };
      addAudit(record, {
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

  async resetDemoLedger() {
    this.writeChain = this.writeChain.then(async () => {
      const baseline = JSON.parse(await readFile(demoStorePath, "utf8"));
      baseline.version = 2;
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
      return clone(baseline);
    });
    return this.writeChain;
  }
}

export const store = new MittiStore();
