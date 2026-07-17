import { createServer } from "node:http";
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

function sanitizeAssessment(assessment = {}, source) {
  return {
    observations: Array.isArray(assessment.observations) ? assessment.observations.slice(0, 4) : [],
    conflicts: Array.isArray(assessment.conflicts) ? assessment.conflicts.slice(0, 4) : [],
    questions: Array.isArray(assessment.questions) ? assessment.questions.slice(0, 4) : [],
    farmerMessage: typeof assessment.farmerMessage === "string" ? assessment.farmerMessage.slice(0, 420) : "",
    source
  };
}

const DOSAGE_PATTERN = /\b\d+(?:\.\d+)?\s?(?:ml|millilit(?:er|re)s?|g|grams?|kg|kilograms?|l|lit(?:er|re)s?)\b/i;
const ACTION_ADVICE_PATTERN = /\b(?:you|farmer|grower)\s+(?:should|must|need to|can)\s+(?:apply|spray|mix|use|treat|drench|dose)\b|\b(?:apply|spray|mix|drench)\s+(?:\d|an?\s)/i;

function assessmentText(assessment) {
  return [
    ...(Array.isArray(assessment.observations) ? assessment.observations : []),
    ...(Array.isArray(assessment.conflicts) ? assessment.conflicts : []),
    ...(Array.isArray(assessment.questions) ? assessment.questions : []),
    assessment.farmerMessage || ""
  ].join(" ");
}

export function enforceEvidenceOnlyAssessment(assessment, source, caseData = {}) {
  const text = assessmentText(assessment);
  if (DOSAGE_PATTERN.test(text) || ACTION_ADVICE_PATTERN.test(text)) {
    throw new Error("Model response violated MittiGuard's evidence-only contract.");
  }

  const requestedProductTerms = String(caseData.requestedProduct || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 5);
  const normalizedText = text.toLowerCase();
  if (requestedProductTerms.some((term) => normalizedText.includes(term))) {
    throw new Error("Model response repeated a requested product.");
  }

  return sanitizeAssessment(assessment, source);
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
    symptom: caseData.symptom,
    requestType: caseData.requestType,
    lastInput: caseData.lastInput,
    previousInputFailed: caseData.previousInputFailed,
    soilReportDate: caseData.soilReportDate,
    weather: caseData.weather,
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
  const conflicts = gate.reasons.filter((reason) => /Yellowing|unsuccessful|soil report/i.test(reason));
  return {
    observations,
    conflicts,
    questions: gate.requiredEvidence,
    farmerMessage: gate.decision === "PAUSED"
      ? "Your field needs a little more evidence before another input is sold. We have opened a review case instead of guessing."
      : "The evidence package is complete enough for a qualified reviewer. MittiGuard will not recommend a product or dose.",
    source: "Deterministic demo engine"
  };
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

  const response = await fetch("https://api.openai.com/v1/responses", {
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
              farmerMessage: { type: "string" }
            },
            required: ["observations", "conflicts", "questions", "farmerMessage"]
          }
        }
      }
    })
  });

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
    text: `Field case and fixed gate result:\n${caseSummary(caseData, gate)}\n\nReturn exactly one valid JSON object with this shape: {"observations":["..."],"conflicts":["..."],"questions":["..."],"farmerMessage":"..."}. No Markdown. Do not diagnose a crop disease. Do not recommend or name a pesticide, fertiliser, product, dosage, timing, or treatment. The fixed gate state cannot be changed.`
  }];
  const image = parseImageDataUrl(caseData.photoDataUrl);
  if (image) content.push({ image: { format: image.format, source: { bytes: image.bytes } } });

  const response = await fetch(
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
    }
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
    summary: record.reasons[0] || "Evidence package requires qualified review."
  };
}

function parseCaseId(pathname) {
  const match = pathname.match(/^\/api\/cases\/(C-\d+)\/evidence-received$/);
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
        dataStore: "local JSON ledger"
      });
    }

    if (req.method === "GET" && path === "/api/weather") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const lat = Number(url.searchParams.get("lat") || 16.3067);
      const lon = Number(url.searchParams.get("lon") || 80.4365);
      return sendJson(res, 200, await weatherSnapshot(lat, lon));
    }

    if (req.method === "GET" && path === "/api/cases") {
      return sendJson(res, 200, { cases: await store.listCases() });
    }

    if (req.method === "GET" && path.startsWith("/api/fields/")) {
      const fieldId = decodeURIComponent(path.slice("/api/fields/".length));
      const field = await store.getField(fieldId);
      return field ? sendJson(res, 200, { field }) : sendJson(res, 404, { error: "Field not found." });
    }

    const caseId = parseCaseId(path);
    if (req.method === "POST" && caseId) {
      const body = await readJson(req);
      const record = await store.recordReview(caseId, body.note);
      return sendJson(res, 200, { case: record, extensionCase: extensionCaseFromRecord(record) });
    }

    if (req.method === "POST" && path === "/api/assess") {
      const caseData = await readJson(req);
      const gate = evaluateGate(caseData);
      let assessment = demoAssessment(caseData, gate);
      let mode = "deterministic demo engine";
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
      const record = await store.createCase({ caseData, gate, assessment });
      return sendJson(res, 200, { gate, assessment, case: record, extensionCase: extensionCaseFromRecord(record), mode });
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
