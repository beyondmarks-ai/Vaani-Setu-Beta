import crypto from "crypto";
import { pathToFileURL } from "node:url";
import { createTextTranslator, MAX_MESSAGE_LENGTH, historyPage, callHistoryEntry } from "./messages.js";
import express from "express";
import jwt from "jsonwebtoken";
import { TableClient } from "@azure/data-tables";
import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { AccessToken } from "livekit-server-sdk";
import { WebSocketServer } from "ws";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { TranslationManager } from "./livekitTranslation.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const onlineClients = new Map();
const PORT = process.env.PORT || 8080;
const DEFAULT_LANGUAGE = "en";
const PROTECTED_TERMS_LIMIT = 25;
const PROTECTED_TERM_MAX_LENGTH = 40;
const CALL_TIMEOUT_MS = 60 * 1000;
const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const APP_JWT_SECRET = process.env.APP_JWT_SECRET || process.env.BRIDGE_JWT_SECRET || "dev-only-change-me";
const TOKEN_TTL = "30d";
const VAANI_PREFIX = "0209";
const WEB_PUBSUB_CONNECTION_STRING = process.env.WEB_PUBSUB_CONNECTION_STRING || "";
const WEB_PUBSUB_HUB = process.env.WEB_PUBSUB_HUB || "vaani";
const PUBLIC_BRIDGE_URL = process.env.BRIDGE_PUBLIC_URL || "";
const FIREBASE_SERVICE_ACCOUNT_BASE64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "";
const SARVAM_API_KEY = process.env.SARVAM_API_KEY || "";

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English (India)" },
  { code: "bn", name: "Bengali" },
  { code: "gu", name: "Gujarati" },
  { code: "hi", name: "Hindi" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "or", name: "Odia" },
  { code: "pa", name: "Punjabi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
];
const SARVAM_SPEAKERS = [
  { id: "simran", name: "Simran", gender: "Female" },
  { id: "priya", name: "Priya", gender: "Female" },
  { id: "kavya", name: "Kavya", gender: "Female" },
  { id: "ritu", name: "Ritu", gender: "Female" },
  { id: "ishita", name: "Ishita", gender: "Female" },
  { id: "shubh", name: "Shubh", gender: "Male" },
  { id: "aditya", name: "Aditya", gender: "Male" },
  { id: "anand", name: "Anand", gender: "Male" },
  { id: "rahul", name: "Rahul", gender: "Male" },
  { id: "rohan", name: "Rohan", gender: "Male" },
];
const SUPPORTED_VOICES = SUPPORTED_LANGUAGES.flatMap((language) =>
  SARVAM_SPEAKERS.map((speaker) => ({
    ...speaker,
    name: `${language.name} - ${speaker.name}`,
    languageCode: language.code,
  })),
);
const DEFAULT_VOICE = "simran";

const pubsub = WEB_PUBSUB_CONNECTION_STRING
  ? new WebPubSubServiceClient(WEB_PUBSUB_CONNECTION_STRING, WEB_PUBSUB_HUB)
  : null;
const messaging = createMessaging();
const translationManager = new TranslationManager({
  livekitUrl: LIVEKIT_URL,
  apiKey: LIVEKIT_API_KEY,
  apiSecret: LIVEKIT_API_SECRET,
  sarvamApiKey: SARVAM_API_KEY,
});

let store;
let translateMessage = createTextTranslator(SARVAM_API_KEY);

function json(data) {
  return JSON.stringify(data);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function createMessaging() {
  if (!FIREBASE_SERVICE_ACCOUNT_BASE64) {
    console.warn("FIREBASE_SERVICE_ACCOUNT_BASE64 is not set; push fallback is disabled.");
    return null;
  }

  try {
    const serviceAccount = JSON.parse(Buffer.from(FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"));
    if (getApps().length === 0) initializeApp({ credential: cert(serviceAccount) });
    return getMessaging();
  } catch (error) {
    console.error("Firebase Admin initialization failed; push fallback is disabled.", error);
    return null;
  }
}

function createStore() {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (connectionString) {
    return new AzureTableStore(connectionString);
  }

  console.warn("AZURE_STORAGE_CONNECTION_STRING is not set; using volatile in-memory store.");
  return new MemoryStore();
}

export class AzureTableStore {
  constructor(connectionString) {
    this.users = TableClient.fromConnectionString(connectionString, "VaaniUsers");
    this.emailIndex = TableClient.fromConnectionString(connectionString, "VaaniEmailIndex");
    this.numbers = TableClient.fromConnectionString(connectionString, "VaaniNumbers");
    this.calls = TableClient.fromConnectionString(connectionString, "VaaniCalls");
    this.messages = TableClient.fromConnectionString(connectionString, "VaaniMessages");
    this.pushTokens = TableClient.fromConnectionString(connectionString, "VaaniPushTokens");
  }

  async init() {
    await Promise.all([
      this.users.createTable().catch(ignoreConflict),
      this.emailIndex.createTable().catch(ignoreConflict),
      this.numbers.createTable().catch(ignoreConflict),
      this.calls.createTable().catch(ignoreConflict),
      this.messages.createTable().catch(ignoreConflict),
      this.pushTokens.createTable().catch(ignoreConflict),
    ]);
  }

  async getUser(uid) {
    return getEntityOrNull(this.users, "user", uid);
  }

  async getUserByEmail(email) {
    const index = await getEntityOrNull(this.emailIndex, "email", hash(email));
    if (!index) return null;
    return this.getUser(index.uid);
  }

  async createUser(user) {
    await this.users.createEntity({ partitionKey: "user", rowKey: user.uid, ...user });
    try {
      await this.emailIndex.createEntity({ partitionKey: "email", rowKey: hash(user.email), uid: user.uid, email: user.email });
    } catch (error) {
      await this.users.deleteEntity("user", user.uid).catch(() => {});
      throw error;
    }
    return user;
  }

  async updateUser(uid, updates) {
    const current = await this.getUser(uid);
    if (!current) return null;
    const next = { ...current, ...updates, updatedAt: nowIso() };
    await this.users.updateEntity({ partitionKey: "user", rowKey: uid, ...next }, "Merge");
    return next;
  }

  async reserveNumber(suffix, uid, number) {
    await this.numbers.createEntity({ partitionKey: "number", rowKey: suffix, suffix, uid, number, createdAt: nowIso() });
  }

  async getNumber(suffix) {
    return getEntityOrNull(this.numbers, "number", suffix);
  }

  async createCall(call) {
    await this.calls.createEntity({ partitionKey: "call", rowKey: call.callId, ...serializeCall(call) });
  }

  async getCall(callId) {
    const entity = await getEntityOrNull(this.calls, "call", callId);
    return entity ? deserializeCall(entity) : null;
  }

  async updateCall(callId, updates) {
    const current = await this.getCall(callId);
    if (!current) return null;
    const next = { ...current, ...updates, updatedAt: nowIso() };
    await this.calls.updateEntity({ partitionKey: "call", rowKey: callId, ...serializeCall(next) }, "Merge");
    return next;
  }

  async listCalls(uid) {
    const safeUid = uid.replace(/'/g, "''");
    const entities = this.calls.listEntities({ queryOptions: {
      filter: `PartitionKey eq 'call' and (callerUid eq '${safeUid}' or calleeUid eq '${safeUid}')`,
    } });
    const result = [];
    for await (const entity of entities) result.push(deserializeCall(entity));
    return result;
  }

  async getMessage(senderUid, messageId) {
    return getEntityOrNull(this.messages, senderUid, messageId);
  }

  async createMessage(message) {
    await this.messages.createEntity({ partitionKey: message.senderUid, rowKey: message.messageId, ...message });
  }

  async listMessages(uid) {
    const safeUid = uid.replace(/'/g, "''");
    const entities = this.messages.listEntities({ queryOptions: {
      filter: `senderUid eq '${safeUid}' or recipientUid eq '${safeUid}'`,
    } });
    const result = [];
    for await (const entity of entities) {
      const { partitionKey, rowKey, etag, timestamp, ...message } = entity;
      result.push(message);
    }
    return result;
  }

  async savePushToken(uid, token, platform) {
    await this.pushTokens.upsertEntity({
      partitionKey: uid,
      rowKey: hash(token),
      uid,
      token,
      platform: platform || "android",
      updatedAt: nowIso(),
    }, "Merge");
  }

  async listPushTokens(uid) {
    const tokens = [];
    const safeUid = uid.replace(/'/g, "''");
    const entities = this.pushTokens.listEntities({ queryOptions: { filter: `PartitionKey eq '${safeUid}'` } });
    for await (const entity of entities) {
      if (entity.token) tokens.push(entity);
    }
    return tokens;
  }
}

export class MemoryStore {
  constructor() {
    this.users = new Map();
    this.emailIndex = new Map();
    this.numbers = new Map();
    this.calls = new Map();
    this.messages = new Map();
    this.pushTokens = new Map();
  }

  async init() {}

  async getUser(uid) {
    return this.users.get(uid) || null;
  }

  async getUserByEmail(email) {
    const uid = this.emailIndex.get(email);
    return uid ? this.getUser(uid) : null;
  }

  async createUser(user) {
    if (this.emailIndex.has(user.email)) {
      const error = new Error("Email already exists.");
      error.status = 409;
      throw error;
    }
    this.users.set(user.uid, user);
    this.emailIndex.set(user.email, user.uid);
    return user;
  }

  async updateUser(uid, updates) {
    const current = this.users.get(uid);
    if (!current) return null;
    const next = { ...current, ...updates, updatedAt: nowIso() };
    this.users.set(uid, next);
    return next;
  }

  async reserveNumber(suffix, uid, number) {
    if (this.numbers.has(suffix)) {
      const error = new Error("Number already reserved.");
      error.status = 409;
      throw error;
    }
    this.numbers.set(suffix, { suffix, uid, number, createdAt: nowIso() });
  }

  async getNumber(suffix) {
    return this.numbers.get(suffix) || null;
  }

  async createCall(call) {
    this.calls.set(call.callId, call);
  }

  async getCall(callId) {
    return this.calls.get(callId) || null;
  }

  async updateCall(callId, updates) {
    const current = this.calls.get(callId);
    if (!current) return null;
    const next = { ...current, ...updates, updatedAt: nowIso() };
    this.calls.set(callId, next);
    return next;
  }

  async listCalls(uid) {
    return [...this.calls.values()].filter((call) => call.callerUid === uid || call.calleeUid === uid);
  }

  async getMessage(senderUid, messageId) {
    return this.messages.get(`${senderUid}:${messageId}`) || null;
  }

  async createMessage(message) {
    const key = `${message.senderUid}:${message.messageId}`;
    if (this.messages.has(key)) throwHttp(409, "Message already exists.");
    this.messages.set(key, message);
  }

  async listMessages(uid) {
    return [...this.messages.values()].filter((message) => message.senderUid === uid || message.recipientUid === uid);
  }

  async savePushToken(uid, token, platform) {
    const list = this.pushTokens.get(uid) || [];
    const filtered = list.filter((item) => item.token !== token);
    filtered.push({ uid, token, platform: platform || "android", updatedAt: nowIso() });
    this.pushTokens.set(uid, filtered);
  }

  async listPushTokens(uid) {
    return this.pushTokens.get(uid) || [];
  }
}

async function getEntityOrNull(client, partitionKey, rowKey) {
  try {
    return await client.getEntity(partitionKey, rowKey);
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

function ignoreConflict(error) {
  if (error.statusCode !== 409) throw error;
}

function serializeCall(call) {
  const { participants, callerProtectedTerms, calleeProtectedTerms, ...entity } = call;
  return {
    ...entity,
    participantsJson: json(participants || []),
    callerProtectedTermsJson: json(callerProtectedTerms || []),
    calleeProtectedTermsJson: json(calleeProtectedTerms || []),
  };
}

function deserializeCall(entity) {
  return {
    ...entity,
    callId: entity.callId || entity.rowKey,
    participants: parseJson(entity.participantsJson, []),
    callerProtectedTerms: parseJson(entity.callerProtectedTermsJson, []),
    calleeProtectedTerms: parseJson(entity.calleeProtectedTermsJson, []),
  };
}

function cleanEmail(value) {
  if (typeof value !== "string") throwHttp(400, "Email is required.");
  const email = value.trim().toLowerCase();
  if (!email.includes("@") || email.length > 254) throwHttp(400, "Enter a valid email address.");
  return email;
}

function cleanPassword(value) {
  if (typeof value !== "string" || value.length < 6) throwHttp(400, "Use a password with at least 6 characters.");
  return value;
}

function cleanSuffix(value) {
  if (typeof value !== "string" || !/^\d{2}$/.test(value)) throwHttp(400, "Target suffix must be exactly 2 digits.");
  return value;
}

function cleanCallId(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throwHttp(400, "Invalid call id.");
  return value;
}

function cleanLanguage(value, fieldName) {
  if (typeof value !== "string") throwHttp(400, `${fieldName} is required.`);
  const code = value.trim().toLowerCase();
  if (!SUPPORTED_LANGUAGES.some((language) => language.code === code)) throwHttp(400, `Unsupported ${fieldName}.`);
  return code;
}

function cleanVoice(value) {
  if (typeof value !== "string") return DEFAULT_VOICE;
  const voice = value.trim();
  if (["alloy", "echo", "shimmer"].includes(voice.toLowerCase())) return DEFAULT_VOICE;
  if (/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(voice)) return DEFAULT_VOICE;
  if (!SUPPORTED_VOICES.some((item) => item.id === voice)) throwHttp(400, "Unsupported voice.");
  return voice;
}

function storedLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  return SUPPORTED_LANGUAGES.some((item) => item.code === language) ? language : DEFAULT_LANGUAGE;
}

function storedVoice(value) {
  const voice = String(value || "").trim().toLowerCase();
  return SARVAM_SPEAKERS.some((item) => item.id === voice) ? voice : DEFAULT_VOICE;
}

function cleanProtectedTerms(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throwHttp(400, "Protected terms must be a list.");
  if (value.length > PROTECTED_TERMS_LIMIT) {
    throwHttp(400, `Use at most ${PROTECTED_TERMS_LIMIT} protected terms.`);
  }

  const terms = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") throwHttp(400, "Each protected term must be text.");
    const term = item.replace(/\s+/g, " ").trim();
    if (!term || term.length > PROTECTED_TERM_MAX_LENGTH) {
      throwHttp(400, `Protected terms must be 1-${PROTECTED_TERM_MAX_LENGTH} characters.`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._+\-\/#&()]*$/.test(term)) {
      throwHttp(400, "Protected terms can use English letters, numbers, spaces, and common name punctuation.");
    }
    const key = term.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      terms.push(term);
    }
  }
  return terms;
}

function throwHttp(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash: derived };
}

function verifyPassword(password, user) {
  const candidate = passwordHash(password, user.passwordSalt).hash;
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function publicProfile(user) {
  return {
    uid: user.uid,
    email: user.email,
    suffix: user.suffix,
    number: user.number,
    spokenLanguage: storedLanguage(user.spokenLanguage),
    listenLanguage: storedLanguage(user.listenLanguage),
    messageLanguage: storedLanguage(user.messageLanguage || user.listenLanguage),
    messageTranslationStyle: user.messageTranslationStyle === "mixed" ? "mixed" : "pure",
    preferredVoice: storedVoice(user.preferredVoice),
    protectedTerms: parseJson(user.protectedTermsJson, []),
  };
}

function signUserToken(user) {
  return jwt.sign(
    { sub: user.uid, email: user.email, number: user.number, suffix: user.suffix },
    APP_JWT_SECRET,
    { expiresIn: TOKEN_TTL, audience: "vaani-setu-app", issuer: "vaani-setu-azure" }
  );
}

function verifyUserToken(token) {
  return jwt.verify(token, APP_JWT_SECRET, {
    audience: "vaani-setu-app",
    issuer: "vaani-setu-azure",
  });
}

async function requireUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throwHttp(401, "Sign in before continuing.");
  let claims;
  try { claims = verifyUserToken(token); }
  catch (_) { throwHttp(401, "Session expired. Sign in again."); }
  const user = await store.getUser(claims.sub);
  if (!user) throwHttp(401, "Session expired. Sign in again.");
  return user;
}

async function assignNumber(uid) {
  for (let value = 0; value < 100; value += 1) {
    const suffix = value.toString().padStart(2, "0");
    const number = VAANI_PREFIX + suffix;
    try {
      await store.reserveNumber(suffix, uid, number);
      return { suffix, number };
    } catch (error) {
      if (error.status === 409 || error.statusCode === 409) continue;
      throw error;
    }
  }
  throwHttp(409, "All 100 Vaani Setu numbers are already assigned.");
}

async function getCallForParticipant(callId, uid) {
  const call = await store.getCall(callId);
  if (!call) throwHttp(404, "Call not found.");
  if (call.callerUid !== uid && call.calleeUid !== uid) throwHttp(403, "You are not part of this call.");
  return call;
}

function requireLiveKitConfig() {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) throwHttp(500, "LiveKit is not configured on the backend.");
}

async function createLiveKitJoinToken({ roomName, identity, name, role }) {
  requireLiveKitConfig();
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: name || identity,
    ttl: "10m",
    metadata: JSON.stringify({ roomName, role }),
  });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
  return token.toJwt();
}

function incomingCallPayload(callId, callData) {
  return {
    type: "incoming_call",
    callId,
    callerUid: callData.callerUid,
    calleeUid: callData.calleeUid,
    callerNumber: callData.callerNumber,
    calleeNumber: callData.calleeNumber,
    status: callData.status,
    callerLanguage: callData.callerLanguage,
    calleeLanguage: callData.calleeLanguage,
    createdAt: callData.createdAt,
    expiresAt: callData.expiresAt,
  };
}

function callUpdatePayload(callData) {
  return { ...incomingCallPayload(callData.callId, callData), type: "call_update" };
}

function sendLocalRealtimeSignal(uid, payload) {
  const sockets = onlineClients.get(uid);
  if (!sockets || sockets.size === 0) return 0;
  const message = JSON.stringify(payload);
  let delivered = 0;
  for (const socket of Array.from(sockets)) {
    if (socket.readyState !== 1) {
      sockets.delete(socket);
      continue;
    }
    socket.send(message);
    delivered += 1;
  }
  if (sockets.size === 0) onlineClients.delete(uid);
  return delivered;
}


function pushDataFromPayload(payload) {
  const data = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) data[key] = String(value);
  }
  return data;
}

async function sendPushSignal(uid, payload) {
  if (!messaging) return 0;
  const tokenDocs = await store.listPushTokens(uid);
  const tokens = [...new Set(tokenDocs.map((item) => item.token).filter(Boolean))];
  if (tokens.length === 0) return 0;

  const response = await messaging.sendEachForMulticast({
    tokens,
    data: pushDataFromPayload(payload),
    android: {
      priority: "high",
      ttl: CALL_TIMEOUT_MS,
    },
  });
  if (response.failureCount > 0) {
    console.warn("Push fallback failures", response.responses.filter((item) => !item.success).map((item) => item.error?.message));
  }
  return response.successCount;
}
async function sendRealtimeSignal(uid, payload) {
  if (pubsub) {
    await pubsub.sendToUser(uid, payload, { messageTtlSeconds: 45 });
    return 1;
  }
  return sendLocalRealtimeSignal(uid, payload);
}

function notifyIncomingCall(callId, callData) {
  const payload = incomingCallPayload(callId, callData);
  Promise.allSettled([
    sendRealtimeSignal(callData.calleeUid, payload),
    sendPushSignal(callData.calleeUid, payload),
  ]).then((results) => {
    const realtime = results[0];
    const push = results[1];
    if (realtime.status === "rejected") console.error("Realtime incoming call delivery failed", realtime.reason);
    if (push.status === "rejected") console.error("Push incoming call delivery failed", push.reason);
    console.log(
      "Incoming call " +
        callId +
        " signaled by " +
        (pubsub ? "Azure Web PubSub" : "local websocket") +
        ", pushFallback=" +
        (push.status === "fulfilled" ? push.value : 0)
    );
  });
}

function notifyCallUpdate(callData) {
  const payload = callUpdatePayload(callData);
  Promise.allSettled([
    sendRealtimeSignal(callData.callerUid, payload),
    sendRealtimeSignal(callData.calleeUid, payload),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.error("Realtime call update delivery failed", result.reason);
    }
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    build: "message-styles-20261007-1",
    realtime: pubsub ? "azure-web-pubsub" : "websocket",
    livekitConfigured: Boolean(LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET),
    messaging: true,
    callHistory: true,
    activeCalls: translationManager.status().activeSessions,
    activeTranslations: translationManager.status().activeSessions,
    auth: "azure-jwt",
    store: store.constructor.name,
    pubsub: Boolean(pubsub),
    push: Boolean(messaging),
    translation: true,
    translationProvider: translationManager.status().provider,
    speechConfigured: translationManager.status().configured,
    sarvamConfigured: translationManager.status().configured,
    colloquialConfigured: translationManager.status().colloquialConfigured,
  });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const email = cleanEmail(req.body?.email);
    const password = cleanPassword(req.body?.password);
    const existing = await store.getUserByEmail(email);
    if (existing) throwHttp(409, "An account already exists for this email.");

    const uid = crypto.randomUUID();
    const assigned = await assignNumber(uid);
    const passwordData = passwordHash(password);
    const user = {
      uid,
      email,
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt,
      suffix: assigned.suffix,
      number: assigned.number,
      spokenLanguage: DEFAULT_LANGUAGE,
      listenLanguage: DEFAULT_LANGUAGE,
      preferredVoice: DEFAULT_VOICE,
      protectedTermsJson: json([]),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await store.createUser(user);
    res.json({ token: signUserToken(user), profile: publicProfile(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = cleanEmail(req.body?.email);
    const password = cleanPassword(req.body?.password);
    const user = await store.getUserByEmail(email);
    if (!user || !verifyPassword(password, user)) throwHttp(401, "Email or password is incorrect.");
    res.json({ token: signUserToken(user), profile: publicProfile(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    res.json({ profile: publicProfile(user) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/me", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    if (req.body?.messageTranslationStyle != null && !["pure", "mixed"].includes(req.body.messageTranslationStyle)) {
      throwHttp(400, "Choose pure or mixed message translation.");
    }
    const updates = {
      ...(req.body?.messageTranslationStyle == null ? {} : { messageTranslationStyle: req.body.messageTranslationStyle }),
      ...(req.body?.messageLanguage == null ? {} : { messageLanguage: cleanLanguage(req.body.messageLanguage, "message language") }),
      spokenLanguage: cleanLanguage(req.body?.spokenLanguage, "spoken language"),
      listenLanguage: cleanLanguage(req.body?.listenLanguage, "listening language"),
      preferredVoice: cleanVoice(req.body?.preferredVoice),
      protectedTermsJson: json(
        cleanProtectedTerms(
          req.body?.protectedTerms ?? parseJson(user.protectedTermsJson, []),
        ),
      ),
    };
    const updated = await store.updateUser(user.uid, updates);
    if (!updated) throwHttp(404, "User not found.");
    res.json({ profile: publicProfile(updated) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/translation/options", async (req, res, next) => {
  try {
    await requireUser(req);
    res.json({
      languages: SUPPORTED_LANGUAGES,
      voices: SUPPORTED_VOICES,
      defaultVoice: DEFAULT_VOICE,
      protectedTermsLimit: PROTECTED_TERMS_LIMIT,
      protectedTermMaxLength: PROTECTED_TERM_MAX_LENGTH,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/realtime-token", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    if (!pubsub) {
      const forwardedProtocol = req.get("x-forwarded-proto")?.split(",")[0].trim();
      const protocol = forwardedProtocol === "https" ? "https" : req.protocol;
      const url = new URL("/ws/calls", PUBLIC_BRIDGE_URL || `${protocol}://${req.get("host")}`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const token = jwt.sign({ sub: user.uid }, APP_JWT_SECRET, {
        expiresIn: "1h", audience: "vaani-setu-realtime", issuer: "vaani-setu-azure",
      });
      url.searchParams.set("token", token);
      res.json({ url: url.toString(), expiresInMinutes: 60, transport: "websocket" });
      return;
    }
    const token = await pubsub.getClientAccessToken({
      userId: user.uid,
      expirationTimeInMinutes: 60,
    });
    res.json({ url: token.url, hub: WEB_PUBSUB_HUB, expiresInMinutes: 60 });
  } catch (error) {
    next(error);
  }
});

app.post("/api/push-tokens", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!token) throwHttp(400, "Push token is required.");
    await store.savePushToken(user.uid, token, req.body?.platform || "android");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/numbers/:suffix", async (req, res, next) => {
  try {
    await requireUser(req);
    const suffix = cleanSuffix(req.params.suffix);
    const number = await store.getNumber(suffix);
    if (!number) throwHttp(404, "No user has that Vaani number yet.");
    const user = await store.getUser(number.uid);
    res.json({ profile: publicProfile(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/calls", async (req, res, next) => {
  try {
    const caller = await requireUser(req);
    const targetSuffix = cleanSuffix(req.body?.targetSuffix);
    if (targetSuffix === caller.suffix) throwHttp(400, "You cannot call your own number.");

    const numberDoc = await store.getNumber(targetSuffix);
    if (!numberDoc) throwHttp(404, "No user has that Vaani number yet.");
    const callee = await store.getUser(numberDoc.uid);
    if (!callee) throwHttp(404, "No user has that Vaani number yet.");

    requireLiveKitConfig();
    const callId = crypto.randomUUID();
    const callData = {
      callId,
      callerUid: caller.uid,
      calleeUid: callee.uid,
      callerNumber: caller.number,
      calleeNumber: callee.number,
      callerSuffix: caller.suffix,
      calleeSuffix: callee.suffix,
      callerLanguage: storedLanguage(caller.spokenLanguage),
      calleeLanguage: storedLanguage(callee.spokenLanguage),
      callerSpokenLanguage: storedLanguage(caller.spokenLanguage),
      callerListenLanguage: storedLanguage(caller.listenLanguage),
      calleeSpokenLanguage: storedLanguage(callee.spokenLanguage),
      calleeListenLanguage: storedLanguage(callee.listenLanguage),
      callerVoice: storedVoice(caller.preferredVoice),
      calleeVoice: storedVoice(callee.preferredVoice),
      callerProtectedTerms: parseJson(caller.protectedTermsJson, []),
      calleeProtectedTerms: parseJson(callee.protectedTermsJson, []),
      status: "ringing",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt: new Date(Date.now() + CALL_TIMEOUT_MS).toISOString(),
      participants: [caller.uid, callee.uid],
    };

    await store.createCall(callData);
    notifyIncomingCall(callId, callData);

    const token = await createLiveKitJoinToken({ roomName: callId, identity: caller.uid, name: caller.number, role: "caller" });
    res.json({
      callId,
      status: "ringing",
      livekit: { url: LIVEKIT_URL, token, roomName: callId, identity: caller.uid, role: "caller" },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/calls", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const calls = (await store.listCalls(user.uid)).map((call) => callHistoryEntry(call, user.uid));
    res.json(historyPage(calls, req.query, "callId"));
  } catch (error) { next(error); }
});

app.get("/api/conversations", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const messages = await store.listMessages(user.uid);
    const latest = new Map();
    for (const message of messages) {
      const peer = message.senderUid === user.uid ? message.recipientNumber : message.senderNumber;
      const previous = latest.get(peer);
      if (!previous || `${message.createdAt}|${message.messageId}` > `${previous.createdAt}|${previous.messageId}`) latest.set(peer, message);
    }
    res.json({ items: [...latest].map(([remoteNumber, message]) => ({ remoteNumber, message }))
      .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt)) });
  } catch (error) { next(error); }
});

app.get("/api/messages/:suffix", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const suffix = cleanSuffix(req.params.suffix);
    const peer = await store.getNumber(suffix);
    if (!peer) throwHttp(404, "No user has that Vaani number yet.");
    const messages = (await store.listMessages(user.uid)).filter((message) =>
      message.senderUid === peer.uid || message.recipientUid === peer.uid);
    res.json(historyPage(messages, req.query, "messageId"));
  } catch (error) { next(error); }
});

app.post("/api/messages", async (req, res, next) => {
  try {
    const sender = await requireUser(req);
    const suffix = cleanSuffix(req.body?.targetSuffix);
    if (suffix === sender.suffix) throwHttp(400, "You cannot message your own number.");
    const originalText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!originalText || originalText.length > MAX_MESSAGE_LENGTH) throwHttp(400, `Messages must contain 1-${MAX_MESSAGE_LENGTH} characters.`);
    const sourceLanguage = cleanLanguage(req.body?.sourceLanguage, "message source language");
    const messageId = req.body?.messageId;
    if (typeof messageId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(messageId)) throwHttp(400, "A valid message id is required.");
    const existing = await store.getMessage(sender.uid, messageId);
    const respondExisting = (message) => {
      if (message.originalText !== originalText || message.sourceLanguage !== sourceLanguage || message.recipientNumber !== VAANI_PREFIX + suffix) {
        throwHttp(409, "This message id was already used for different content.");
      }
      return res.json({ message });
    };
    if (existing) return respondExisting(existing);
    const number = await store.getNumber(suffix);
    const recipient = number && await store.getUser(number.uid);
    if (!recipient) throwHttp(404, "No user has that Vaani number yet.");
    const targetLanguage = storedLanguage(recipient.messageLanguage || recipient.listenLanguage);
    const translationStyle = targetLanguage !== "en" && recipient.messageTranslationStyle === "mixed" ? "mixed" : "pure";
    let translatedText;
    try {
      translatedText = await translateMessage(originalText, sourceLanguage, targetLanguage, translationStyle);
      if (typeof translatedText !== "string" || !translatedText.trim()) throw new Error("Empty translation");
    } catch (_) {
      throwHttp(503, "Translation is unavailable. Your message was not sent. Please retry.");
    }
    const message = { messageId, senderUid: sender.uid, recipientUid: recipient.uid,
      senderNumber: sender.number, recipientNumber: recipient.number,
      originalText, translatedText, sourceLanguage, targetLanguage, translationStyle, createdAt: nowIso() };
    try { await store.createMessage(message); }
    catch (error) {
      if (error.status === 409 || error.statusCode === 409) {
        return respondExisting(await store.getMessage(sender.uid, messageId));
      }
      throw error;
    }
    // Durable storage succeeds before notifying either device. Reconnection fetches history.
    await Promise.allSettled([sender.uid, recipient.uid].map((uid) =>
      sendRealtimeSignal(uid, { type: "new_message", message })));
    res.status(201).json({ message });
  } catch (error) { next(error); }
});

app.get("/api/calls/:callId", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const call = await getCallForParticipant(cleanCallId(req.params.callId), user.uid);
    res.json({ call });
  } catch (error) {
    next(error);
  }
});

app.post("/api/calls/:callId/accept", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const callId = cleanCallId(req.params.callId);
    const call = await getCallForParticipant(callId, user.uid);
    if (call.calleeUid !== user.uid) throwHttp(403, "Only the callee can accept this call.");
    if (call.status !== "ringing" || Date.parse(call.expiresAt) <= Date.now()) throwHttp(412, "This call is no longer ringing.");

    const updatedCall = await store.updateCall(callId, { status: "accepted", acceptedAt: nowIso() });
    notifyCallUpdate(updatedCall);
    translationManager.start(updatedCall).catch((error) => {
      console.error(`LiveKit translation failed to start for ${callId}`, error);
    });
    const token = await createLiveKitJoinToken({ roomName: callId, identity: user.uid, name: call.calleeNumber, role: "callee" });
    res.json({
      callId,
      status: "accepted",
      livekit: { url: LIVEKIT_URL, token, roomName: callId, identity: user.uid, role: "callee" },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/calls/:callId/end", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const callId = cleanCallId(req.params.callId);
    const currentCall = await getCallForParticipant(callId, user.uid);
    if (currentCall.endedAt) return res.json({ callId, status: currentCall.status });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 40) : "ended";
    const updatedCall = await store.updateCall(callId, { status: "ended", endedBy: user.uid, endedReason: reason, endedAt: nowIso() });
    notifyCallUpdate(updatedCall);
    await translationManager.stop(callId);
    res.json({ callId, status: "ended" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/calls/:callId/livekit-token", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const callId = cleanCallId(req.params.callId);
    const call = await getCallForParticipant(callId, user.uid);
    const role = call.callerUid === user.uid ? "caller" : "callee";
    const displayName = role === "caller" ? call.callerNumber : call.calleeNumber;
    const token = await createLiveKitJoinToken({ roomName: callId, identity: user.uid, name: displayName, role });
    res.json({ url: LIVEKIT_URL, token, roomName: callId, identity: user.uid, role });
  } catch (error) {
    next(error);
  }
});

app.get("/api/calls/:callId/translation/status", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    const callId = cleanCallId(req.params.callId);
    await getCallForParticipant(callId, user.uid);
    res.json(translationManager.status(callId));
  } catch (error) {
    next(error);
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "This service endpoint is unavailable. Please try again later." });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || error.statusCode || 500).json({ error: error.message || "Internal error" });
});

export async function startBridge({ dataStore = createStore(), translator = createTextTranslator(SARVAM_API_KEY), port = PORT } = {}) {
store = dataStore;
translateMessage = translator;
await store.init();
const server = app.listen(port);
await new Promise((resolve) => server.once("listening", resolve));

const wss = new WebSocketServer({ server, path: "/ws/calls" });
wss.on("connection", async (socket, req) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token") || "";
    const claims = jwt.verify(token, APP_JWT_SECRET, {
      audience: ["vaani-setu-realtime", "vaani-setu-app"], issuer: "vaani-setu-azure",
    });
    const user = await store.getUser(claims.sub);
    if (!user) throwHttp(401, "Unauthorized");

    let sockets = onlineClients.get(user.uid);
    if (!sockets) {
      sockets = new Set();
      onlineClients.set(user.uid, sockets);
    }

    sockets.add(socket);
    socket.send(JSON.stringify({ type: "ready" }));
    socket.on("close", () => {
      sockets.delete(socket);
      if (sockets.size === 0) onlineClients.delete(user.uid);
    });
    socket.on("error", () => {
      sockets.delete(socket);
      if (sockets.size === 0) onlineClients.delete(user.uid);
    });
    // A call may arrive while the app is connecting or reconnecting.
    // Recover only this recipient's still-ringing calls from durable storage.
    const pending = await store.listCalls(user.uid);
    for (const call of pending) {
      if (socket.readyState !== 1) break;
      if (call.calleeUid === user.uid && call.status === "ringing" && Date.parse(call.expiresAt) > Date.now()) {
        socket.send(JSON.stringify(incomingCallPayload(call.callId, call)));
      }
    }
  } catch (error) {
    console.error("WebSocket auth failed", error);
    socket.close(1008, "Unauthorized");
  }
});

return { server, wss, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startBridge();
  console.log(`Vaani Setu bridge listening on ${PORT}`);
}
