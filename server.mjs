import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

loadEnv(join(root, ".env"));

const port = Number(process.env.PORT || 4177);
const sessionSecret = process.env.SESSION_SECRET || "dev-roundtable-secret-change-before-public-deploy";
const authPassword = process.env.ROUNDTABLE_PASSWORD || "";
const authRequired = Boolean(authPassword);
const secureCookies = process.env.NODE_ENV === "production";
const modelTurnsPerHour = Number(process.env.MODEL_TURNS_PER_HOUR || 30);
const userMessagesPerHour = Number(process.env.USER_MESSAGES_PER_HOUR || 120);
const maxTranscriptMessages = Number(process.env.MAX_TRANSCRIPT_MESSAGES || 200);
const sessions = new Map();

validateProductionConfig();

const state = {
  messages: [],
  turnOrder: ["chatgpt", "gemini", "grok"],
  locked: false,
};

const participants = {
  user: { id: "user", name: "You", role: "human" },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    role: "model",
    model: process.env.OPENAI_MODEL || "gpt-5.5",
    keyName: "OPENAI_API_KEY",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    role: "model",
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    keyName: "GEMINI_API_KEY",
  },
  grok: {
    id: "grok",
    name: "Grok",
    role: "model",
    model: process.env.XAI_MODEL || "grok-4.5",
    keyName: "XAI_API_KEY",
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Unexpected server error" });
  }
});

server.listen(port, () => {
  console.log(`Roundtable ready at http://localhost:${port}`);
});

async function routeApi(req, res, url) {
  let session = getSession(req);
  if (!session && !authRequired) {
    session = createSession();
    setSessionCookie(res, session.id);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      authRequired,
      configuredProviders: Object.values(participants)
        .filter((participant) => participant.role === "model" && Boolean(process.env[participant.keyName]))
        .map((participant) => participant.id),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req);
    if (!authRequired) {
      const openSession = createSession();
      setSessionCookie(res, openSession.id);
      sendJson(res, 200, snapshot(openSession));
      return;
    }
    if (String(body.password || "") !== authPassword) {
      sendJson(res, 401, { error: "Incorrect password." });
      return;
    }
    const nextSession = createSession();
    setSessionCookie(res, nextSession.id);
    sendJson(res, 200, snapshot(nextSession));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    clearSessionCookie(res);
    if (session) sessions.delete(session.id);
    sendJson(res, 200, publicSnapshot());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, session ? snapshot(session) : publicSnapshot());
    return;
  }

  if (!session && authRequired) {
    sendJson(res, 401, publicSnapshot("Enter the roundtable password to continue."));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/message") {
    const body = await readJson(req);
    const text = String(body.text || "").trim();
    if (!text) {
      sendJson(res, 400, { error: "Message text is required." });
      return;
    }
    const messageLimit = checkLimit(session, "userMessages", userMessagesPerHour);
    if (!messageLimit.allowed) {
      sendJson(res, 429, snapshot(session, messageLimit.message));
      return;
    }
    state.messages.push(makeMessage("user", text));
    trimTranscript();
    sendJson(res, 200, snapshot(session));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/next") {
    if (state.locked) {
      sendJson(res, 409, { error: "A model is already taking its turn." });
      return;
    }

    const body = await readJson(req);
    if (Array.isArray(body.turnOrder)) {
      state.turnOrder = body.turnOrder.filter((id) => participants[id]?.role === "model");
    }
    if (!state.turnOrder.length) {
      sendJson(res, 400, { error: "Choose at least one model in the turn order." });
      return;
    }
    const turnLimit = checkLimit(session, "modelTurns", modelTurnsPerHour);
    if (!turnLimit.allowed) {
      sendJson(res, 429, snapshot(session, turnLimit.message));
      return;
    }

    state.locked = true;
    const speaker = getNextSpeaker();
    const pending = makeMessage(speaker, "", "thinking");
    state.messages.push(pending);

    try {
      pending.text = await callModel(speaker);
      pending.status = "complete";
      pending.finishedAt = new Date().toISOString();
      trimTranscript();
      sendJson(res, 200, snapshot(session));
    } catch (error) {
      pending.text = error.message || "The model turn failed.";
      pending.status = "error";
      pending.finishedAt = new Date().toISOString();
      sendJson(res, 502, snapshot(session));
    } finally {
      state.locked = false;
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    state.messages = [];
    sendJson(res, 200, snapshot(session));
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function getNextSpeaker() {
  const lastModel = [...state.messages].reverse().find((msg) => participants[msg.speaker]?.role === "model");
  if (!lastModel) return state.turnOrder[0];
  const currentIndex = state.turnOrder.indexOf(lastModel.speaker);
  return state.turnOrder[(currentIndex + 1) % state.turnOrder.length] || state.turnOrder[0];
}

async function callModel(speakerId) {
  if (speakerId === "chatgpt") return callResponsesApi({
    baseUrl: "https://api.openai.com/v1",
    apiKey: requireEnv("OPENAI_API_KEY"),
    model: participants.chatgpt.model,
    prompt: buildPrompt("ChatGPT"),
  });

  if (speakerId === "grok") return callResponsesApi({
    baseUrl: "https://api.x.ai/v1",
    apiKey: requireEnv("XAI_API_KEY"),
    model: participants.grok.model,
    prompt: buildPrompt("Grok"),
  });

  if (speakerId === "gemini") return callGemini(buildPrompt("Gemini"));

  throw new Error(`Unknown speaker: ${speakerId}`);
}

async function callResponsesApi({ baseUrl, apiKey, model, prompt }) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      store: false,
    }),
  });

  const data = await safeJson(response);
  if (!response.ok) throw new Error(extractApiError(data, response.statusText));
  return extractResponseText(data);
}

async function callGemini(prompt) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": requireEnv("GEMINI_API_KEY"),
      "Content-Type": "application/json",
      "Api-Revision": "2026-05-20",
    },
    body: JSON.stringify({
      model: participants.gemini.model,
      store: false,
      input: prompt,
    }),
  });

  const data = await safeJson(response);
  if (!response.ok) throw new Error(extractApiError(data, response.statusText));
  return extractGeminiText(data);
}

function buildPrompt(speakerName) {
  const transcript = state.messages
    .filter((msg) => msg.status !== "thinking")
    .map((msg) => `${participants[msg.speaker]?.name || msg.speaker}: ${msg.text}`)
    .join("\n\n");

  return [
    `You are ${speakerName} in a live roundtable with the user, ChatGPT, Gemini, and Grok.`,
    "Everyone sees the same transcript. It is currently your turn only.",
    "Respond to the conversation so far. You may address other models by name, but do not roleplay or generate their future turns.",
    "Keep the response useful and conversational unless the user asks for something longer.",
    "",
    "Shared transcript:",
    transcript || "No one has spoken yet.",
  ].join("\n");
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const pieces = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") pieces.push(content.text);
    }
  }
  return pieces.join("\n").trim() || "[No text returned]";
}

function extractGeminiText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const pieces = [];
  for (const step of data.steps || []) {
    for (const content of step.content || []) {
      if (typeof content.text === "string") pieces.push(content.text);
    }
  }
  return pieces.join("\n").trim() || "[No text returned]";
}

function extractApiError(data, fallback) {
  return data?.error?.message || data?.message || fallback || "API request failed";
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function publicSnapshot(error = "") {
  return {
    authenticated: false,
    authRequired,
    error,
    locked: false,
    turnOrder: state.turnOrder,
    participants: publicParticipants(),
    messages: [],
    nextSpeaker: state.turnOrder[0],
    limits: {
      modelTurnsPerHour,
      userMessagesPerHour,
      maxTranscriptMessages,
    },
  };
}

function snapshot(session, error = "") {
  return {
    authenticated: true,
    authRequired,
    error,
    locked: state.locked,
    turnOrder: state.turnOrder,
    participants: publicParticipants(),
    messages: state.messages,
    nextSpeaker: state.turnOrder.length ? getNextSpeaker() : null,
    limits: {
      modelTurnsPerHour,
      userMessagesPerHour,
      maxTranscriptMessages,
      remainingModelTurns: remainingLimit(session, "modelTurns", modelTurnsPerHour),
      remainingUserMessages: remainingLimit(session, "userMessages", userMessagesPerHour),
    },
  };
}

function publicParticipants() {
  return Object.fromEntries(Object.entries(participants).map(([id, value]) => [
    id,
    {
      id,
      name: value.name,
      role: value.role,
      model: value.model,
      configured: value.role === "human" || Boolean(process.env[value.keyName]),
    },
  ]));
}

function makeMessage(speaker, text, status = "complete") {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    speaker,
    text,
    status,
    createdAt: new Date().toISOString(),
  };
}

function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, normalizedPath);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  res.end(readFileSync(filePath));
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function createSession() {
  const id = crypto.randomBytes(24).toString("base64url");
  const session = {
    id,
    createdAt: Date.now(),
    usage: {
      modelTurns: [],
      userMessages: [],
    },
  };
  sessions.set(id, session);
  return session;
}

function getSession(req) {
  const cookie = parseCookies(req.headers.cookie || "").roundtable_session;
  if (!cookie) return null;
  const [id, signature] = cookie.split(".");
  if (!id || !signature || sign(id) !== signature) return null;
  return sessions.get(id) || null;
}

function setSessionCookie(res, id) {
  const signed = `${id}.${sign(id)}`;
  const attributes = [
    `roundtable_session=${signed}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=86400",
  ];
  if (secureCookies) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function clearSessionCookie(res) {
  const attributes = [
    "roundtable_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secureCookies) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function parseCookies(header) {
  return Object.fromEntries(header.split(";").map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, value.join("=")];
  }).filter(([key]) => key));
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function checkLimit(session, bucket, maxEvents) {
  pruneUsage(session, bucket);
  if (session.usage[bucket].length >= maxEvents) {
    return {
      allowed: false,
      message: `Usage limit reached. Try again in ${minutesUntilReset(session, bucket)} minutes.`,
    };
  }
  session.usage[bucket].push(Date.now());
  return { allowed: true };
}

function remainingLimit(session, bucket, maxEvents) {
  pruneUsage(session, bucket);
  return Math.max(0, maxEvents - session.usage[bucket].length);
}

function pruneUsage(session, bucket) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  session.usage[bucket] = session.usage[bucket].filter((timestamp) => timestamp > cutoff);
}

function minutesUntilReset(session, bucket) {
  pruneUsage(session, bucket);
  const oldest = session.usage[bucket][0] || Date.now();
  return Math.max(1, Math.ceil((oldest + 60 * 60 * 1000 - Date.now()) / 60000));
}

function trimTranscript() {
  if (state.messages.length > maxTranscriptMessages) {
    state.messages = state.messages.slice(-maxTranscriptMessages);
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    req.on("end", () => {
      if (!raw) resolve({});
      else {
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Invalid JSON body."));
        }
      }
    });
    req.on("error", reject);
  });
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^[']|[']$/g, "").replace(/^[\"]|[\"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Add it to .env or export it before starting the app.`);
  return value;
}

function validateProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = [];
  if (!process.env.ROUNDTABLE_PASSWORD) missing.push("ROUNDTABLE_PASSWORD");
  if (!process.env.SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
  if (!process.env.XAI_API_KEY) missing.push("XAI_API_KEY");
  if (missing.length) {
    throw new Error(`Missing required production env vars: ${missing.join(", ")}`);
  }
}
