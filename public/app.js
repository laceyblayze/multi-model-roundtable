const messagesEl = document.querySelector("#messages");
const statusEl = document.querySelector("#status");
const usageEl = document.querySelector("#usage");
const nextSpeakerEl = document.querySelector("#nextSpeaker");
const composer = document.querySelector("#composer");
const messageText = document.querySelector("#messageText");
const nextTurnButton = document.querySelector("#nextTurn");
const runRoundButton = document.querySelector("#runRound");
const resetButton = document.querySelector("#reset");
const logoutButton = document.querySelector("#logout");
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
  if (!text) return;
  try {
    await post("/api/message", { text });
    messageText.value = "";
    await refresh();
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
  resetButton.disabled = !state.authenticated;
  logoutButton.disabled = !state.authenticated;
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
    </article>
  `;
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

function formatRemaining(remaining, total) {
  if (remaining === undefined || total === undefined) return "-";
  return `${remaining} / ${total}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
