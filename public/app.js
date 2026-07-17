const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const form = $("#case-form");
const resultPanel = $("#result-panel");
const photoInput = $("#leaf-photo");
const photoLabel = $("#photo-label");
const transcriptInput = $("#intake-transcript");
let photoDataUrl = null;
let currentCase = null;
let demoMode = true;
let relayCases = [];
let selectedRelayId = null;
let speechRecognition = null;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
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
  return items?.length ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : `<li>${escapeHtml(emptyText)}</li>`;
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "MG";
}

function dateLabel(value, includeTime = false) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return "—";
  return new Intl.DateTimeFormat("en", includeTime
    ? { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short" }).format(new Date(value));
}

function resetDemo() {
  form.reset();
  form.elements.farmerName.value = "Asha Reddy";
  form.elements.fieldId.value = "GNT-14 · North plot";
  form.elements.crop.value = "Chilli";
  form.elements.cropStage.value = "Flowering";
  form.elements.farmerLanguage.value = "English";
  form.elements.requestType.value = "pesticide";
  form.elements.requestedProduct.value = "LeafShield 300";
  form.elements.symptom.value = "Yellowing lower leaves after rain; spots on a few plants.";
  form.elements.intakeTranscript.value = "Farmer reports the previous input did not improve the field after rain.";
  form.elements.soilReportDate.value = "2024-01-11";
  form.elements.lastInput.value = "Fungicide, 10 days ago";
  form.elements.previousInputFailed.checked = true;
  photoDataUrl = null;
  demoMode = true;
  photoInput.value = "";
  photoLabel.textContent = "Demo field evidence (simulated)";
  $("#form-footnote").textContent = "Demo mode uses simulated evidence. The policy never recommends a pesticide, fertiliser, dose, or application timing.";
  $("#voice-status").textContent = "Browser transcription is optional and not stored as audio.";
  resultPanel.classList.add("hidden");
  $("#case-number").textContent = "READY";
  $("#sale-preview").className = "sale-preview";
  $("#sale-preview").innerHTML = "<span class=\"dot\"></span><span>Invoice awaiting evidence</span>";
  scrollToTop();
}

function startLiveCase() {
  form.reset();
  demoMode = false;
  currentCase = null;
  photoDataUrl = null;
  photoInput.value = "";
  photoLabel.textContent = "Attach a whole-plant or close-up image";
  $("#form-footnote").textContent = "Live cases require an actual field image. Voice transcription remains text-only; no audio is persisted.";
  $("#voice-status").textContent = "Choose the farmer language, then capture or type the story.";
  resultPanel.classList.add("hidden");
  $("#case-number").textContent = "NEW";
  $("#sale-preview").className = "sale-preview";
  $("#sale-preview").innerHTML = "<span class=\"dot\"></span><span>Invoice awaiting evidence</span>";
  form.elements.farmerName.focus();
  scrollToTop();
}

async function resetDemoLedger() {
  const confirmed = window.confirm("Load the clean jury demo? This permanently clears only the local MittiGuard demo ledger on this computer.");
  if (!confirmed) return;
  const buttons = [$("#reset-demo-ledger"), $("#reset-demo-ledger-inline")];
  buttons.forEach((button) => { button.disabled = true; button.textContent = "Resetting demo…"; });
  try {
    const response = await fetch("/api/demo/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "RESET_DEMO_LEDGER" })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to reset the demo ledger.");
    relayCases = [];
    selectedRelayId = null;
    currentCase = null;
    resetDemo();
    await Promise.all([loadRelay(), loadFieldMemory()]);
    $("#form-footnote").textContent = "Clean jury demo loaded. The field has one prior outcome and one stale soil record—open the relay to begin the story.";
    switchSection("case-desk");
  } catch (error) {
    window.alert(error.message);
  } finally {
    buttons.forEach((button, index) => {
      button.disabled = false;
      button.textContent = index === 0 ? "↺ Load clean jury demo" : "Reset jury ledger";
    });
  }
}

function dataFromForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.photoProvided = demoMode || Boolean(photoDataUrl);
  data.photoDataUrl = photoDataUrl;
  data.previousInputFailed = form.elements.previousInputFailed.checked;
  data.weather = window.mittiWeather || null;
  return data;
}

function imageEvidenceLabel(imageEvidence = {}) {
  const labels = {
    usable: "Image context: usable for evidence review; no diagnosis generated.",
    limited: "Image context: limited; collect clearer evidence before review.",
    not_provided: "Image context: no actual image was provided to the model.",
    not_assessed: "Image context: attached for evidence only; no diagnostic conclusion generated."
  };
  return imageEvidence.reason ? `${labels[imageEvidence.status] || labels.not_assessed} ${imageEvidence.reason}` : (labels[imageEvidence.status] || labels.not_assessed);
}

function renderResult(result) {
  currentCase = result.case;
  const paused = result.gate.decision === "PAUSED";
  $("#big-status").textContent = paused ? "PAUSED" : "REVIEW READY";
  $("#big-status").className = `big-status ${paused ? "paused" : "ready"}`;
  $("#result-status").className = `result-status ${paused ? "paused" : "ready"}`;
  $("#result-summary").textContent = result.gate.repeatRisk?.detected
    ? "Automatic Field Memory found unresolved evidence debt. Policy stopped the invoice before a repeat sale could be discussed."
    : paused
      ? "Policy stopped the invoice. An evidence relay is now assigned before a human reviewer can continue."
    : "Evidence is complete enough for qualified review. This is not product authorization.";
  $("#reason-list").innerHTML = listItems(result.gate.reasons, "No policy conflict detected.");
  $("#evidence-list").innerHTML = listItems(result.relay?.tasks?.map((task) => task.title) || result.gate.requiredEvidence, "No additional evidence required for the review package.");
  $("#farmer-message").textContent = result.assessment.farmerMessage || "Evidence summary unavailable.";
  $("#analysis-source").textContent = result.mode.toUpperCase();
  $("#image-evidence").textContent = imageEvidenceLabel(result.assessment.imageEvidence);
  $("#extension-id").textContent = `${result.relay?.handoffCode || result.extensionCase.id} · ${result.case.id}`;
  $("#case-number").textContent = result.case.id;
  $("#sale-preview").className = `sale-preview ${paused ? "held" : "review"}`;
  $("#sale-preview").innerHTML = paused ? "<span class=\"dot\"></span><span>Invoice blocked — relay required</span>" : "<span class=\"dot\"></span><span>Qualified review required</span>";
  resultPanel.classList.remove("hidden");
  selectedRelayId = result.case.id;
  loadFieldMemory(result.case.field);
  loadRelay(result.case.id);
  setTimeout(() => resultPanel.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}

async function assess(event) {
  event.preventDefault();
  const button = $(".primary-button", form);
  button.disabled = true;
  button.innerHTML = "<span>Building evidence relay…</span><strong>◌</strong>";
  try {
    const response = await fetch("/api/assess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataFromForm()) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The evidence gate could not be reached.");
    renderResult(result);
  } catch (error) {
    $("#result-summary").textContent = error.message;
    resultPanel.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>Open Evidence Relay</span><strong>→</strong>";
  }
}

function relayPhaseLabel(phase) {
  return ({ DEALER_INTAKE: "COUNTER BLOCK", FIELD_CAPTURE: "FIELD CAPTURE", EXTENSION_REVIEW: "EXTENSION REVIEW" })[phase] || "EVIDENCE RELAY";
}

function openTasks(record) {
  return (record.relay?.tasks || []).filter((task) => task.status !== "EVIDENCE_RECEIVED");
}

function renderRelayCard(record) {
  const relay = record.relay || {};
  const remaining = openTasks(record);
  const overdue = relay.slaDueAt && new Date(relay.slaDueAt).valueOf() < Date.now() && remaining.length;
  return `<button class="relay-case-card ${record.id === selectedRelayId ? "selected" : ""}" data-relay-case="${escapeHtml(record.id)}"><span>${escapeHtml(record.saleState.replaceAll("_", " "))}</span>${record.repeatRisk?.detected ? "<mark>Evidence Debt</mark>" : ""}<b>${escapeHtml(record.crop)} · ${escapeHtml(record.field)}</b><p>${escapeHtml(record.symptom.split(";")[0])}</p><footer><i class="${overdue ? "overdue" : ""}"></i>${remaining.length} task${remaining.length === 1 ? "" : "s"} open <em>${escapeHtml(relay.owner?.name || "Unassigned")}</em></footer></button>`;
}

function renderLane(selector, records, countSelector) {
  $(selector).innerHTML = records.length ? records.map(renderRelayCard).join("") : "<div class=\"empty-lane\">No cases in this lane.</div>";
  $(countSelector).textContent = String(records.length);
}

function renderRelayBoard() {
  const intake = relayCases.filter((record) => record.relay?.phase === "DEALER_INTAKE");
  const capture = relayCases.filter((record) => record.relay?.phase === "FIELD_CAPTURE");
  const review = relayCases.filter((record) => record.relay?.phase === "EXTENSION_REVIEW");
  renderLane("#lane-intake", intake, "#intake-count");
  renderLane("#lane-capture", capture, "#capture-count");
  renderLane("#lane-review", review, "#review-count");
  const totalTasks = relayCases.reduce((total, record) => total + openTasks(record).length, 0);
  $("#relay-count").textContent = String(relayCases.length);
  $("#metric-blocked").textContent = String(relayCases.filter((record) => record.saleState === "ON_HOLD").length);
  $("#metric-tasks").textContent = String(totalTasks);
  $("#metric-review").textContent = String(review.length);
  $$("[data-relay-case]").forEach((button) => button.addEventListener("click", () => {
    selectedRelayId = button.dataset.relayCase;
    renderRelayBoard();
    renderRelayDetail();
    const selected = relayCases.find((record) => record.id === selectedRelayId);
    if (selected) loadFieldMemory(selected.field);
  }));
}

function renderAudit(events = []) {
  if (!events.length) return "<p>No relay events are recorded yet.</p>";
  return events.slice(0, 8).map((event) => `<div class="audit-event ${escapeHtml(event.kind || "relay")}"><span>${escapeHtml(dateLabel(event.at, true))}</span><i></i><div><b>${escapeHtml(event.event)}</b><small>${escapeHtml(event.actor)}</small><p>${escapeHtml(event.detail)}</p></div></div>`).join("");
}

function renderRelayDetail() {
  const record = relayCases.find((item) => item.id === selectedRelayId) || relayCases[0];
  if (!record) {
    $("#relay-case-title").textContent = "No relay cases yet";
    $("#relay-case-meta").textContent = "Open an evidence case from Case intake to create the first handoff.";
    $("#relay-phase").textContent = "WAITING";
    $("#handoff-code").textContent = "—";
    $("#relay-sla").textContent = "—";
    $("#handoff-message").textContent = "No handoff selected.";
    $("#relay-task-list").innerHTML = "";
    $("#relay-audit").innerHTML = "<p>Select a case to inspect each policy and handoff event.</p>";
    return;
  }
  selectedRelayId = record.id;
  const relay = record.relay || { tasks: [], audit: [], owner: {} };
  const remaining = openTasks(record);
  $("#relay-case-title").textContent = `${record.crop} · ${record.field}`;
  $("#relay-case-meta").textContent = `${record.farmer} · ${record.id} · owner: ${relay.owner?.name || "Unassigned"}${record.repeatRisk?.detected ? " · automatic Evidence Debt match" : ""}`;
  $("#relay-phase").textContent = relayPhaseLabel(relay.phase);
  $("#handoff-code").textContent = relay.handoffCode || record.id;
  $("#relay-sla").textContent = remaining.length ? `SLA due ${dateLabel(relay.slaDueAt, true)} · ${remaining.length} task${remaining.length === 1 ? "" : "s"} open` : "Evidence packet received · sale still on hold";
  $("#handoff-message").textContent = relay.handoffMessage || "Handoff message unavailable.";
  $("#copy-handoff").disabled = false;
  const ownerButton = $("#take-ownership");
  const reviewReady = relay.phase === "EXTENSION_REVIEW";
  const alreadyAcknowledged = relay.owner?.role === "EXTENSION_REVIEW" && relay.owner?.name === "Extension desk";
  ownerButton.disabled = !reviewReady || alreadyAcknowledged;
  ownerButton.textContent = !reviewReady ? "Complete capture tasks first" : (alreadyAcknowledged ? "Extension review acknowledged" : "Acknowledge extension review");
  $("#relay-task-list").innerHTML = relay.tasks?.map((task) => `<div class="relay-task ${task.status === "EVIDENCE_RECEIVED" ? "complete" : ""}"><span>${task.status === "EVIDENCE_RECEIVED" ? "✓" : "→"}</span><div><b>${escapeHtml(task.title)}</b><small>${escapeHtml(task.ownerRole.replaceAll("_", " "))} · due ${escapeHtml(dateLabel(task.dueAt, true))}</small>${task.note ? `<p>${escapeHtml(task.note)}</p>` : ""}</div><button class="task-action" data-task-id="${escapeHtml(task.id)}" ${task.status === "EVIDENCE_RECEIVED" ? "disabled" : ""}>${task.status === "EVIDENCE_RECEIVED" ? "Received" : "Record evidence"}</button></div>`).join("") || "<p>No evidence tasks are pending.</p>";
  $("#relay-audit").innerHTML = renderAudit(relay.audit);
  $$("[data-task-id]").forEach((button) => button.addEventListener("click", () => completeTask(button.dataset.taskId)));
}

async function loadRelay(preferredId) {
  try {
    const response = await fetch("/api/relay");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Evidence Relay is unavailable.");
    relayCases = data.cases || [];
    if (preferredId) selectedRelayId = preferredId;
    if (!relayCases.some((record) => record.id === selectedRelayId)) selectedRelayId = relayCases[0]?.id || null;
    renderRelayBoard();
    renderRelayDetail();
  } catch {
    $("#lane-intake").innerHTML = "<div class=\"empty-lane\">Relay ledger unavailable.</div>";
  }
}

async function completeTask(taskId) {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record) return;
  const button = $(`[data-task-id="${taskId}"]`);
  if (button) { button.disabled = true; button.textContent = "Recording…"; }
  try {
    const response = await fetch(`/api/cases/${record.id}/tasks/${taskId}/evidence-received`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Evidence received through the MittiGuard Relay. Reviewer verification is still required." })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to record evidence.");
    const index = relayCases.findIndex((item) => item.id === data.case.id);
    if (index >= 0) relayCases[index] = data.case;
    currentCase = data.case;
    renderRelayBoard();
    renderRelayDetail();
    loadFieldMemory(data.case.field);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = error.message; }
  }
}

async function acknowledgeExtensionReview() {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record) return;
  const button = $("#take-ownership");
  button.disabled = true;
  button.textContent = "Acknowledging…";
  try {
    const response = await fetch(`/api/cases/${record.id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "EXTENSION_REVIEW", name: "Extension desk" }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to assign reviewer ownership.");
    const index = relayCases.findIndex((item) => item.id === data.case.id);
    if (index >= 0) relayCases[index] = data.case;
    renderRelayBoard();
    renderRelayDetail();
  } catch (error) {
    button.disabled = false;
    button.textContent = error.message;
  }
}

async function copyHandoff() {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record?.relay?.handoffMessage) return;
  try {
    await navigator.clipboard?.writeText(record.relay.handoffMessage);
    $("#copy-handoff").textContent = "Copied evidence request";
  } catch {
    window.prompt("Copy this field request:", record.relay.handoffMessage);
  }
  setTimeout(() => { $("#copy-handoff").textContent = "Copy WhatsApp-ready request"; }, 1700);
}

function renderTimeline(events = []) {
  if (!events.length) return "<div class=\"timeline-row\"><span>—</span><i></i><div><b>No field history yet</b><p>The first case will create an auditable ledger event.</p></div></div>";
  return events.slice(0, 6).map((event) => `<div class="timeline-row ${event.severity === "warning" ? "critical" : ""}"><span>${escapeHtml(dateLabel(event.at))}</span><i></i><div><b>${escapeHtml(event.title)}</b><p>${escapeHtml(event.detail)}</p></div></div>`).join("");
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
    const gateEvents = (field.events || []).filter((event) => event.kind === "gate_result").length;
    $("#field-risk").textContent = gateEvents ? `${gateEvents} recorded gate event${gateEvents > 1 ? "s" : ""}` : "No recorded gate events";
  } catch {
    $("#field-risk").textContent = "Field ledger unavailable";
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
    $("#model-status").textContent = health.liveProviderEnabled ? `${health.runtimeProvider} evidence path active` : "Deterministic demo path active";
  } catch {
    $("#model-status").textContent = "Offline demo path";
  }
}

function startVoiceCapture() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $("#voice-status").textContent = "Speech recognition is unavailable in this browser. Type the farmer story instead.";
    return;
  }
  if (speechRecognition) {
    speechRecognition.stop();
    return;
  }
  const language = { English: "en-IN", Telugu: "te-IN", Hindi: "hi-IN", Tamil: "ta-IN" }[form.elements.farmerLanguage.value] || "en-IN";
  speechRecognition = new Recognition();
  speechRecognition.lang = language;
  speechRecognition.interimResults = true;
  speechRecognition.continuous = false;
  $("#voice-capture").textContent = "◌ Listening…";
  $("#voice-status").textContent = "Transcribing in this browser. Review the text before opening the relay.";
  speechRecognition.onresult = (event) => {
    const transcript = [...event.results].map((result) => result[0].transcript).join(" ").trim();
    transcriptInput.value = transcript;
  };
  speechRecognition.onerror = () => { $("#voice-status").textContent = "Voice capture was unavailable. You can type the farmer story instead."; };
  speechRecognition.onend = () => {
    speechRecognition = null;
    $("#voice-capture").textContent = "◉ Capture voice note";
    if (transcriptInput.value.trim()) $("#voice-status").textContent = "Transcript captured. Confirm it before opening the relay.";
  };
  speechRecognition.start();
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files[0];
  if (!file) {
    photoDataUrl = null;
    photoLabel.textContent = demoMode ? "Demo field evidence (simulated)" : "Attach a whole-plant or close-up image";
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
  demoMode = false;
  photoLabel.textContent = `${file.name} · ready for evidence review`;
});

form.addEventListener("submit", assess);
$("#reset-demo").addEventListener("click", resetDemo);
$("#reset-demo-ledger").addEventListener("click", resetDemoLedger);
$("#reset-demo-ledger-inline").addEventListener("click", resetDemoLedger);
$("#new-live-case").addEventListener("click", startLiveCase);
$("#voice-capture").addEventListener("click", startVoiceCapture);
$$(".nav-item").forEach((item) => item.addEventListener("click", () => switchSection(item.dataset.section)));
$$("[data-section-target]").forEach((item) => item.addEventListener("click", () => switchSection(item.dataset.sectionTarget)));
$("#copy-handoff").addEventListener("click", copyHandoff);
$("#take-ownership").addEventListener("click", acknowledgeExtensionReview);
$("#copy-test-command").addEventListener("click", async () => {
  await navigator.clipboard?.writeText("npm test");
  $("#copy-test-command").textContent = "Copied: npm test";
  setTimeout(() => { $("#copy-test-command").textContent = "Copy test command"; }, 1600);
});

resetDemo();
loadWeather();
loadHealth();
loadFieldMemory();
loadRelay();
