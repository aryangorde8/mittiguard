import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const storePath = join(moduleDir, "../data/store.json");

const emptyStore = () => ({ version: 1, cases: [], fields: [] });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
    return clone([...data.cases].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  async getField(fieldId) {
    const data = await this.read();
    const field = data.fields.find((item) => item.id === fieldId);
    return field ? clone(field) : null;
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
        symptom: caseData.symptom || "No symptom provided",
        requestType: caseData.requestType || "pesticide",
        requestedProduct: caseData.requestedProduct || "No product specified",
        photoAttached: Boolean(caseData.photoProvided),
        soilReportDate: caseData.soilReportDate || null,
        lastInput: caseData.lastInput || null,
        previousInputFailed: Boolean(caseData.previousInputFailed),
        saleState: gate.saleState,
        decision: gate.decision,
        policyVersion: gate.policyVersion,
        reasons: gate.reasons,
        requiredEvidence: gate.requiredEvidence,
        assessment: {
          observations: assessment.observations,
          conflicts: assessment.conflicts,
          questions: assessment.questions,
          source: assessment.source || "deterministic demo engine"
        },
        reviewNote: null
      };
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
      }
      return record;
    });
  }

  async recordReview(id, note) {
    return this.update((data) => {
      const record = data.cases.find((item) => item.id === id);
      if (!record) throw new Error("Case not found.");
      record.status = "EVIDENCE_RECEIVED";
      record.updatedAt = new Date().toISOString();
      record.reviewNote = String(note || "Evidence received for qualified review.").slice(0, 500);
      const field = data.fields.find((item) => item.id === record.field);
      if (field) {
        field.events.unshift({
          at: record.updatedAt,
          kind: "review_update",
          title: "Extension evidence received",
          detail: record.reviewNote,
          severity: "neutral",
          caseId: record.id
        });
      }
      return record;
    });
  }
}

export const store = new MittiStore();
