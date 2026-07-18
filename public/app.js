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
let intakeDraft = null;
let draftCopiedToFields = false;
let latestReceipt = null;
let reviewAttestationPreview = null;
let reviewAttestationPreviewCaseId = null;
let reviewAttestationPreviewError = null;
let reviewAttestationPreviewErrorCaseId = null;
let reviewAttestationVerification = null;
let reviewAttestationVerificationCaseId = null;
let reviewAttestationConfirmationCaseId = null;
let reviewAttestationReviewerCaseId = null;
const fieldCaptureLinks = new Map();

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

function setWorkflowStage(stage = null) {
  const stages = ["intake", "gate", "pos", "relay"];
  const activeIndex = stages.indexOf(stage);
  $$('[data-workflow-step]').forEach((node, index) => {
    node.classList.toggle("done", activeIndex >= 0 && index < activeIndex);
    node.classList.toggle("active", activeIndex === index);
  });
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
  fieldCaptureLinks.clear();
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
  latestReceipt = null;
  demoMode = true;
  photoInput.value = "";
  photoLabel.textContent = "No field image attached — Field Capture will request one";
  $("#form-footnote").textContent = "The clean demo intentionally starts without a photo. The relay will require actual field-capture evidence; the policy never recommends a pesticide, fertiliser, dose, or application timing.";
  $("#voice-status").textContent = "Browser transcription is optional and not stored as audio.";
  clearIntakeDraft();
  resultPanel.classList.add("hidden");
  $("#case-number").textContent = "READY";
  $("#sale-preview").className = "sale-preview";
  $("#sale-preview").innerHTML = "<span class=\"dot\"></span><span>Invoice awaiting evidence</span>";
  setWorkflowStage();
  scrollToTop();
}

function startLiveCase() {
  fieldCaptureLinks.clear();
  form.reset();
  demoMode = false;
  currentCase = null;
  latestReceipt = null;
  photoDataUrl = null;
  photoInput.value = "";
  photoLabel.textContent = "Attach a whole-plant or close-up image";
  $("#form-footnote").textContent = "This public deployment is a synthetic jury demo. A blank case requires actual image evidence before Field Capture can complete a photo task.";
  $("#voice-status").textContent = "Choose the farmer language, then capture or type the story.";
  clearIntakeDraft();
  resultPanel.classList.add("hidden");
  $("#case-number").textContent = "NEW";
  $("#sale-preview").className = "sale-preview";
  $("#sale-preview").innerHTML = "<span class=\"dot\"></span><span>Invoice awaiting evidence</span>";
  setWorkflowStage();
  form.elements.farmerName.focus();
  scrollToTop();
}

async function resetDemoLedger({ confirm = true } = {}) {
  const confirmed = !confirm || window.confirm("Load the clean jury demo? This resets the shared synthetic jury ledger for this public demo.");
  if (!confirmed) return false;
  const buttons = [$("#reset-demo-ledger"), $("#start-jury-demo"), $("#run-bypass-proof")].filter(Boolean);
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
    $("#form-footnote").textContent = "Clean jury demo loaded: no field image, one stale soil record, and one unresolved prior outcome. Run the bypass proof or open the relay yourself.";
    switchSection("case-desk");
    return true;
  } catch (error) {
    window.alert(error.message);
    return false;
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.innerHTML = button.id === "run-bypass-proof"
        ? "<span>Run bypass proof</span><strong>→</strong>"
        : button.id === "start-jury-demo"
          ? "Load clean demo case"
          : "↺ Load clean jury demo";
    });
  }
}

function dataFromForm() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.photoProvided = Boolean(photoDataUrl);
  data.photoDataUrl = photoDataUrl;
  data.previousInputFailed = form.elements.previousInputFailed.checked;
  data.weather = window.mittiWeather || null;
  return data;
}

function clearIntakeDraft() {
  intakeDraft = null;
  draftCopiedToFields = false;
  const confirmation = $("#draft-source-confirmed");
  if (confirmation) confirmation.checked = false;
  $("#intake-draft").classList.add("hidden");
  $("#intake-draft-source").textContent = "Waiting for reviewed field evidence";
  $("#draft-symptom").textContent = "—";
  $("#draft-crop").textContent = "—";
  $("#draft-gaps").textContent = "—";
  $("#draft-note").textContent = "The model creates an evidence draft only. Confirm the source fields before opening the relay.";
}

function renderIntakeDraft(result) {
  intakeDraft = result.draft;
  $("#intake-draft-source").textContent = `${result.mode} · editable evidence only`;
  $("#draft-symptom").textContent = intakeDraft.symptom || "No symptom could be extracted; keep the original wording.";
  $("#draft-crop").textContent = [intakeDraft.crop, intakeDraft.cropStage].filter(Boolean).join(" · ") || "No crop or stage extracted.";
  $("#draft-gaps").textContent = intakeDraft.evidenceGaps.length ? intakeDraft.evidenceGaps.join(" · ") : "No gap identified by the draft; policy will still verify the full packet.";
  $("#draft-note").textContent = intakeDraft.reviewerNote;
  $("#intake-draft").classList.remove("hidden");
}

async function extractIntakeDraft() {
  const button = $("#extract-intake");
  const hasNarrative = Boolean(form.elements.intakeTranscript.value.trim() || form.elements.symptom.value.trim());
  if (!hasNarrative && !photoDataUrl) {
    $("#voice-status").textContent = "Add a reviewed field narrative or image before extracting an evidence draft.";
    return;
  }
  button.disabled = true;
  button.textContent = "Extracting evidence…";
  try {
    const response = await fetch("/api/intake/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataFromForm())
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Evidence intake is unavailable.");
    renderIntakeDraft(result);
    $("#voice-status").textContent = "Evidence draft ready. Review it before applying any editable fields.";
  } catch (error) {
    $("#voice-status").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Extract evidence draft →";
  }
}

function applyIntakeDraft() {
  if (!intakeDraft) return;
  if (!$("#draft-source-confirmed").checked) {
    $("#voice-status").textContent = "Confirm that you compared the draft with the source narrative before copying editable fields.";
    return;
  }
  if (intakeDraft.crop) form.elements.crop.value = intakeDraft.crop;
  if (intakeDraft.cropStage && [...form.elements.cropStage.options].some((option) => option.value === intakeDraft.cropStage)) {
    form.elements.cropStage.value = intakeDraft.cropStage;
  }
  if (intakeDraft.symptom) form.elements.symptom.value = intakeDraft.symptom;
  draftCopiedToFields = true;
  $("#voice-status").textContent = "Editable draft copied for human review. The server gate—not the draft—will decide the sale state.";
}

function newInvoiceId() {
  return `COUNTER-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
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

function shorten(value = "", length = 88) {
  const text = String(value).trim();
  return text.length > length ? `${text.slice(0, length - 1).trim()}…` : text;
}

function shortHash(value = "") {
  const hash = String(value || "");
  return hash.length > 14 ? `${hash.slice(0, 10)}…${hash.slice(-4)}` : (hash || "—");
}

function auditStatusLabel(proof = null) {
  if (!proof?.ledgerId) return "Audit chain waiting";
  if (!proof.valid) return "Audit verification failed";
  return proof.sealed ? "HMAC-sealed audit · verified" : "Development hash chain · verified";
}

function renderAuditProof(proof = null) {
  const label = auditStatusLabel(proof);
  $("#audit-chain-label").textContent = label;
  $("#audit-chain-label").className = proof?.valid ? "verified" : "warning";
  if (!proof?.ledgerId) {
    $("#relay-audit-proof").textContent = "Each event will be linked to the server ledger.";
    return;
  }
  const coverage = proof.coverage === "FROM_MIGRATION_FORWARD"
    ? "new entries are covered from migration"
    : proof.coverage === "FROM_DEMO_RESET_FORWARD"
      ? "new events are covered from the demo reset; seed history is unsealed"
      : "every ledger entry is linked";
  $("#relay-audit-proof").textContent = `${proof.sealed ? "HMAC-SHA256" : "SHA-256 development"} · ${proof.caseEntryCount} case event${proof.caseEntryCount === 1 ? "" : "s"} · ${coverage} · head ${shortHash(proof.headHash)}`;
}

function renderPosReceipt(receipt = null, auditProof = null) {
  latestReceipt = receipt;
  const proof = receipt?.auditProof || auditProof;
  $("#receipt-state").textContent = receipt?.saleAuthorization?.replaceAll("_", " ") || "NOT RELEASED";
  $("#receipt-invoice").textContent = receipt?.invoiceId || "Case Desk run";
  $("#receipt-policy").textContent = receipt?.policyVersion || "MG-1.0";
  $("#receipt-digest").textContent = receipt?.decisionDigest || "No POS digest";
  $("#receipt-audit").textContent = proof?.valid
    ? `${proof.sealed ? "sealed" : "development"} · ${shortHash(proof.headHash)}`
    : "Verification unavailable";
  $("#pos-receipt-json").textContent = receipt
    ? JSON.stringify(receipt, null, 2)
    : "This Case Desk route did not request a POS receipt.";
  $("#pos-receipt-json").classList.add("hidden");
  $("#toggle-pos-json").textContent = "View contract JSON";
}

function renderBypassProof(result) {
  const { case: record, gate } = result;
  const matched = Boolean(gate.repeatRisk?.detected);
  $("#proof-dealer").textContent = record.previousInputFailed ? "Prior failure reported" : "No prior failure reported";
  $("#proof-memory").textContent = matched ? "Unresolved Evidence Debt found" : "No unresolved Evidence Debt found";
  $("#proof-pos").textContent = result.receipt?.saleAuthorization?.replaceAll("_", " ") || "NOT RELEASED";
  $("#bypass-proof-headline").textContent = matched
    ? "Repeat sale stopped before it became an invoice."
    : "Server policy—not a browser control—returns NOT RELEASED.";
  $("#bypass-proof").classList.toggle("match-found", matched);
}

async function loadAuditProof(caseId) {
  if (!caseId) return;
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/audit-proof`);
    const data = await response.json();
    if (!response.ok || selectedRelayId !== caseId) return;
    renderAuditProof(data.auditProof);
  } catch {
    if (selectedRelayId === caseId) renderAuditProof(null);
  }
}

function setEvidenceNode(name, title, detail, state = "context") {
  const node = $(`#map-${name}`);
  node.className = `evidence-node ${name} ${state}`;
  $(`#map-${name}-title`).textContent = title;
  $(`#map-${name}-detail`).textContent = detail;
}

function renderDecisionRoom(result) {
  const { case: record, gate } = result;
  const weather = record.weather || window.mittiWeather || {};
  const soil = gate.soil || {};
  const repeatRisk = gate.repeatRisk || { detected: false };
  const transcript = record.intakeTranscript || record.symptom || "No field narrative captured.";
  const photoStatus = result.assessment?.imageEvidence?.status;
  const soilTitle = soil.status === "current" ? "Current soil record" : soil.status === "stale" ? "Stale soil record" : "No soil record";
  const soilDetail = soil.status === "stale"
    ? `${soil.age} days old — cannot resolve yellowing safely.`
    : soil.status === "current" ? "Available as context; policy still requires review." : "A current Soil Health Card is required.";
  const photoDetail = record.photoAttached
    ? imageEvidenceLabel(result.assessment?.imageEvidence)
    : "No field image was attached to the evidence packet.";
  const weatherDetail = weather.temperature == null
    ? "Weather context is unavailable; it cannot alter the sale state."
    : `${Math.round(weather.temperature)}°C · ${weather.precipitation ?? "—"} mm rain now · context only.`;
  const paused = gate.decision === "PAUSED";

  setEvidenceNode("voice", record.intakeTranscript ? "Voice narrative captured" : "Typed field narrative", shorten(transcript), "confirmed");
  setEvidenceNode("soil", soilTitle, soilDetail, soil.status === "current" ? "confirmed" : "conflict");
  setEvidenceNode("photo", record.photoAttached ? "Photo evidence attached" : "Photo evidence missing", photoDetail, record.photoAttached && photoStatus !== "limited" ? "confirmed" : "conflict");
  setEvidenceNode("memory", repeatRisk.detected ? "Automatic Evidence Debt" : "No automatic match", repeatRisk.detected ? shorten(repeatRisk.summary || "A similar unresolved field record exists in field memory.") : "Field memory is checked server-side on every intake.", repeatRisk.detected ? "conflict" : "confirmed");
  setEvidenceNode("weather", "Weather context", weatherDetail, weather.temperature == null ? "context" : "confirmed");

  $("#map-policy-state").textContent = paused
    ? gate.saleState.replaceAll("_", " ")
    : "REVIEW · NOT RELEASED";
  $("#map-policy-detail").textContent = paused
    ? `${gate.reasons.length} conflict${gate.reasons.length === 1 ? "" : "s"} converted into evidence work.`
    : "Evidence is routed to a qualified reviewer; no sale is released.";
  $("#map-policy").className = `policy-node ${paused ? "blocked" : "not-released"}`;
  $("#control-state").className = `control-state ${paused ? "blocked" : "not-released"}`;
  $("#control-state b").textContent = paused ? "INVOICE BLOCKED" : "REVIEW PACKET · NOT RELEASED";
  $("#control-headline").textContent = repeatRisk.detected
    ? "Evidence Debt stopped a repeat sale."
    : paused ? "The sale pauses before a guess becomes an invoice." : "A human reviewer owns the next step; the invoice remains not released.";
  $("#control-detail").textContent = repeatRisk.detected
    ? "A related unresolved field record was found in the ledger. The dealer cannot clear this risk manually."
    : "Every conflicting signal becomes an assigned evidence task. Completing tasks cannot release the sale.";
  $("#control-rule").textContent = gate.safetyNote;
  $("#decision-room-verdict").textContent = repeatRisk.detected
    ? "MATCH FOUND · REVIEW REQUIRED"
    : paused ? "EVIDENCE GAP · RELAY REQUIRED" : "REVIEW PACKET · NOT RELEASED";
  renderBypassProof(result);
}

function renderResult(result) {
  currentCase = result.case;
  const paused = result.gate.decision === "PAUSED";
  $("#big-status").textContent = paused ? "PAUSED" : "NOT RELEASED";
  $("#big-status").className = "big-status paused";
  $("#result-status").className = "result-status paused";
  $("#result-summary").textContent = result.gate.repeatRisk?.detected
    ? "Automatic Field Memory found a matching unresolved field record. Policy stopped the invoice before a repeat sale could be discussed."
    : paused
      ? "Policy stopped the invoice. An evidence relay is now assigned before a human reviewer can continue."
      : "Evidence is complete enough for qualified review; the invoice remains NOT RELEASED.";
  $("#reason-list").innerHTML = listItems(result.gate.reasons, "No policy conflict detected.");
  $("#evidence-list").innerHTML = listItems(result.relay?.tasks?.map((task) => task.title) || result.gate.requiredEvidence, "No additional evidence required for the review package.");
  $("#farmer-message").textContent = result.assessment.farmerMessage || "Evidence summary unavailable.";
  $("#analysis-source").textContent = result.mode.toUpperCase();
  $("#image-evidence").textContent = imageEvidenceLabel(result.assessment.imageEvidence);
  $("#extension-id").textContent = `${result.relay?.handoffCode || result.extensionCase.id} · ${result.case.id}`;
  $("#pos-receipt").textContent = result.receipt
    ? `POS Gate ${result.receipt.receiptId} · ${result.receipt.invoiceId} · sale ${result.receipt.saleAuthorization.replaceAll("_", " ").toLowerCase()}.`
    : "Case Desk path used. The POS Gate API can return the same no-release receipt to a billing system.";
  $("#case-number").textContent = result.case.id;
  $("#sale-preview").className = "sale-preview held";
  $("#sale-preview").innerHTML = paused ? "<span class=\"dot\"></span><span>Invoice blocked — relay required</span>" : "<span class=\"dot\"></span><span>Invoice NOT RELEASED — reviewer required</span>";
  renderDecisionRoom(result);
  renderPosReceipt(result.receipt, result.auditProof);
  renderAuditProof(result.auditProof);
  resultPanel.classList.remove("hidden");
  setWorkflowStage("relay");
  selectedRelayId = result.case.id;
  loadFieldMemory(result.case.field);
  loadRelay(result.case.id);
  setTimeout(() => resultPanel.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
}

async function submitEvidenceRelay(button = $(".primary-button", form)) {
  const originalLabel = button.innerHTML;
  if (draftCopiedToFields && !$("#draft-source-confirmed").checked) {
    $("#voice-status").textContent = "Confirm the copied evidence draft before opening the relay.";
    return;
  }
  button.disabled = true;
  button.innerHTML = "<span>Building evidence relay…</span><strong>◌</strong>";
  setWorkflowStage("gate");
  try {
    const response = await fetch("/api/pos/gate-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoiceId: newInvoiceId(), case: dataFromForm() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The evidence gate could not be reached.");
    renderResult(result);
  } catch (error) {
    $("#result-summary").textContent = error.message;
    resultPanel.classList.remove("hidden");
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
}

async function assess(event) {
  event.preventDefault();
  await submitEvidenceRelay();
}

async function runBypassProof() {
  const button = $("#run-bypass-proof");
  const reset = await resetDemoLedger({ confirm: false });
  if (!reset) return;
  // This deliberately contradicts the seeded field outcome. The server must
  // still find Evidence Debt and return NOT_RELEASED from the real POS gate.
  form.elements.previousInputFailed.checked = false;
  $("#form-footnote").textContent = "Bypass proof running: the dealer says the prior input did not fail. The server will check Field Memory independently.";
  await submitEvidenceRelay(button);
}

function relayPhaseLabel(phase) {
  return ({ DEALER_INTAKE: "COUNTER BLOCK", FIELD_CAPTURE: "FIELD CAPTURE", EXTENSION_REVIEW: "EXTENSION REVIEW" })[phase] || "EVIDENCE RELAY";
}

function openTasks(record) {
  return (record.relay?.tasks || []).filter((task) => task.status !== "EVIDENCE_RECEIVED");
}

function isNamedDemoReviewer(value = "") {
  const normalized = String(value).trim().toLowerCase();
  return normalized.length >= 3 && !["extension desk", "extension review", "reviewer", "unassigned", "unknown", "synthetic reviewer"].includes(normalized);
}

function reviewDispositionLabel(disposition) {
  return disposition === "ESCALATE" ? "Escalate to qualified authority" : "Manual POS decision required";
}

function invalidateReviewAttestationPreview(caseId = null) {
  if (!caseId || reviewAttestationPreviewCaseId === caseId) {
    reviewAttestationPreview = null;
    reviewAttestationPreviewCaseId = null;
  }
  if (!caseId || reviewAttestationPreviewErrorCaseId === caseId) {
    reviewAttestationPreviewError = null;
    reviewAttestationPreviewErrorCaseId = null;
  }
  if (!caseId || reviewAttestationVerificationCaseId === caseId) {
    reviewAttestationVerification = null;
    reviewAttestationVerificationCaseId = null;
  }
  if (!caseId || reviewAttestationConfirmationCaseId === caseId) {
    reviewAttestationConfirmationCaseId = null;
  }
}

function currentReviewAttestationPreview(record) {
  return reviewAttestationPreviewCaseId === record?.id ? reviewAttestationPreview : null;
}

function renderReviewAttestation(record) {
  const panel = $("#review-attestation");
  const reviewerInput = $("#attestation-reviewer");
  const dispositionInput = $("#attestation-disposition");
  const noteInput = $("#attestation-note");
  const confirmedInput = $("#attestation-confirmed");
  const previewButton = $("#refresh-attestation");
  const attestButton = $("#record-attestation");
  const ownerButton = $("#take-ownership");
  const status = $("#attestation-status");
  const help = $("#attestation-help");
  const previewNode = $("#attestation-preview");

  if (!record) {
    [reviewerInput, dispositionInput, noteInput, confirmedInput, previewButton, attestButton, ownerButton].forEach((control) => { control.disabled = true; });
    panel.classList.remove("ready-for-attestation");
    ownerButton.classList.add("hidden");
    status.textContent = "NOT RELEASED";
    status.className = "waiting";
    help.textContent = "Select a case after it reaches extension review to create a non-authorizing review record.";
    previewNode.className = "attestation-preview";
    previewNode.textContent = "No review preview loaded. The current invoice remains NOT RELEASED.";
    reviewAttestationConfirmationCaseId = null;
    reviewAttestationReviewerCaseId = null;
    return;
  }

  const relay = record.relay || {};
  const attestation = record.reviewAttestation;
  const reviewReady = relay.phase === "EXTENSION_REVIEW";
  const tasksComplete = openTasks(record).length === 0;
  const assignedReviewer = relay.owner?.role === "EXTENSION_REVIEW" && isNamedDemoReviewer(relay.owner?.name)
    ? relay.owner.name
    : "";
  const existingInput = reviewerInput.value.trim();
  if (attestation) {
    reviewerInput.value = attestation.reviewerName;
    reviewAttestationReviewerCaseId = record.id;
  } else if (reviewAttestationReviewerCaseId !== record.id) {
    reviewerInput.value = assignedReviewer || "Riya Shah (demo reviewer)";
    reviewAttestationReviewerCaseId = record.id;
  } else if (!existingInput) {
    reviewerInput.value = assignedReviewer || "Riya Shah (demo reviewer)";
  }

  const requestedReviewer = reviewerInput.value.trim();
  const requesterIsNamed = isNamedDemoReviewer(requestedReviewer);
  const ownerMatchesRequested = Boolean(assignedReviewer && assignedReviewer === requestedReviewer);
  const preview = currentReviewAttestationPreview(record);
  const previewEligible = Boolean(preview?.eligible && preview?.evidenceDigest && preview?.auditAnchor?.headHash);
  const frozen = Boolean(attestation);
  const revealControls = frozen || (reviewReady && tasksComplete);
  panel.classList.toggle("ready-for-attestation", revealControls);
  ownerButton.classList.toggle("hidden", !revealControls);

  if (!attestation && reviewAttestationConfirmationCaseId !== record.id) {
    confirmedInput.checked = false;
    reviewAttestationConfirmationCaseId = record.id;
  }
  reviewerInput.disabled = !reviewReady || frozen;
  dispositionInput.disabled = !reviewReady || frozen;
  noteInput.disabled = !reviewReady || frozen;
  confirmedInput.disabled = !reviewReady || frozen;
  if (attestation) confirmedInput.checked = true;

  ownerButton.disabled = !reviewReady || frozen || !requesterIsNamed || ownerMatchesRequested;
  ownerButton.textContent = !reviewReady
    ? "Complete capture tasks first"
    : frozen
      ? "Attestation sealed — not released"
      : !requesterIsNamed
        ? "Enter a named demo reviewer"
        : ownerMatchesRequested
          ? "Demo reviewer assigned"
          : "Assign demo reviewer";

  previewButton.disabled = !reviewReady || !tasksComplete || !ownerMatchesRequested || frozen;
  previewButton.textContent = frozen ? "Attestation sealed" : "Load sealed review preview";
  attestButton.disabled = !previewEligible || !confirmedInput.checked || !ownerMatchesRequested || frozen;
  attestButton.textContent = frozen ? "Non-authorizing attestation sealed" : "Record non-authorizing attestation";

  if (attestation) {
    status.textContent = "ATTESTED · NOT RELEASED";
    status.className = "attested";
    help.textContent = `A named demo reviewer bound the packet at ${dateLabel(attestation.reviewedAt, true)}. The invoice remains NOT RELEASED.`;
    const verified = reviewAttestationVerificationCaseId === record.id ? reviewAttestationVerification : null;
    const verificationLabel = verified?.valid ? "server verification valid" : "server enforces verification before any outcome";
    previewNode.className = "attestation-preview attested";
    previewNode.textContent = `ATTESTED · ${reviewDispositionLabel(attestation.disposition)} · invoice ${attestation.invoiceId || "—"} · evidence ${shortHash(attestation.evidenceDigest)} · ${attestation.ledgerEntryId || "audit link stored"} · ${verificationLabel} · authorization NOT_RELEASED`;
    return;
  }

  if (!reviewReady) {
    status.textContent = "WAITING FOR EVIDENCE";
    status.className = "waiting";
    help.textContent = "Next required: record every field-evidence task. No model, task, or reviewer can release the invoice.";
  } else if (!ownerMatchesRequested) {
    status.textContent = "ASSIGN REVIEWER";
    status.className = "waiting";
    help.textContent = "Assign the named demo reviewer before requesting a sealed packet preview.";
  } else if (previewEligible) {
    status.textContent = "READY TO ATTEST";
    status.className = "ready";
    help.textContent = "The displayed evidence and audit head are sealed into this attestation. It remains a non-authorizing record.";
  } else {
    status.textContent = "NOT RELEASED";
    status.className = "waiting";
    help.textContent = "Load the current sealed preview before recording the human review attestation.";
  }

  if (reviewAttestationPreviewErrorCaseId === record.id && reviewAttestationPreviewError) {
    previewNode.className = "attestation-preview warning";
    previewNode.textContent = reviewAttestationPreviewError;
  } else if (preview) {
    previewNode.className = `attestation-preview ${previewEligible ? "ready" : "warning"}`;
    const issues = preview.issues?.length ? ` · ${preview.issues.join(" ")}` : "";
    previewNode.textContent = `${previewEligible ? "SEALED PREVIEW READY" : "PREVIEW NOT ELIGIBLE"} · ${preview.evidence?.received ?? 0}/${preview.evidence?.total ?? 0} evidence items · invoice ${preview.invoiceId || "missing"} · evidence ${shortHash(preview.evidenceDigest)} · audit head ${shortHash(preview.auditAnchor?.headHash)} · authorization ${preview.saleAuthorization || "NOT_RELEASED"}${issues}`;
  } else {
    previewNode.className = "attestation-preview";
    previewNode.textContent = "No review preview loaded. The current invoice remains NOT RELEASED.";
  }
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
  return events.slice(0, 8).map((event) => {
    const proof = event.ledgerSequence
      ? `<em class="audit-event-proof">${escapeHtml(`L-${String(event.ledgerSequence).padStart(8, "0")} · ${shortHash(event.hash)} · linked`)}</em>`
      : "";
    return `<div class="audit-event ${escapeHtml(event.kind || "relay")}"><span>${escapeHtml(dateLabel(event.at, true))}</span><i></i><div><b>${escapeHtml(event.event)}</b><small>${escapeHtml(event.actor)}</small><p>${escapeHtml(event.detail)}</p>${proof}</div></div>`;
  }).join("");
}

function fieldCaptureLinkKey(caseId, taskId) {
  return `${caseId}:${taskId}`;
}

function fieldCaptureReceiptLabel(task) {
  const receipt = task.fieldCapture;
  if (!receipt) return "";
  const image = receipt.image
    ? ` · image receipt ${escapeHtml(receipt.image.mediaType)} · SHA-256 ${escapeHtml(shortHash(receipt.image.sha256))}`
    : " · observation receipt";
  return `<small class="mobile-capture-receipt">Mobile receipt recorded${image} · raw image bytes were not retained · invoice still ON HOLD</small>`;
}

function renderRelayTask(record, task) {
  const received = task.status === "EVIDENCE_RECEIVED";
  const isMobileCaptureTask = task.ownerRole === "FIELD_CAPTURE";
  const link = fieldCaptureLinks.get(fieldCaptureLinkKey(record.id, task.id));
  let actions = "";

  if (received) {
    actions = "<button class=\"task-action\" disabled>Received</button>";
  } else if (isMobileCaptureTask) {
    actions = `<div class="mobile-capture-actions">${link
      ? `<button class="task-action" data-copy-field-capture-link="${escapeHtml(task.id)}">Copy secure mobile link</button><a class="task-action mobile-capture-open" href="${escapeHtml(link.fieldCaptureUrl)}" target="_blank" rel="noopener">Open capture screen</a><small>One-time link · expires ${escapeHtml(dateLabel(link.expiresAt, true))}</small>`
      : `<button class="task-action mobile-capture-link" data-field-capture-link="${escapeHtml(task.id)}">Generate secure mobile link</button>`}<small>Required image evidence can only be submitted through this one-time Field Capture link.</small></div>`;
  } else {
    actions = `<button class="task-action" data-task-id="${escapeHtml(task.id)}">Record evidence</button>`;
  }

  return `<div class="relay-task ${received ? "complete" : ""}"><span>${received ? "✓" : "→"}</span><div><b>${escapeHtml(task.title)}</b><small>${escapeHtml(task.ownerRole.replaceAll("_", " "))} · due ${escapeHtml(dateLabel(task.dueAt, true))}</small>${task.note ? `<p>${escapeHtml(task.note)}</p>` : ""}${fieldCaptureReceiptLabel(task)}</div>${actions}</div>`;
}

function renderRelayDetail() {
  const record = relayCases.find((item) => item.id === selectedRelayId) || relayCases[0];
  if (!record) {
    $("#relay-case-title").textContent = "No relay cases yet";
    $("#relay-case-meta").textContent = "Open an evidence case from Case intake to create the first handoff.";
    $("#relay-phase").textContent = "WAITING";
    $("#relay-invoice-state").textContent = "NOT RELEASED";
    $("#relay-invoice-copy").textContent = "Every relay stage preserves the POS no-release boundary.";
    $("#handoff-code").textContent = "—";
    $("#relay-sla").textContent = "—";
    $("#handoff-message").textContent = "No handoff selected.";
    $("#relay-next").innerHTML = "<span>NEXT REQUIRED</span><b>Open a relay case to see the exact evidence work.</b><p>No model, task, or reviewer can release the invoice.</p>";
    $("#relay-task-list").innerHTML = "";
    $("#relay-audit").innerHTML = "<p>Select a case to inspect each policy and handoff event.</p>";
    renderAuditProof(null);
    $("#outcome-state").disabled = true;
    $("#outcome-note").disabled = true;
    $("#record-outcome").disabled = true;
    $("#outcome-help").textContent = "Select a case after it reaches extension review to record an observed field outcome.";
    renderReviewAttestation(null);
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
  $("#relay-invoice-state").textContent = "NOT RELEASED";
  $("#relay-invoice-copy").textContent = `${record.externalInvoiceId || "This counter invoice"} remains outside MittiGuard release authority at every relay stage.`;
  $("#handoff-message").textContent = relay.handoffMessage || "Handoff message unavailable.";
  $("#copy-handoff").disabled = false;
  const nextStep = remaining.length
    ? { title: remaining[0].title, detail: `${remaining.length} evidence task${remaining.length === 1 ? "" : "s"} remain. Recording evidence only moves the relay; it cannot release the invoice.` }
    : record.reviewAttestation
      ? { title: "Record a neutral field outcome", detail: "The sealed review is complete. An observation can improve future Field Memory, never this sale authorization." }
      : { title: "Assign and attest a named reviewer", detail: "The evidence packet is complete, but the invoice stays NOT RELEASED until a qualified reviewer records a non-authorizing attestation." };
  $("#relay-next").innerHTML = `<span>NEXT REQUIRED</span><b>${escapeHtml(nextStep.title)}</b><p>${escapeHtml(nextStep.detail)}</p>`;
  $("#relay-task-list").innerHTML = relay.tasks?.map((task) => renderRelayTask(record, task)).join("") || "<p>No evidence tasks are pending.</p>";
  const outcomeReady = relay.phase === "EXTENSION_REVIEW" && Boolean(record.reviewAttestation);
  const fieldOutcome = record.fieldOutcome;
  $("#outcome-state").disabled = !outcomeReady;
  $("#outcome-note").disabled = !outcomeReady;
  $("#record-outcome").disabled = !outcomeReady;
  $("#outcome-state").value = fieldOutcome?.state || "NOT_IMPROVED";
  $("#outcome-note").value = fieldOutcome?.note || "";
  $("#record-outcome").textContent = fieldOutcome ? "Update observed outcome" : "Record observed outcome";
  $("#outcome-help").textContent = !outcomeReady
    ? "A valid human review attestation is required before Field Memory can record an outcome. The invoice remains NOT RELEASED."
    : fieldOutcome
      ? `Recorded ${dateLabel(fieldOutcome.recordedAt, true)}. This observation changes future field-memory checks, not this sale state.`
      : "Extension review can write a neutral observation into Field Memory. This cannot release the current sale.";
  renderReviewAttestation(record);
  $("#relay-audit").innerHTML = renderAudit(relay.audit);
  loadAuditProof(record.id);
  $$("[data-task-id]").forEach((button) => button.addEventListener("click", () => completeTask(button.dataset.taskId)));
  $$("[data-field-capture-link]").forEach((button) => button.addEventListener("click", () => issueFieldCaptureLink(button.dataset.fieldCaptureLink)));
  $$("[data-copy-field-capture-link]").forEach((button) => button.addEventListener("click", () => copyFieldCaptureLink(button.dataset.copyFieldCaptureLink)));
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
    fieldCaptureLinks.delete(fieldCaptureLinkKey(data.case.id, taskId));
    invalidateReviewAttestationPreview(data.case.id);
    currentCase = data.case;
    renderRelayBoard();
    renderRelayDetail();
    loadFieldMemory(data.case.field);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = error.message; }
  }
}

async function issueFieldCaptureLink(taskId) {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record) return;
  const button = $(`[data-field-capture-link="${taskId}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "Creating secure link…";
  }
  try {
    const response = await fetch(`/api/cases/${encodeURIComponent(record.id)}/tasks/${encodeURIComponent(taskId)}/field-capture-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttlMinutes: 30 })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to create a Field Capture link.");
    fieldCaptureLinks.set(fieldCaptureLinkKey(record.id, taskId), data);
    await loadRelay(record.id);
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = error.message;
    }
  }
}

async function copyFieldCaptureLink(taskId) {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  const link = record && fieldCaptureLinks.get(fieldCaptureLinkKey(record.id, taskId));
  if (!link?.fieldCaptureUrl) return;
  const button = $(`[data-copy-field-capture-link="${taskId}"]`);
  try {
    await navigator.clipboard?.writeText(link.fieldCaptureUrl);
    if (button) button.textContent = "Secure link copied";
  } catch {
    window.prompt("Copy this one-time Field Capture link:", link.fieldCaptureUrl);
  }
  setTimeout(() => {
    if (button) button.textContent = "Copy secure mobile link";
  }, 1700);
}

async function loadReviewAttestationPreview() {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record || record.reviewAttestation) return;
  const button = $("#refresh-attestation");
  button.disabled = true;
  button.textContent = "Loading sealed preview…";
  try {
    const response = await fetch(`/api/cases/${record.id}/review-attestation/preview`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load the review attestation preview.");
    reviewAttestationPreview = data.preview;
    reviewAttestationPreviewCaseId = record.id;
    reviewAttestationPreviewError = null;
    reviewAttestationPreviewErrorCaseId = null;
    renderRelayDetail();
  } catch (error) {
    reviewAttestationPreview = null;
    reviewAttestationPreviewCaseId = record.id;
    reviewAttestationPreviewError = error.message;
    reviewAttestationPreviewErrorCaseId = record.id;
    renderRelayDetail();
  }
}

async function acknowledgeExtensionReview() {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record) return;
  const reviewerName = $("#attestation-reviewer").value.trim();
  if (!isNamedDemoReviewer(reviewerName)) {
    reviewAttestationPreviewError = "Enter a named demo reviewer before assigning extension-review ownership.";
    reviewAttestationPreviewErrorCaseId = record.id;
    renderReviewAttestation(record);
    return;
  }
  const button = $("#take-ownership");
  button.disabled = true;
  button.textContent = "Assigning reviewer…";
  try {
    const response = await fetch(`/api/cases/${record.id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "EXTENSION_REVIEW", name: reviewerName }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to assign reviewer ownership.");
    const index = relayCases.findIndex((item) => item.id === data.case.id);
    if (index >= 0) relayCases[index] = data.case;
    invalidateReviewAttestationPreview(data.case.id);
    renderRelayBoard();
    renderRelayDetail();
    await loadReviewAttestationPreview();
  } catch (error) {
    reviewAttestationPreviewError = error.message;
    reviewAttestationPreviewErrorCaseId = record.id;
    renderReviewAttestation(record);
  }
}

async function recordReviewAttestation() {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record || record.reviewAttestation) return;
  const preview = currentReviewAttestationPreview(record);
  if (!preview?.eligible || !preview.evidenceDigest || !preview.auditAnchor?.headHash) {
    await loadReviewAttestationPreview();
    return;
  }
  const reviewerName = $("#attestation-reviewer").value.trim();
  if (reviewerName !== preview.reviewerName) {
    reviewAttestationPreviewError = "The attesting reviewer must exactly match the assigned extension-review owner. Reassign the reviewer or reload the preview.";
    reviewAttestationPreviewErrorCaseId = record.id;
    renderReviewAttestation(record);
    return;
  }
  if (!$("#attestation-confirmed").checked) {
    reviewAttestationPreviewError = "Confirm that the displayed evidence packet was reviewed before recording the attestation.";
    reviewAttestationPreviewErrorCaseId = record.id;
    renderReviewAttestation(record);
    return;
  }
  const button = $("#record-attestation");
  button.disabled = true;
  button.textContent = "Sealing attestation…";
  try {
    const response = await fetch(`/api/cases/${record.id}/review-attestation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewerName,
        disposition: $("#attestation-disposition").value,
        note: $("#attestation-note").value,
        confirmed: true,
        expectedEvidenceDigest: preview.evidenceDigest,
        expectedAuditHeadHash: preview.auditAnchor.headHash
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to seal the human review attestation.");
    const index = relayCases.findIndex((item) => item.id === data.case.id);
    if (index >= 0) relayCases[index] = data.case;
    currentCase = data.case;
    invalidateReviewAttestationPreview(data.case.id);
    reviewAttestationVerification = data.verification || null;
    reviewAttestationVerificationCaseId = data.case.id;
    renderRelayBoard();
    renderRelayDetail();
    loadFieldMemory(data.case.field);
  } catch (error) {
    reviewAttestationPreviewError = error.message;
    reviewAttestationPreviewErrorCaseId = record.id;
    renderReviewAttestation(record);
  }
}

async function recordFieldOutcome() {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record) return;
  const button = $("#record-outcome");
  button.disabled = true;
  button.textContent = "Writing outcome…";
  try {
    const response = await fetch(`/api/cases/${record.id}/field-outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: $("#outcome-state").value, note: $("#outcome-note").value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to record the observed outcome.");
    const index = relayCases.findIndex((item) => item.id === data.case.id);
    if (index >= 0) relayCases[index] = data.case;
    renderRelayBoard();
    renderRelayDetail();
    loadFieldMemory(data.case.field);
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
  setTimeout(() => { $("#copy-handoff").textContent = "Copy handoff message"; }, 1700);
}

async function copyPosReceipt() {
  const text = latestReceipt
    ? JSON.stringify(latestReceipt, null, 2)
    : $("#pos-receipt-json").textContent;
  try {
    await navigator.clipboard?.writeText(text);
    $("#copy-pos-receipt").textContent = "Receipt copied";
  } catch {
    window.prompt("Copy this POS response:", text);
  }
  setTimeout(() => { $("#copy-pos-receipt").textContent = "Copy receipt"; }, 1700);
}

function togglePosReceiptJson() {
  const json = $("#pos-receipt-json");
  const isHidden = json.classList.toggle("hidden");
  $("#toggle-pos-json").textContent = isHidden ? "View contract JSON" : "Hide contract JSON";
}

async function runSafetyReplay() {
  const button = $("#run-safety-replay");
  const panel = $("#safety-replay");
  button.disabled = true;
  button.textContent = "Running server replay…";
  panel.classList.remove("hidden");
  $("#safety-replay-title").textContent = "Replaying deterministic controls…";
  $("#safety-replay-copy").textContent = "No model is asked to decide a sale during this evaluation.";
  $("#safety-replay-result").textContent = "RUNNING";
  $("#safety-replay-grid").innerHTML = "";
  try {
    const response = await fetch("/api/evaluation/replay");
    const replay = await response.json();
    if (!response.ok) throw new Error(replay.error || "Safety replay is unavailable.");
    $("#safety-replay-title").textContent = `${replay.passedCount} / ${replay.total} deterministic checks passed`;
    $("#safety-replay-copy").textContent = replay.scope;
    $("#safety-replay-result").textContent = replay.passed ? "VERIFIED" : "CHECK FAILED";
    $("#safety-replay-result").className = replay.passed ? "verified" : "warning";
    $("#safety-replay-grid").innerHTML = (replay.groups || []).map((group) => `<article class="replay-row ${group.passed ? "pass" : "fail"}"><i>${group.passed ? "✓" : "!"}</i><div><b>${escapeHtml(group.label)}</b><p>${escapeHtml(group.detail)}</p></div><strong>${escapeHtml(`${group.passedCount} / ${group.total}`)}</strong></article>`).join("");
    if (replay.passed) {
      $("#bench-score").textContent = `${replay.passedCount} / ${replay.total}`;
      $("#bench-score-copy").textContent = "Server replay: zero paths to sale approval.";
    }
  } catch (error) {
    $("#safety-replay-title").textContent = "Safety replay could not complete";
    $("#safety-replay-copy").textContent = error.message;
    $("#safety-replay-result").textContent = "UNAVAILABLE";
    $("#safety-replay-result").className = "warning";
  } finally {
    button.disabled = false;
    button.textContent = "Run 45-check safety replay";
  }
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
    const path = health.liveProviderEnabled ? `${health.runtimeProvider} evidence path active` : "Deterministic demo path active";
    $("#model-status").textContent = health.deploymentMode === "jury-demo" ? `${path} · jury demo` : path;
    $("#new-live-case").textContent = health.deploymentMode === "jury-demo" ? "+ Blank synthetic case" : "+ New case";
    const ledger = health.auditLedger || {};
    $("#ledger-status").textContent = ledger.valid && ledger.sealed
      ? "HMAC-SEALED AUDIT LEDGER"
      : ledger.valid
        ? "DEMO HASH-CHAIN LEDGER"
        : "AUDIT LEDGER NEEDS VERIFICATION";
  } catch {
    $("#model-status").textContent = "Offline demo path";
    $("#new-live-case").textContent = "+ Blank synthetic case";
    $("#ledger-status").textContent = "AUDIT LEDGER UNAVAILABLE";
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
    photoLabel.textContent = demoMode ? "No field image attached — Field Capture will request one" : "Attach a whole-plant or close-up image";
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
$("#start-jury-demo").addEventListener("click", resetDemoLedger);
$("#run-bypass-proof").addEventListener("click", runBypassProof);
$("#reset-demo-ledger").addEventListener("click", resetDemoLedger);
$("#new-live-case").addEventListener("click", startLiveCase);
$("#refresh-relay").addEventListener("click", () => loadRelay(selectedRelayId));
$("#voice-capture").addEventListener("click", startVoiceCapture);
$("#extract-intake").addEventListener("click", extractIntakeDraft);
$("#apply-intake-draft").addEventListener("click", applyIntakeDraft);
$$(".nav-item").forEach((item) => item.addEventListener("click", () => switchSection(item.dataset.section)));
$$("[data-section-target]").forEach((item) => item.addEventListener("click", () => switchSection(item.dataset.sectionTarget)));
$("#copy-handoff").addEventListener("click", copyHandoff);
$("#copy-pos-receipt").addEventListener("click", copyPosReceipt);
$("#toggle-pos-json").addEventListener("click", togglePosReceiptJson);
$("#take-ownership").addEventListener("click", acknowledgeExtensionReview);
$("#attestation-reviewer").addEventListener("input", () => {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (!record || record.reviewAttestation) return;
  invalidateReviewAttestationPreview(record.id);
  renderReviewAttestation(record);
});
$("#attestation-confirmed").addEventListener("change", () => {
  const record = relayCases.find((item) => item.id === selectedRelayId);
  if (record) renderReviewAttestation(record);
});
$("#refresh-attestation").addEventListener("click", loadReviewAttestationPreview);
$("#record-attestation").addEventListener("click", recordReviewAttestation);
$("#record-outcome").addEventListener("click", recordFieldOutcome);
$("#run-safety-replay").addEventListener("click", runSafetyReplay);
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
