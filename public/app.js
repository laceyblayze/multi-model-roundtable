const messagesEl = document.querySelector("#messages");
const statusEl = document.querySelector("#status");
const usageEl = document.querySelector("#usage");
const nextSpeakerEl = document.querySelector("#nextSpeaker");
const composer = document.querySelector("#composer");
const messageText = document.querySelector("#messageText");
const attachmentTray = document.querySelector("#attachmentTray");
const nextTurnButton = document.querySelector("#nextTurn");
const runRoundButton = document.querySelector("#runRound");
const resetButton = document.querySelector("#reset");
const logoutButton = document.querySelector("#logout");
const exportTranscriptButton = document.querySelector("#exportTranscript");
const turnInputs = [...document.querySelectorAll('input[type="checkbox"]')];
const gate = document.querySelector("#gate");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const passwordInput = document.querySelector("#password");
const adminLogin = document.querySelector("#adminLogin");
const adminPassword = document.querySelector("#adminPassword");
const adminControls = document.querySelector("#adminControls");
const adminStatus = document.querySelector("#adminStatus");
const modelTurnsLimit = document.querySelector("#modelTurnsLimit");
const userMessagesLimit = document.querySelector("#userMessagesLimit");
const transcriptLimit = document.querySelector("#transcriptLimit");
const saveLimitsButton = document.querySelector("#saveLimits");
const clearTranscriptButton = document.querySelector("#clearTranscript");
const clearSessionsButton = document.querySelector("#clearSessions");

let state = null;
let adminState = null;
let pendingAttachments = [];

await refresh();
await refreshAdmin();

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  try {
    await post("/api/login", { password: passwordInput.value });
    passwordInput.value = "";
    await refresh();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

adminLogin.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminStatus.textContent = "";
  try {
    adminState = await postAdmin("/api/admin/login", { password: adminPassword.value });
    adminPassword.value = "";
    renderAdmin();
  } catch (error) {
    adminStatus.textContent = error.message;
  }
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageText.value.trim();
  if (!text && !pendingAttachments.length) return;
  try {
    await post("/api/message", { text, attachments: pendingAttachments });
    messageText.value = "";
    pendingAttachments = [];
    renderAttachmentTray();
    await refresh();
  } catch (error) {
    showInlineError(error.message);
  }
});

messageText.addEventListener("paste", async (event) => {
  const items = [...(event.clipboardData?.items || [])];
  const imageItems = items.filter((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (!imageItems.length) return;
  event.preventDefault();
  try {
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) pendingAttachments.push(await imageFileToAttachment(file));
    }
    pendingAttachments = pendingAttachments.slice(0, 3);
    renderAttachmentTray();
  } catch (error) {
    showInlineError(error.message);
  }
});

nextTurnButton.addEventListener("click", async () => {
  await runNextTurn();
});

runRoundButton.addEventListener("click", async () => {
  const count = currentTurnOrder().length;
  for (let index = 0; index < count; index += 1) {
    await runNextTurn();
  }
});

resetButton.addEventListener("click", async () => {
  await post("/api/reset", {});
  await refresh();
});

logoutButton.addEventListener("click", async () => {
  await post("/api/logout", {});
  await refresh();
});

exportTranscriptButton.addEventListener("click", async () => {
  await exportTranscript();
});

saveLimitsButton.addEventListener("click", async () => {
  adminStatus.textContent = "";
  try {
    adminState = await postAdmin("/api/admin/limits", {
      modelTurnsPerHour: Number(modelTurnsLimit.value),
      userMessagesPerHour: Number(userMessagesLimit.value),
      maxTranscriptMessages: Number(transcriptLimit.value),
    });
    adminStatus.textContent = "Limits saved.";
    await refresh();
    renderAdmin();
  } catch (error) {
    adminStatus.textContent = error.message;
  }
});

clearTranscriptButton.addEventListener("click", async () => {
  adminStatus.textContent = "";
  try {
    adminState = await postAdmin("/api/admin/clear-transcript", {});
    adminStatus.textContent = "Transcript cleared.";
    await refresh();
    renderAdmin();
  } catch (error) {
    adminStatus.textContent = error.message;
  }
});

clearSessionsButton.addEventListener("click", async () => {
  adminStatus.textContent = "";
  try {
    adminState = await postAdmin("/api/admin/clear-sessions", {});
    adminStatus.textContent = "Other sessions cleared.";
    renderAdmin();
  } catch (error) {
    adminStatus.textContent = error.message;
  }
});

turnInputs.forEach((input) => {
  input.addEventListener("change", render);
});

async function runNextTurn() {
  setBusy(true);
  try {
    await post("/api/next", { turnOrder: currentTurnOrder() });
    await refresh();
  } catch (error) {
    showInlineError(error.message);
  } finally {
    setBusy(false);
  }
}

async function refresh() {
  const response = await fetch("/api/state");
  state = await response.json();
  render();
}

async function refreshAdmin() {
  const response = await fetch("/api/admin");
  adminState = await response.json();
  renderAdmin();
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  state = payload;
  render();
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

async function postAdmin(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Admin request failed.");
  return payload;
}

function render() {
  if (!state) return;
  gate.hidden = Boolean(state.authenticated);
  document.body.classList.toggle("locked", !state.authenticated);
  if (!state.authenticated) {
    loginError.textContent = state.error || "";
    passwordInput.focus();
  }

  const next = state.participants[state.nextSpeaker]?.name || "Choose a model";
  nextSpeakerEl.textContent = state.locked ? "A model is thinking..." : `Next up: ${next}`;

  statusEl.innerHTML = Object.values(state.participants)
    .filter((participant) => participant.role === "model")
    .map((participant) => `
      <div class="status-row">
        <dt>${escapeHtml(participant.name)}</dt>
        <dd>${participant.configured ? escapeHtml(participant.model) : "Needs API key"}</dd>
      </div>
    `)
    .join("");

  usageEl.innerHTML = `
    <div class="status-row">
      <dt>Model turns</dt>
      <dd>${formatRemaining(state.limits?.remainingModelTurns, state.limits?.modelTurnsPerHour)}</dd>
    </div>
    <div class="status-row">
      <dt>Your messages</dt>
      <dd>${formatRemaining(state.limits?.remainingUserMessages, state.limits?.userMessagesPerHour)}</dd>
    </div>
    <div class="status-row">
      <dt>Transcript cap</dt>
      <dd>${state.limits?.maxTranscriptMessages || "-"}</dd>
    </div>
    <div class="status-row">
      <dt>Storage</dt>
      <dd>${state.persistence?.databaseBacked ? "Database" : "Memory"}</dd>
    </div>
  `;

  messagesEl.innerHTML = state.messages.length
    ? state.messages.map(renderMessage).join("")
    : '<p class="empty">Start with a message, then let each model take its turn.</p>';
  messagesEl.scrollTop = messagesEl.scrollHeight;

  const disabled = !state.authenticated || state.locked || !currentTurnOrder().length;
  nextTurnButton.disabled = disabled;
  runRoundButton.disabled = disabled;
  composer.querySelector("button").disabled = !state.authenticated;
  messageText.disabled = !state.authenticated;
  renderAttachmentTray();
  resetButton.disabled = !state.authenticated;
  logoutButton.disabled = !state.authenticated;
  exportTranscriptButton.disabled = !state.authenticated;
}

function renderAdmin() {
  if (!adminState) return;
  const unlocked = Boolean(adminState.adminAuthenticated);
  adminLogin.hidden = unlocked;
  adminControls.hidden = !unlocked;
  if (!unlocked) {
    adminStatus.textContent ||= "";
    return;
  }

  modelTurnsLimit.value = adminState.settings.modelTurnsPerHour;
  userMessagesLimit.value = adminState.settings.userMessagesPerHour;
  transcriptLimit.value = adminState.settings.maxTranscriptMessages;
  adminStatus.textContent ||= `${adminState.transcriptCount} messages, ${adminState.sessionCount} active sessions.`;
}

function renderMessage(message) {
  const participant = state.participants[message.speaker] || { name: message.speaker };
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const content = message.status === "thinking" ? "Thinking..." : message.text;
  return `
    <article class="message ${escapeHtml(message.speaker)} ${escapeHtml(message.status)}">
      <div class="message-header">
        <span class="speaker">${escapeHtml(participant.name)}</span>
        <span class="meta">${message.status === "error" ? "Turn failed" : time}</span>
      </div>
      <div class="content">${escapeHtml(content)}</div>
      ${renderAttachments(message.attachments)}
    </article>
  `;
}

function renderAttachments(attachments = []) {
  if (!attachments.length) return "";
  return `
    <div class="message-attachments">
      ${attachments.map((attachment) => {
        if (attachment.type === "image") {
          return `
            <figure class="message-image">
              <img src="${escapeHtml(attachment.dataUrl)}" alt="${escapeHtml(attachment.name || "Pasted image")}">
              <figcaption>${escapeHtml(attachment.name || "Pasted image")}</figcaption>
            </figure>
          `;
        }
        if (attachment.type === "link") {
          return `
            <div class="message-link ${attachment.error ? "link-error" : ""}">
              <a href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.title || attachment.url)}</a>
              ${attachment.description ? `<p>${escapeHtml(attachment.description)}</p>` : ""}
              ${attachment.text ? `<p>${escapeHtml(truncate(attachment.text, 280))}</p>` : ""}
              ${attachment.error ? `<p>${escapeHtml(attachment.error)}</p>` : ""}
            </div>
          `;
        }
        return "";
      }).join("")}
    </div>
  `;
}

function renderAttachmentTray() {
  if (!attachmentTray) return;
  attachmentTray.hidden = !pendingAttachments.length;
  attachmentTray.innerHTML = pendingAttachments.map((attachment, index) => `
    <div class="pending-attachment">
      <img src="${escapeHtml(attachment.dataUrl)}" alt="${escapeHtml(attachment.name)}">
      <span>${escapeHtml(attachment.name)}</span>
      <button type="button" class="remove-attachment" data-index="${index}" aria-label="Remove ${escapeHtml(attachment.name)}">Remove</button>
    </div>
  `).join("");
  attachmentTray.querySelectorAll(".remove-attachment").forEach((button) => {
    button.addEventListener("click", () => {
      pendingAttachments.splice(Number(button.dataset.index), 1);
      renderAttachmentTray();
    });
  });
}

async function imageFileToAttachment(file) {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowed.has(file.type)) throw new Error("Only PNG, JPEG, WebP, and GIF images can be pasted.");
  if (file.size > 3_500_000) throw new Error("That image is too large. Try a smaller image or screenshot.");
  const dataUrl = await readFileAsDataUrl(file);
  return {
    type: "image",
    name: file.name || `pasted-image-${pendingAttachments.length + 1}`,
    mimeType: file.type,
    dataUrl,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("The pasted image could not be read.")));
    reader.readAsDataURL(file);
  });
}

function currentTurnOrder() {
  return turnInputs.filter((input) => input.checked).map((input) => input.value);
}

function setBusy(isBusy) {
  nextTurnButton.disabled = isBusy;
  runRoundButton.disabled = isBusy;
}

function showInlineError(message) {
  state.messages.push({
    id: `client-${Date.now()}`,
    speaker: "system",
    text: message,
    status: "error",
    createdAt: new Date().toISOString(),
  });
  render();
}

async function exportTranscript() {
  if (!state?.authenticated) return;
  exportTranscriptButton.disabled = true;
  const originalLabel = exportTranscriptButton.textContent;
  exportTranscriptButton.textContent = "Exporting...";
  try {
    const documentHtml = buildTranscriptDocument();
    const filename = `multi-model-roundtable-${new Date().toISOString().slice(0, 10)}.doc`;
    const blob = new Blob([documentHtml], { type: "application/msword;charset=utf-8" });
    await saveTranscriptFile(blob, filename);
  } catch (error) {
    if (error.name === "AbortError") return;
    showInlineError(`Export failed: ${error.message}`);
  } finally {
    exportTranscriptButton.textContent = originalLabel;
    exportTranscriptButton.disabled = !state?.authenticated;
  }
}

function buildTranscriptDocument() {
  const generatedAt = new Date().toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const messages = state.messages || [];
  const body = messages.length
    ? messages.map(renderExportMessage).join("")
    : "<p>No messages have been added yet.</p>";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Multi-Model Roundtable Transcript</title>
    <style>
      body { color: #1d2430; font-family: Arial, sans-serif; line-height: 1.5; margin: 36px; }
      h1 { font-size: 24px; margin: 0 0 8px; }
      .meta { color: #657184; font-size: 12px; margin-bottom: 24px; }
      .message { border-top: 1px solid #d9dee7; padding: 14px 0; }
      .speaker { font-size: 13px; font-weight: 700; letter-spacing: 0.03em; margin-bottom: 6px; text-transform: uppercase; }
      .speaker.user { color: #0e4f44; }
      .speaker.model { color: #1d2430; }
      .time { color: #657184; font-size: 12px; font-weight: 400; text-transform: none; }
      .content { white-space: pre-wrap; }
      .attachment { margin-top: 10px; padding: 10px; border: 1px solid #d9dee7; }
      .attachment-title { font-weight: 700; }
      .attachment img { display: block; max-width: 520px; max-height: 420px; margin-top: 8px; }
      .error { color: #b42318; }
    </style>
  </head>
  <body>
    <h1>Multi-Model Roundtable Transcript</h1>
    <div class="meta">Exported ${escapeHtml(generatedAt)} · ${messages.length} messages</div>
    ${body}
  </body>
</html>`;
}

function renderExportMessage(message) {
  const participant = state.participants[message.speaker] || { name: message.speaker, role: "system" };
  const isUser = message.speaker === "user";
  const roleLabel = isUser ? "USER" : participant.role === "model" ? "MODEL" : "SYSTEM";
  const speakerLabel = `${roleLabel}: ${participant.name || message.speaker}`;
  const time = message.createdAt
    ? new Date(message.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "";
  const content = message.status === "thinking" ? "Thinking..." : message.text;
  return `
    <section class="message ${message.status === "error" ? "error" : ""}">
      <div class="speaker ${isUser ? "user" : "model"}">${escapeHtml(speakerLabel)} ${time ? `<span class="time">· ${escapeHtml(time)}</span>` : ""}</div>
      <div class="content">${escapeHtml(content || "")}</div>
      ${renderExportAttachments(message.attachments)}
    </section>
  `;
}

function renderExportAttachments(attachments = []) {
  if (!attachments.length) return "";
  return attachments.map((attachment) => {
    if (attachment.type === "image") {
      return `
        <div class="attachment">
          <div class="attachment-title">Image: ${escapeHtml(attachment.name || "Pasted image")}</div>
          <img src="${escapeHtml(attachment.dataUrl)}" alt="${escapeHtml(attachment.name || "Pasted image")}">
        </div>
      `;
    }
    if (attachment.type === "link") {
      return `
        <div class="attachment">
          <div class="attachment-title">Opened web page: <a href="${escapeHtml(attachment.url)}">${escapeHtml(attachment.title || attachment.url)}</a></div>
          ${attachment.description ? `<div>${escapeHtml(attachment.description)}</div>` : ""}
          ${attachment.text ? `<div>${escapeHtml(attachment.text)}</div>` : ""}
          ${attachment.error ? `<div class="error">${escapeHtml(attachment.error)}</div>` : ""}
        </div>
      `;
    }
    return "";
  }).join("");
}

async function saveTranscriptFile(blob, filename) {
  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: "Google Docs compatible document",
        accept: { "application/msword": [".doc"] },
      }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatRemaining(remaining, total) {
  if (remaining === undefined || total === undefined) return "-";
  return `${remaining} / ${total}`;
}

function truncate(value, maxLength) {
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
