const $ = (selector) => document.querySelector(selector);

const token = decodeURIComponent(window.location.hash.replace(/^#/, ""));
const loading = $("#capture-loading");
const content = $("#capture-content");
const success = $("#capture-success");
const error = $("#capture-error");
const form = $("#capture-form");
const submit = $("#capture-submit");
const imageInput = $("#field-image");
const imageStatus = $("#image-status");

function show(element) {
  [loading, content, success, error].forEach((item) => item.classList.add("hidden"));
  element.classList.remove("hidden");
}

function errorMessage(message) {
  $("#error-copy").textContent = message || "It may have expired, been replaced, or already been submitted.";
  show(error);
}

function formatExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Time-bound link";
  return `Expires ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function renderContext(context) {
  $("#task-title").textContent = context.task.title;
  $("#task-expiry").textContent = formatExpiry(context.expiresAt);
  $("#task-field").textContent = context.field;
  $("#task-crop").textContent = `${context.crop} · ${context.cropStage}`;
  $("#task-case").textContent = context.caseReference;
  show(content);
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

async function loadContext() {
  if (!token) {
    errorMessage("This secure link is incomplete. Ask the counter desk to create a new Field Capture link.");
    return;
  }
  try {
    const response = await fetch("/api/field-capture/context", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const body = await responseJson(response);
    if (!response.ok || !body.context) throw new Error(body.error || "This Field Capture link is no longer available.");
    renderContext(body.context);
  } catch (requestError) {
    errorMessage(requestError.message);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be read on this device."));
    image.src = url;
  });
}

async function mobileImageDataUrl(file) {
  if (!file) return null;
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
    throw new Error("Use a PNG, JPEG, GIF, or WebP image.");
  }
  if (file.size > 12_000_000) throw new Error("Choose an image smaller than 12 MB before mobile compression.");
  const sourceUrl = URL.createObjectURL(file);
  try {
    const source = await loadImage(sourceUrl);
    let width = source.naturalWidth || source.width;
    let height = source.naturalHeight || source.height;
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0, width, height);

    let quality = .82;
    let result = canvas.toDataURL("image/jpeg", quality);
    while (result.length > 1_250_000 && quality > .45) {
      quality -= .1;
      result = canvas.toDataURL("image/jpeg", quality);
    }
    if (result.length > 1_250_000) throw new Error("The image is still too large after compression. Choose a closer, simpler photo.");
    return result;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  imageStatus.textContent = file ? `${file.name} selected — compressed before upload` : "No image selected";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const observation = $("#observation").value.trim();
  const file = imageInput.files?.[0];
  if (!observation && !file) {
    imageStatus.textContent = "Add a neutral observation or choose one image.";
    return;
  }
  submit.disabled = true;
  submit.querySelector("span").textContent = "Preparing secure evidence…";
  try {
    const imageDataUrl = await mobileImageDataUrl(file);
    submit.querySelector("span").textContent = "Sending evidence to review…";
    const response = await fetch("/api/field-capture/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ observation, imageDataUrl })
    });
    const body = await responseJson(response);
    if (!response.ok) throw new Error(body.error || "Evidence could not be submitted.");
    $("#success-copy").textContent = `${body.task?.title || "The assigned task"} was received. ${body.notice || "The invoice remains NOT RELEASED."}`;
    show(success);
  } catch (requestError) {
    errorMessage(requestError.message);
  } finally {
    submit.disabled = false;
    submit.querySelector("span").textContent = "Submit evidence for review";
  }
});

loadContext();
