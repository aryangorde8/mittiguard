import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGate } from "./lib/policy.mjs";
import { store } from "./lib/store.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 3000);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};
const TRANSIENT_NETWORK_CODES = new Set(["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "ENETUNREACH", "EAI_AGAIN"]);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LIVE_MODEL_WINDOW_MS = positiveInteger(process.env.MODEL_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000);
const LIVE_MODEL_PER_IP_LIMIT = positiveInteger(process.env.MODEL_RATE_LIMIT_PER_IP, 8);
const LIVE_MODEL_GLOBAL_LIMIT = positiveInteger(process.env.MODEL_RATE_LIMIT_GLOBAL, 40);

export function createSlidingWindowRateLimiter({ limit, windowMs, now = () => Date.now(), maxKeys = 512 }) {
  const buckets = new Map();

  function removeExpired(timestamp) {
    const earliestAllowed = timestamp - windowMs;
    for (const [key, hits] of buckets) {
      const current = hits.filter((hit) => hit > earliestAllowed);
      if (current.length) buckets.set(key, current);
      else buckets.delete(key);
    }
  }

  return {
    take(key) {
      const timestamp = now();
      removeExpired(timestamp);
      const hits = buckets.get(key) || [];
      if (hits.length >= limit) {
        const retryAfterMs = Math.max(0, hits[0] + windowMs - timestamp);
        return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
      }
      if (!buckets.has(key) && buckets.size >= maxKeys) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey) buckets.delete(oldestKey);
      }
      hits.push(timestamp);
      buckets.set(key, hits);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  };
}

const liveModelPerClientLimiter = createSlidingWindowRateLimiter({
  limit: LIVE_MODEL_PER_IP_LIMIT,
  windowMs: LIVE_MODEL_WINDOW_MS
});
const liveModelGlobalLimiter = createSlidingWindowRateLimiter({
  limit: LIVE_MODEL_GLOBAL_LIMIT,
  windowMs: LIVE_MODEL_WINDOW_MS,
  maxKeys: 1
});

function send(res, status, payload, headers = {}) {
  res.writeHead(status, headers);
  res.end(payload);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), { "Content-Type": "application/json; charset=utf-8" });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_500_000) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function isTransientNetworkError(error) {
  const code = error?.cause?.code || error?.code;
  return TRANSIENT_NETWORK_CODES.has(code);
}

function clientAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim().slice(0, 160);
  return String(req.socket.remoteAddress || "unknown").slice(0, 160);
}

function liveModelAccess(req) {
  if (!providerConfiguration().enabled) return { allowed: true, mode: null };
  const byClient = liveModelPerClientLimiter.take(clientAddress(req));
  if (!byClient.allowed) return { allowed: false, mode: "per-client", retryAfterSeconds: byClient.retryAfterSeconds };
  const globally = liveModelGlobalLimiter.take("all");
  if (!globally.allowed) return { allowed: false, mode: "service", retryAfterSeconds: globally.retryAfterSeconds };
  return { allowed: true, mode: null };
}

async function fetchModelWithRetry(url, options, providerLabel) {
  const attempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 600));
    }
  }

  const code = lastError?.cause?.code || lastError?.code || "network_error";
  throw new Error(`${providerLabel} could not be reached after ${attempts} attempts (${code}). Check the network, VPN, or firewall and retry.`, { cause: lastError });
}

function sanitizeAssessment(assessment = {}, source) {
  const image = assessment.imageEvidence || {};
  const imageStatus = ["usable", "limited", "not_assessed", "not_provided"].includes(image.status)
    ? image.status
    : "not_assessed";
  return {
    observations: Array.isArray(assessment.observations) ? assessment.observations.slice(0, 4) : [],
    conflicts: Array.isArray(assessment.conflicts) ? assessment.conflicts.slice(0, 4) : [],
    questions: Array.isArray(assessment.questions) ? assessment.questions.slice(0, 4) : [],
    farmerMessage: typeof assessment.farmerMessage === "string" ? assessment.farmerMessage.slice(0, 420) : "",
    imageEvidence: {
      status: imageStatus,
      reason: typeof image.reason === "string" ? image.reason.slice(0, 220) : "No diagnostic conclusion is drawn from the image."
    },
    source
  };
}

const DOSAGE_PATTERN = /\b\d+(?:\.\d+)?\s?(?:ml|millilit(?:er|re)s?|g|grams?|kg|kilograms?|l|lit(?:er|re)s?)\b/i;
const ACTION_ADVICE_PATTERN = /\b(?:you|farmer|grower)\s+(?:should|must|need to|can)\s+(?:apply|spray|mix|use|treat|drench|dose)\b|\b(?:apply|spray|mix|drench)\s+(?:\d|an?\s)/i;
const GENERIC_PRODUCT_TERMS = new Set(["a", "an", "and", "chemical", "context", "fertiliser", "fertilizer", "input", "intentionally", "model", "named", "pesticide", "product", "requested", "the", "this", "withheld"]);

function assessmentText(assessment) {
  return [
    ...(Array.isArray(assessment.observations) ? assessment.observations : []),
    ...(Array.isArray(assessment.conflicts) ? assessment.conflicts : []),
    ...(Array.isArray(assessment.questions) ? assessment.questions : []),
    assessment.farmerMessage || "",
    assessment.imageEvidence?.reason || ""
  ].join(" ");
}

function requestedProductTerms(caseData = {}) {
  return String(caseData.requestedProduct || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 5 && !GENERIC_PRODUCT_TERMS.has(term));
}

function repeatsRequestedProduct(text, caseData = {}) {
  const normalizedText = String(text || "").toLowerCase();
  return requestedProductTerms(caseData).some((term) => normalizedText.includes(term));
}

export function enforceEvidenceOnlyAssessment(assessment, source, caseData = {}) {
  const text = assessmentText(assessment);
  if (DOSAGE_PATTERN.test(text) || ACTION_ADVICE_PATTERN.test(text)) {
    throw new Error("Model response violated MittiGuard's evidence-only contract.");
  }

  if (repeatsRequestedProduct(text, caseData)) {
    throw new Error("Model response repeated a requested product.");
  }

  return sanitizeAssessment(assessment, source);
}

const ALLOWED_CROP_STAGES = new Set(["Vegetative", "Flowering", "Fruiting", "Harvest"]);
const ALLOWED_EVIDENCE_GAPS = new Set(["field identity", "crop stage", "field image", "soil health card", "last input history", "previous outcome"]);

export function enforceEvidenceIntakeDraft(draft, source, caseData = {}) {
  const text = JSON.stringify(draft || {});
  if (DOSAGE_PATTERN.test(text) || ACTION_ADVICE_PATTERN.test(text)) {
    throw new Error("Model intake draft violated MittiGuard's evidence-only contract.");
  }
  if (repeatsRequestedProduct(text, caseData)) {
    throw new Error("Model intake draft repeated a requested product.");
  }
  const cropStage = ALLOWED_CROP_STAGES.has(draft?.cropStage) ? draft.cropStage : null;
  const evidenceGaps = Array.isArray(draft?.evidenceGaps)
    ? [...new Set(draft.evidenceGaps.filter((gap) => ALLOWED_EVIDENCE_GAPS.has(String(gap).toLowerCase())).map((gap) => String(gap).toLowerCase()))].slice(0, 6)
    : [];
  return {
    crop: typeof draft?.crop === "string" ? draft.crop.slice(0, 80) : null,
    cropStage,
    symptom: typeof draft?.symptom === "string" ? draft.symptom.slice(0, 240) : null,
    lastInputContext: typeof draft?.lastInputContext === "string" ? draft.lastInputContext.slice(0, 160) : null,
    evidenceGaps,
    reviewerNote: typeof draft?.reviewerNote === "string" ? draft.reviewerNote.slice(0, 260) : "Review the extracted evidence against the original field narrative.",
    source
  };
}

function configuredProvider() {
  const requested = (process.env.MODEL_PROVIDER || "").trim().toLowerCase();
  if (requested === "nova" || requested === "openai") return requested;
  return process.env.AWS_BEARER_TOKEN_BEDROCK ? "nova" : "openai";
}

function providerConfiguration() {
  const provider = configuredProvider();
  if (provider === "nova") {
    return {
      provider,
      enabled: Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK),
      label: "Amazon Nova Pro",
      model: process.env.NOVA_MODEL_ID || "amazon.nova-pro-v1:0"
    };
  }
  return {
    provider,
    enabled: Boolean(process.env.OPENAI_API_KEY),
    label: "GPT-5.6",
    model: process.env.OPENAI_MODEL || "gpt-5.6"
  };
}

function caseSummary(caseData, gate) {
  return JSON.stringify({
    crop: caseData.crop,
    cropStage: caseData.cropStage,
    farmerLanguage: caseData.farmerLanguage || "English",
    intakeTranscript: caseData.intakeTranscript || null,
    symptom: caseData.symptom,
    requestType: caseData.requestType,
    lastInput: caseData.lastInput,
    previousInputFailed: caseData.previousInputFailed,
    soilReportDate: caseData.soilReportDate,
    weather: caseData.weather,
    repeatRisk: caseData.repeatRisk,
    actualImageAttachedForModel: Boolean(parseImageDataUrl(caseData.photoDataUrl)),
    gate: { decision: gate.decision, reasons: gate.reasons, requiredEvidence: gate.requiredEvidence }
  });
}

function parseImageDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=]+)$/i);
  if (!match) return null;
  return { format: match[1].toLowerCase().replace("jpg", "jpeg"), bytes: match[2] };
}

function parseModelJson(text) {
  if (typeof text !== "string") throw new Error("Model did not return text.");
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Model response did not contain a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function demoAssessment(caseData, gate) {
  const observations = [
    caseData.symptom ? `Reported symptom: ${caseData.symptom}.` : "No symptom description was supplied.",
    caseData.crop ? `Crop context: ${caseData.crop}${caseData.cropStage ? `, ${caseData.cropStage}` : ""}.` : "Crop context is incomplete."
  ];
  const conflicts = gate.reasons.filter((reason) => /Yellowing|unsuccessful|soil report|Automatic Field Memory/i.test(reason));
  return {
    observations,
    conflicts,
    questions: gate.requiredEvidence,
    farmerMessage: gate.decision === "PAUSED"
      ? "Your field needs a little more evidence before another input is sold. We have opened a review case instead of guessing."
      : "The evidence package is complete enough for a qualified reviewer. MittiGuard will not recommend a product or dose.",
    imageEvidence: {
      status: caseData.photoDataUrl ? "not_assessed" : "not_provided",
      reason: caseData.photoDataUrl
        ? "An image was attached for evidence context; no diagnostic conclusion is generated."
        : "No actual image bytes were supplied to the live evidence path."
    },
    source: "Deterministic demo engine"
  };
}

function demoIntakeDraft(caseData = {}) {
  const gaps = [];
  if (!caseData.fieldId) gaps.push("field identity");
  if (!caseData.cropStage) gaps.push("crop stage");
  if (!caseData.photoProvided) gaps.push("field image");
  if (!caseData.soilReportDate) gaps.push("soil health card");
  if (!caseData.lastInput) gaps.push("last input history");
  return enforceEvidenceIntakeDraft({
    crop: caseData.crop || null,
    cropStage: caseData.cropStage || null,
    symptom: caseData.symptom || caseData.intakeTranscript || null,
    lastInputContext: caseData.lastInput ? "A prior input and date were recorded; reviewer verification is still required." : null,
    evidenceGaps: gaps,
    reviewerNote: "Draft generated locally from the reviewed fields. Confirm each value before opening the Evidence Relay."
  }, "Deterministic intake fallback", caseData);
}

function intakeDraftInstruction(caseData) {
  return `Extract only evidence explicitly present in this field-intake record: ${JSON.stringify({
    farmerLanguage: caseData.farmerLanguage || "English",
    fieldId: caseData.fieldId || null,
    crop: caseData.crop || null,
    cropStage: caseData.cropStage || null,
    symptom: caseData.symptom || null,
    intakeTranscript: caseData.intakeTranscript || null,
    lastInput: caseData.lastInput || null,
    soilReportDate: caseData.soilReportDate || null,
    imageAttached: Boolean(parseImageDataUrl(caseData.photoDataUrl))
  })}. Return exactly one JSON object with keys crop, cropStage, symptom, lastInputContext, evidenceGaps, reviewerNote. cropStage must be one of Vegetative, Flowering, Fruiting, Harvest, or null. evidenceGaps may only contain: field identity, crop stage, field image, soil health card, last input history, previous outcome. Do not diagnose. Do not name, recommend, dose, or give application advice for any pesticide, fertiliser, or product. Treat the output as an editable evidence draft, never a decision.`;
}

async function getGptIntakeDraft(caseData) {
  if (!process.env.OPENAI_API_KEY) return null;
  const content = [{ type: "input_text", text: intakeDraftInstruction(caseData) }];
  if (typeof caseData.photoDataUrl === "string" && caseData.photoDataUrl.startsWith("data:image/")) {
    content.push({ type: "input_image", image_url: caseData.photoDataUrl });
  }
  const response = await fetchModelWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6",
      instructions: "You extract neutral farm evidence into an editable draft. You never diagnose or provide input advice.",
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "evidence_intake_draft", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: {
          crop: { type: ["string", "null"] },
          cropStage: { type: ["string", "null"], enum: ["Vegetative", "Flowering", "Fruiting", "Harvest", null] },
          symptom: { type: ["string", "null"] },
          lastInputContext: { type: ["string", "null"] },
          evidenceGaps: { type: "array", items: { type: "string" } },
          reviewerNote: { type: "string" }
        },
        required: ["crop", "cropStage", "symptom", "lastInputContext", "evidenceGaps", "reviewerNote"]
      } } }
    })
  }, "OpenAI");
  if (!response.ok) throw new Error(`OpenAI intake request failed with ${response.status}.`);
  const payload = await response.json();
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((part) => part.type === "output_text")?.text;
  return enforceEvidenceIntakeDraft(parseModelJson(text), "GPT-5.6", caseData);
}

async function getNovaIntakeDraft(caseData) {
  if (!process.env.AWS_BEARER_TOKEN_BEDROCK) return null;
  const region = process.env.AWS_REGION || "us-east-1";
  const model = process.env.NOVA_MODEL_ID || "amazon.nova-pro-v1:0";
  const content = [{ text: intakeDraftInstruction(caseData) }];
  const image = parseImageDataUrl(caseData.photoDataUrl);
  if (image) content.push({ image: { format: image.format, source: { bytes: image.bytes } } });
  const response = await fetchModelWithRetry(
    `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        system: [{ text: "You are MittiGuard's evidence intake assistant. Return neutral, editable evidence drafts only. You never diagnose crops or give input advice." }],
        messages: [{ role: "user", content }],
        inferenceConfig: { maxTokens: 420, temperature: 0 }
      })
    },
    "Amazon Bedrock"
  );
  if (!response.ok) throw new Error(`Bedrock intake request failed with ${response.status}.`);
  const payload = await response.json();
  const text = payload.output?.message?.content?.find((part) => typeof part.text === "string")?.text;
  return enforceEvidenceIntakeDraft(parseModelJson(text), "Amazon Nova Pro", caseData);
}

async function getLiveIntakeDraft(caseData) {
  return configuredProvider() === "nova" ? getNovaIntakeDraft(caseData) : getGptIntakeDraft(caseData);
}

export async function getGptAssessment(caseData, gate) {
  if (!process.env.OPENAI_API_KEY) return null;

  const content = [{
    type: "input_text",
    text: `Field case and fixed gate result:\n${caseSummary(caseData, gate)}`
  }];

  // The image is optional because the bundled demo uses simulated evidence. In a
  // live case, a real field photo is sent with the textual evidence package.
  if (typeof caseData.photoDataUrl === "string" && caseData.photoDataUrl.startsWith("data:image/")) {
    content.push({ type: "input_image", image_url: caseData.photoDataUrl });
  }

  const response = await fetchModelWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6",
      instructions: "You are MittiGuard's evidence analyst. Do not diagnose a crop disease. Do not recommend a pesticide, fertiliser, dosage, product, or timing. Summarize only observed context, evidence conflicts, and neutral evidence questions. The deterministic policy already chose the case state; you cannot alter it.",
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "evidence_summary",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              observations: { type: "array", items: { type: "string" } },
              conflicts: { type: "array", items: { type: "string" } },
              questions: { type: "array", items: { type: "string" } },
              farmerMessage: { type: "string" },
              imageEvidence: {
                type: "object",
                additionalProperties: false,
                properties: {
                  status: { type: "string", enum: ["usable", "limited", "not_assessed", "not_provided"] },
                  reason: { type: "string" }
                },
                required: ["status", "reason"]
              }
            },
            required: ["observations", "conflicts", "questions", "farmerMessage", "imageEvidence"]
          }
        }
      }
    })
  }, "OpenAI");

  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    const problem = await response.json().catch(() => null);
    const message = problem?.error?.message || "No API error message was returned.";
    const code = problem?.error?.code || problem?.error?.type || "unknown_error";
    throw new Error(`OpenAI request failed with ${response.status} (${code}): ${message}${requestId ? ` [request: ${requestId}]` : ""}`);
  }

  const payload = await response.json();
  const text = payload.output_text || payload.output
    ?.flatMap((item) => item.content || [])
    .find((part) => part.type === "output_text")?.text;
  return enforceEvidenceOnlyAssessment(JSON.parse(text), "GPT-5.6", caseData);
}

export async function getNovaAssessment(caseData, gate) {
  if (!process.env.AWS_BEARER_TOKEN_BEDROCK) return null;

  const region = process.env.AWS_REGION || "us-east-1";
  const model = process.env.NOVA_MODEL_ID || "amazon.nova-pro-v1:0";
  const content = [{
    text: `Field case and fixed gate result:\n${caseSummary(caseData, gate)}\n\nReturn exactly one valid JSON object with this shape: {"observations":["..."],"conflicts":["..."],"questions":["..."],"farmerMessage":"...","imageEvidence":{"status":"usable|limited|not_assessed|not_provided","reason":"..."}}. If actualImageAttachedForModel is false, imageEvidence.status must be not_assessed or not_provided. No Markdown. Do not diagnose a crop disease. Do not recommend or name a pesticide, fertiliser, product, dosage, timing, or treatment. The fixed gate state cannot be changed.`
  }];
  const image = parseImageDataUrl(caseData.photoDataUrl);
  if (image) content.push({ image: { format: image.format, source: { bytes: image.bytes } } });

  const response = await fetchModelWithRetry(
    `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        system: [{ text: "You are MittiGuard's evidence analyst. Summarize only supplied context, conflicts, and neutral evidence questions. The deterministic policy owns the sale state." }],
        messages: [{ role: "user", content }],
        inferenceConfig: { maxTokens: 550, temperature: 0 }
      })
    },
    "Amazon Bedrock"
  );

  if (!response.ok) {
    const requestId = response.headers.get("x-amzn-requestid");
    const problem = await response.json().catch(() => null);
    const message = problem?.message || problem?.Message || "No Bedrock error message was returned.";
    const code = problem?.code || problem?.Code || "unknown_error";
    throw new Error(`Bedrock request failed with ${response.status} (${code}): ${message}${requestId ? ` [request: ${requestId}]` : ""}`);
  }

  const payload = await response.json();
  const text = payload.output?.message?.content?.find((part) => typeof part.text === "string")?.text;
  return enforceEvidenceOnlyAssessment(parseModelJson(text), "Amazon Nova Pro", caseData);
}

export async function getLiveAssessment(caseData, gate) {
  const provider = configuredProvider();
  return provider === "nova" ? getNovaAssessment(caseData, gate) : getGptAssessment(caseData, gate);
}

async function weatherSnapshot(lat = 16.3067, lon = 80.4365) {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("current", "temperature_2m,precipitation");
    url.searchParams.set("daily", "precipitation_sum,temperature_2m_max");
    url.searchParams.set("forecast_days", "2");
    url.searchParams.set("timezone", "auto");
    const result = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    if (!result.ok) throw new Error("Weather provider unavailable");
    const data = await result.json();
    return {
      source: "Open-Meteo",
      live: true,
      temperature: data.current?.temperature_2m,
      precipitation: data.current?.precipitation,
      tomorrowRain: data.daily?.precipitation_sum?.[1],
      timezone: data.timezone
    };
  } catch {
    return { source: "Open-Meteo", live: false, temperature: null, precipitation: null, tomorrowRain: null };
  }
}

async function serveStatic(req, res) {
  const rawPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const requestPath = rawPath === "/" ? "/index.html" : rawPath;
  const pathname = normalize(requestPath).replace(/^([.][.][/\\])+/, "");
  const target = join(publicDir, pathname);
  if (!target.startsWith(publicDir)) return send(res, 403, "Forbidden");
  try {
    const info = await stat(target);
    if (!info.isFile()) return send(res, 404, "Not found");
    const content = await readFile(target);
    send(res, 200, content, { "Content-Type": MIME_TYPES[extname(target)] || "application/octet-stream" });
  } catch {
    send(res, 404, "Not found");
  }
}

function extensionCaseFromRecord(record) {
  return {
    id: record.extensionId,
    caseId: record.id,
    status: record.status,
    priority: record.decision === "PAUSED" ? "REVIEW NEEDED" : "READY FOR REVIEW",
    farmer: record.farmer,
    field: record.field,
    crop: record.crop,
    createdAt: record.createdAt,
    requiredEvidence: record.requiredEvidence,
    summary: record.reasons[0] || "Evidence package requires qualified review.",
    relay: record.relay
  };
}

export function buildInvoiceGateReceipt({ record, gate, invoiceId }) {
  const resolvedInvoiceId = String(invoiceId || record.externalInvoiceId || `LOCAL-${record.id}`).slice(0, 120);
  const receiptPayload = {
    invoiceId: resolvedInvoiceId,
    caseId: record.id,
    saleState: gate.saleState,
    policyVersion: gate.policyVersion,
    issuedAt: record.createdAt
  };
  const decisionDigest = createHash("sha256").update(JSON.stringify(receiptPayload)).digest("hex").slice(0, 16).toUpperCase();
  return {
    contract: "MittiGuard POS Gate v1",
    receiptId: `MG-${decisionDigest}`,
    decisionDigest,
    invoiceId: resolvedInvoiceId,
    saleAuthorization: "NOT_RELEASED",
    saleState: gate.saleState,
    policyVersion: gate.policyVersion,
    evidenceCaseId: record.id,
    handoffCode: record.relay?.handoffCode || record.id,
    requiredEvidence: gate.requiredEvidence,
    issuedAt: record.createdAt
  };
}

async function openEvidenceRelay(caseData, { useLiveModel = true } = {}) {
  // Field memory is evaluated server-side. The dealer cannot turn off a
  // repeat-risk match by clearing a client-side checkbox.
  caseData.repeatRisk = await store.findRepeatRisk(caseData);
  const gate = evaluateGate(caseData);
  let assessment = demoAssessment(caseData, gate);
  let mode = "deterministic demo engine";
  if (useLiveModel) {
    try {
      const liveAssessment = await getLiveAssessment(caseData, gate);
      if (liveAssessment) {
        assessment = liveAssessment;
        mode = `${assessment.source} evidence summary`;
      }
    } catch (error) {
      console.warn(`Live evidence summary unavailable: ${error.message}`);
      assessment.fallbackNote = "Live evidence summary was unavailable; the deterministic safety gate still ran.";
    }
  } else {
    mode = "rate-limited deterministic demo engine";
    assessment.fallbackNote = "The live evidence path is temporarily capped; the deterministic safety gate still ran.";
  }
  const record = await store.createCase({ caseData, gate, assessment });
  return { gate, assessment, case: record, extensionCase: extensionCaseFromRecord(record), relay: record.relay, mode };
}

function parseCaseId(pathname) {
  const match = pathname.match(/^\/api\/cases\/(C-\d+)\/evidence-received$/);
  return match?.[1] || null;
}

function parseTaskRoute(pathname) {
  const match = pathname.match(/^\/api\/cases\/(C-\d+)\/tasks\/(T-[A-Za-z0-9-]+)\/evidence-received$/);
  return match ? { caseId: match[1], taskId: match[2] } : null;
}

function parseAssignRoute(pathname) {
  const match = pathname.match(/^\/api\/cases\/(C-\d+)\/assign$/);
  return match?.[1] || null;
}

function parseOutcomeRoute(pathname) {
  const match = pathname.match(/^\/api\/cases\/(C-\d+)\/field-outcome$/);
  return match?.[1] || null;
}

function parseCaseDetailRoute(pathname) {
  const match = pathname.match(/^\/api\/cases\/(C-\d+)$/);
  return match?.[1] || null;
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
    if (req.method === "GET" && path === "/api/health") {
      const live = providerConfiguration();
      return sendJson(res, 200, {
        ok: true,
        liveProviderEnabled: live.enabled,
        runtimeProvider: live.label,
        model: live.model,
        dataStore: "local JSON ledger",
        workflow: "Evidence Relay v3",
        liveModelRateLimit: {
          windowMinutes: Math.round(LIVE_MODEL_WINDOW_MS / 60_000),
          perClient: LIVE_MODEL_PER_IP_LIMIT,
          service: LIVE_MODEL_GLOBAL_LIMIT
        }
      });
    }

    if (req.method === "GET" && path === "/api/weather") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const lat = Number(url.searchParams.get("lat") || 16.3067);
      const lon = Number(url.searchParams.get("lon") || 80.4365);
      return sendJson(res, 200, await weatherSnapshot(lat, lon));
    }

    if (req.method === "POST" && path === "/api/intake/extract") {
      const caseData = await readJson(req);
      let draft = demoIntakeDraft(caseData);
      let mode = "deterministic intake fallback";
      const access = liveModelAccess(req);
      if (access.allowed) {
        try {
          const liveDraft = await getLiveIntakeDraft(caseData);
          if (liveDraft) {
            draft = liveDraft;
            mode = `${draft.source} evidence intake`;
          }
        } catch (error) {
          console.warn(`Live intake extraction unavailable: ${error.message}`);
        }
      }
      if (!access.allowed) mode = "rate-limited deterministic intake fallback";
      return sendJson(res, 200, { draft, mode, nonAuthoritative: true, liveModelRateLimited: !access.allowed });
    }

    if (req.method === "POST" && path === "/api/demo/reset") {
      const body = await readJson(req);
      if (body.confirmation !== "RESET_DEMO_LEDGER") {
        return sendJson(res, 400, { error: "Explicit demo-reset confirmation is required." });
      }
      const baseline = await store.resetDemoLedger();
      return sendJson(res, 200, { ok: true, baseline });
    }

    if (req.method === "GET" && path === "/api/cases") {
      return sendJson(res, 200, { cases: await store.listCases() });
    }

    if (req.method === "GET" && path === "/api/relay") {
      return sendJson(res, 200, { cases: await store.listCases(), workflow: "Evidence Relay v3" });
    }

    if (req.method === "GET" && path.startsWith("/api/fields/")) {
      const fieldId = decodeURIComponent(path.slice("/api/fields/".length));
      const field = await store.getField(fieldId);
      return field ? sendJson(res, 200, { field }) : sendJson(res, 404, { error: "Field not found." });
    }

    const taskRoute = parseTaskRoute(path);
    if (req.method === "POST" && taskRoute) {
      const body = await readJson(req);
      const record = await store.recordTaskEvidence(taskRoute.caseId, taskRoute.taskId, body.note);
      return sendJson(res, 200, { case: record, extensionCase: extensionCaseFromRecord(record) });
    }

    const assignCaseId = parseAssignRoute(path);
    if (req.method === "POST" && assignCaseId) {
      const body = await readJson(req);
      const record = await store.assignCase(assignCaseId, body);
      return sendJson(res, 200, { case: record, extensionCase: extensionCaseFromRecord(record) });
    }

    const outcomeCaseId = parseOutcomeRoute(path);
    if (req.method === "POST" && outcomeCaseId) {
      const body = await readJson(req);
      const record = await store.recordFieldOutcome(outcomeCaseId, body);
      return sendJson(res, 200, { case: record, extensionCase: extensionCaseFromRecord(record) });
    }

    const detailCaseId = parseCaseDetailRoute(path);
    if (req.method === "GET" && detailCaseId) {
      const record = await store.getCase(detailCaseId);
      return record ? sendJson(res, 200, { case: record, extensionCase: extensionCaseFromRecord(record) }) : sendJson(res, 404, { error: "Case not found." });
    }

    const caseId = parseCaseId(path);
    if (req.method === "POST" && caseId) {
      const body = await readJson(req);
      const record = await store.recordReview(caseId, body.note);
      return sendJson(res, 200, { case: record, extensionCase: extensionCaseFromRecord(record) });
    }

    if (req.method === "POST" && path === "/api/assess") {
      const caseData = await readJson(req);
      const access = liveModelAccess(req);
      return sendJson(res, 200, await openEvidenceRelay(caseData, { useLiveModel: access.allowed }));
    }

    if (req.method === "POST" && path === "/api/pos/authorize-sale") {
      const body = await readJson(req);
      const invoiceId = String(body.invoiceId || "").trim();
      const caseData = body.case && typeof body.case === "object" ? body.case : body;
      if (!invoiceId || invoiceId.length > 120) {
        return sendJson(res, 400, { error: "A POS invoiceId (up to 120 characters) is required." });
      }
      caseData.externalInvoiceId = invoiceId;
      caseData.intakeChannel = "POS_GATE_API";
      const access = liveModelAccess(req);
      const result = await openEvidenceRelay(caseData, { useLiveModel: access.allowed });
      return sendJson(res, 200, {
        ...result,
        receipt: buildInvoiceGateReceipt({ record: result.case, gate: result.gate, invoiceId })
      });
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Unexpected server error" });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, () => {
    console.log(`MittiGuard is running at http://localhost:${port}`);
  });
}
