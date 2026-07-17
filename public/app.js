const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const form = $("#case-form");
const resultPanel = $("#result-panel");
const photoInput = $("#leaf-photo");
const photoLabel = $("#photo-label");
let photoDataUrl = null;
let currentCase = null;
let demoMode = true;

function resetDemo() {
  form.reset();
  form.elements.farmerName.value = "Asha Reddy";
  form.elements.fieldId.value = "GNT-14 · North plot";
  form.elements.crop.value = "Chilli";
  form.elements.cropStage.value = "Flowering";
  form.elements.requestType.value = "pesticide";
  form.elements.requestedProduct.value = "LeafShield 300";
  form.elements.symptom.value = "Yellowing lower leaves after rain; spots on a few plants.";
  form.elements.soilReportDate.value = "2024-01-11";
  form.elements.lastInput.value = "Fungicide, 10 days ago";
  form.elements.previousInputFailed.checked = true;
  photoDataUrl = null;
  demoMode = true;
  photoLabel.textContent = "Demo leaf evidence (simulated)";
  $("#form-footnote").textContent = "Demo mode uses a simulated leaf attachment. The gate never recommends a pesticide, fertiliser, dose, or application timing.";
  resultPanel.classList.add("hidden");
  $("#sale-preview").className = "sale-preview";
  $("#sale-preview").innerHTML = "<span class=\"dot\"></span><span>Cart awaiting evidence</span>";
  scrollToTop();
}

function startLiveCase() {
  form.reset();
  demoMode = false;
  currentCase = null;
  photoDataUrl = null;
  photoLabel.textContent = "Attach a whole-plant or close-up image";
  $("#form-footnote").textContent = "Live cases require an actual field image. The gate never recommends a pesticide, fertiliser, dose, or application timing.";
  resultPanel.classList.add("hidden");
  $("#case-number").textContent = "NEW";
  $("#sale-preview").className = "sale-preview";
  $("#sale-preview").innerHTML = "<span class=\"dot\"></span><span>Cart awaiting evidence</span>";
  form.elements.farmerName.focus();
  scrollToTop();
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function switchSection(sectionId) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === sectionId));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === sectionId));
  scrollToTop();
}

function listItems(items, emptyText) {
  return items.length ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : `<li>${escapeHtml(emptyText)}</li>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function dataFromForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  // Demo mode makes the judging flow runnable offline. Live cases must attach a photo.
  data.photoProvided = demoMode || Boolean(photoDataUrl);
  data.photoDataUrl = photoDataUrl;
  data.previousInputFailed = form.elements.previousInputFailed.checked;
  data.weather = window.mittiWeather || null;
  return data;
}

function renderResult(result) {
  currentCase = result.case;
  const paused = result.gate.decision === "PAUSED";
  $("#big-status").textContent = paused ? "PAUSED" : "REVIEW READY";
  $("#big-status").className = `big-status ${paused ? "paused" : "ready"}`;
  $("#result-status").className = `result-status ${paused ? "paused" : "ready"}`;
  $("#result-summary").textContent = paused
    ? "The evidence does not support a product discussion. The cart is paused and a review case has been opened."
    : "Evidence is complete enough for a qualified reviewer. This is not product authorization.";
  $("#reason-list").innerHTML = listItems(result.gate.reasons, "No policy conflict detected.");
  $("#evidence-list").innerHTML = listItems(result.gate.requiredEvidence, "No additional evidence required for the review package.");
  $("#farmer-message").textContent = result.assessment.farmerMessage || "Evidence summary unavailable.";
  $("#analysis-source").textContent = result.mode.toUpperCase();
  $("#extension-id").textContent = `${result.extensionCase.id} · ${result.case.id}`;
  $("#case-number").textContent = result.case.id;
  $("#sale-preview").className = `sale-preview ${paused ? "held" : "review"}`;
  $("#sale-preview").innerHTML = paused ? "<span class=\"dot\"></span><span>Cart paused — evidence required</span>" : "<span class=\"dot\"></span><span>Qualified review required</span>";
  renderQueueRecord(result.case);
  resultPanel.classList.remove("hidden");
  loadFieldMemory(result.case.field);
  loadOpenCaseCount();
  setTimeout(() => resultPanel.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}

function renderQueueRecord(record) {
  currentCase = record;
  $("#queue-title").textContent = `${record.symptom.split(";")[0] || "Evidence case"} · ${record.field}`;
  $("#queue-subtitle").textContent = `${record.farmer} · ${record.extensionId} · ${record.id}`;
  $("#queue-evidence").textContent = record.requiredEvidence?.join(" · ") || "Evidence package complete";
  $("#queue-state").textContent = record.saleState === "ON_HOLD"
    ? (record.status === "EVIDENCE_RECEIVED" ? "SALE STILL ON HOLD" : "ON HOLD")
    : "REVIEW REQUIRED";
  $("#queue-pill").textContent = record.status.replaceAll("_", " ");
  const button = $("#mark-evidence-received");
  button.disabled = record.status === "EVIDENCE_RECEIVED";
  button.textContent = record.status === "EVIDENCE_RECEIVED" ? "Evidence recorded — sale remains paused" : "Mark evidence received →";
}

async function assess(event) {
  event.preventDefault();
  const button = $(".primary-button", form);
  button.disabled = true;
  button.innerHTML = "<span>Checking evidence…</span><strong>◌</strong>";
  try {
    const response = await fetch("/api/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataFromForm())
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The evidence gate could not be reached.");
    renderResult(result);
  } catch (error) {
    $("#result-summary").textContent = error.message;
    resultPanel.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>Run evidence gate</span><strong>→</strong>";
  }
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "MG";
}

function shortDate(value) {
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short" }).format(new Date(value));
}

function renderTimeline(events = []) {
  if (!events.length) return "<div class=\"timeline-row\"><span>—</span><i></i><div><b>No field history yet</b><p>The first case will create an auditable ledger event.</p></div></div>";
  return events.slice(0, 5).map((event) => `<div class=\"timeline-row ${event.severity === "warning" ? "critical" : ""}\"><span>${escapeHtml(shortDate(event.at))}</span><i></i><div><b>${escapeHtml(event.title)}</b><p>${escapeHtml(event.detail)}</p></div></div>`).join("");
}

async function loadFieldMemory(fieldId = "GNT-14 · North plot") {
  try {
    const response = await fetch(`/api/fields/${encodeURIComponent(fieldId)}`);
    if (!response.ok) return;
    const { field } = await response.json();
    $("#memory-farmer").textContent = field.farmerName || "Unnamed farmer";
    $("#memory-crop").textContent = `Linked field · ${field.crop || "Unspecified crop"}`;
    $("#memory-field").textContent = field.id.toUpperCase();
    $("#profile-avatar").textContent = initials(field.farmerName);
    $("#field-timeline").innerHTML = renderTimeline(field.events);
    const openCases = (field.events || []).filter((event) => event.kind === "gate_result").length;
    $("#field-risk").textContent = openCases ? `${openCases} recorded gate event${openCases > 1 ? "s" : ""}` : "No recorded gate events";
  } catch {
    $("#field-risk").textContent = "Field ledger unavailable";
  }
}

async function loadOpenCaseCount() {
  try {
    const response = await fetch("/api/cases");
    const { cases } = await response.json();
    const openCount = cases.filter((item) => item.status === "OPEN").length;
    $("#queue-count").textContent = String(openCount);
  } catch {
    // The case desk remains usable when the optional queue refresh is unavailable.
  }
}

async function loadLatestCase() {
  try {
    const response = await fetch("/api/cases");
    const { cases } = await response.json();
    const record = cases.find((item) => item.status === "OPEN") || cases[0];
    if (record) {
      renderQueueRecord(record);
      loadFieldMemory(record.field);
    } else {
      $("#queue-count").textContent = "0";
      $("#queue-pill").textContent = "EMPTY";
      $("#mark-evidence-received").disabled = true;
      $("#mark-evidence-received").textContent = "Run a case first";
    }
  } catch {
    // The static demo card remains available when the local ledger is unavailable.
  }
}

async function markEvidenceReceived() {
  if (!currentCase) {
    switchSection("case-desk");
    return;
  }
  const button = $("#mark-evidence-received");
  button.disabled = true;
  button.textContent = "Recording evidence…";
  try {
    const response = await fetch(`/api/cases/${currentCase.id}/evidence-received`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Evidence packet received. Sale remains on hold until a qualified reviewer completes the case." })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to record the evidence update.");
    currentCase = result.case;
    $("#queue-pill").textContent = "EVIDENCE RECEIVED";
    $("#queue-state").textContent = "SALE STILL ON HOLD";
    button.textContent = "Evidence recorded — sale remains paused";
    loadFieldMemory(currentCase.field);
    loadOpenCaseCount();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message;
  }
}

async function loadWeather() {
  try {
    const response = await fetch("/api/weather?lat=16.3067&lon=80.4365");
    const weather = await response.json();
    window.mittiWeather = weather;
    $("#weather-live").textContent = weather.live ? "LIVE · OPEN-METEO" : "CACHED CONTEXT";
    $("#weather-temp").textContent = weather.temperature == null ? "—°" : `${Math.round(weather.temperature)}°`;
    $("#weather-rain").textContent = weather.precipitation == null ? "— mm" : `${weather.precipitation} mm`;
    $("#weather-tomorrow").textContent = weather.tomorrowRain == null ? "— mm" : `${weather.tomorrowRain} mm`;
  } catch {
    $("#weather-live").textContent = "CONTEXT UNAVAILABLE";
  }
}

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    $("#model-status").textContent = health.liveProviderEnabled
      ? `${health.runtimeProvider} evidence path active`
      : "Deterministic demo path active";
  } catch {
    $("#model-status").textContent = "Offline demo path";
  }
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) {
    photoDataUrl = null;
    photoLabel.textContent = demoMode ? "Demo leaf evidence (simulated)" : "Attach a whole-plant or close-up image";
    return;
  }
  if (file.size > 900_000) {
    photoDataUrl = null;
    photoInput.value = "";
    photoLabel.textContent = "Image is too large — use a file under 900 KB";
    return;
  }
  photoDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  photoLabel.textContent = `${file.name} · ready for evidence review`;
});
form.addEventListener("submit", assess);
$("#reset-demo").addEventListener("click", resetDemo);
$("#new-live-case").addEventListener("click", startLiveCase);
$$(".nav-item").forEach((item) => item.addEventListener("click", () => switchSection(item.dataset.section)));
$$("[data-section-target]").forEach((item) => item.addEventListener("click", () => switchSection(item.dataset.sectionTarget)));
$("#copy-test-command").addEventListener("click", async () => {
  await navigator.clipboard?.writeText("npm test");
  $("#copy-test-command").textContent = "Copied: npm test";
  setTimeout(() => { $("#copy-test-command").textContent = "Copy test command"; }, 1600);
});
$("#mark-evidence-received").addEventListener("click", markEvidenceReceived);

resetDemo();
loadWeather();
loadHealth();
loadFieldMemory();
loadOpenCaseCount();
loadLatestCase();
