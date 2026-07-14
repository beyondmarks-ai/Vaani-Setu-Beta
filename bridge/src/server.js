import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import wrtc from "@roamhq/wrtc";
import { TableClient } from "@azure/data-tables";
import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { AccessToken } from "livekit-server-sdk";
import { WebSocketServer } from "ws";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { TranslationPipeline } from "./openaiRealtime.js";
import { TranslationManager } from "./livekitTranslation.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const calls = new Map();
const onlineClients = new Map();
const PORT = process.env.PORT || 8080;
const DEFAULT_LANGUAGE = "en";
const CALL_TIMEOUT_MS = 60 * 1000;
const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const APP_JWT_SECRET = process.env.APP_JWT_SECRET || process.env.BRIDGE_JWT_SECRET || "dev-only-change-me";
const TOKEN_TTL = "30d";
const VAANI_PREFIX = "0209";
const WEB_PUBSUB_CONNECTION_STRING = process.env.WEB_PUBSUB_CONNECTION_STRING || "";
const WEB_PUBSUB_HUB = process.env.WEB_PUBSUB_HUB || "vaani";
const FIREBASE_SERVICE_ACCOUNT_BASE64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || "";
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY || "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || "";

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English (India)" },
  { code: "as", name: "Assamese" },
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
  { code: "ur", name: "Urdu" },
];
const SUPPORTED_VOICES = [
  { id: "en-IN-NeerjaNeural", name: "English - Neerja", languageCode: "en", gender: "Female" },
  { id: "en-IN-PrabhatNeural", name: "English - Prabhat", languageCode: "en", gender: "Male" },
  { id: "as-IN-YashicaNeural", name: "Assamese - Yashica", languageCode: "as", gender: "Female" },
  { id: "as-IN-PriyomNeural", name: "Assamese - Priyom", languageCode: "as", gender: "Male" },
  { id: "bn-IN-TanishaaNeural", name: "Bengali - Tanishaa", languageCode: "bn", gender: "Female" },
  { id: "bn-IN-BashkarNeural", name: "Bengali - Bashkar", languageCode: "bn", gender: "Male" },
  { id: "gu-IN-DhwaniNeural", name: "Gujarati - Dhwani", languageCode: "gu", gender: "Female" },
  { id: "gu-IN-NiranjanNeural", name: "Gujarati - Niranjan", languageCode: "gu", gender: "Male" },
  { id: "hi-IN-SwaraNeural", name: "Hindi - Swara", languageCode: "hi", gender: "Female" },
  { id: "hi-IN-MadhurNeural", name: "Hindi - Madhur", languageCode: "hi", gender: "Male" },
  { id: "kn-IN-SapnaNeural", name: "Kannada - Sapna", languageCode: "kn", gender: "Female" },
  { id: "kn-IN-GaganNeural", name: "Kannada - Gagan", languageCode: "kn", gender: "Male" },
  { id: "ml-IN-SobhanaNeural", name: "Malayalam - Sobhana", languageCode: "ml", gender: "Female" },
  { id: "ml-IN-MidhunNeural", name: "Malayalam - Midhun", languageCode: "ml", gender: "Male" },
  { id: "mr-IN-AarohiNeural", name: "Marathi - Aarohi", languageCode: "mr", gender: "Female" },
  { id: "mr-IN-ManoharNeural", name: "Marathi - Manohar", languageCode: "mr", gender: "Male" },
  { id: "or-IN-SubhasiniNeural", name: "Odia - Subhasini", languageCode: "or", gender: "Female" },
  { id: "or-IN-SukantNeural", name: "Odia - Sukant", languageCode: "or", gender: "Male" },
  { id: "pa-IN-VaaniNeural", name: "Punjabi - Vaani", languageCode: "pa", gender: "Female" },
  { id: "pa-IN-OjasNeural", name: "Punjabi - Ojas", languageCode: "pa", gender: "Male" },
  { id: "ta-IN-PallaviNeural", name: "Tamil - Pallavi", languageCode: "ta", gender: "Female" },
  { id: "ta-IN-ValluvarNeural", name: "Tamil - Valluvar", languageCode: "ta", gender: "Male" },
  { id: "te-IN-ShrutiNeural", name: "Telugu - Shruti", languageCode: "te", gender: "Female" },
  { id: "te-IN-MohanNeural", name: "Telugu - Mohan", languageCode: "te", gender: "Male" },
  { id: "ur-IN-GulNeural", name: "Urdu - Gul", languageCode: "ur", gender: "Female" },
  { id: "ur-IN-SalmanNeural", name: "Urdu - Salman", languageCode: "ur", gender: "Male" },
];
const DEFAULT_VOICE = "en-IN-NeerjaNeural";

const pubsub = WEB_PUBSUB_CONNECTION_STRING
  ? new WebPubSubServiceClient(WEB_PUBSUB_CONNECTION_STRING, WEB_PUBSUB_HUB)
  : null;
const messaging = createMessaging();
const translationManager = new TranslationManager({
  livekitUrl: LIVEKIT_URL,
  apiKey: LIVEKIT_API_KEY,
  apiSecret: LIVEKIT_API_SECRET,
  speechKey: AZURE_SPEECH_KEY,
  speechRegion: AZURE_SPEECH_REGION,
});

let store;

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

class AzureTableStore {
  constructor(connectionString) {
    this.users = TableClient.fromConnectionString(connectionString, "VaaniUsers");
    this.emailIndex = TableClient.fromConnectionString(connectionString, "VaaniEmailIndex");
    this.numbers = TableClient.fromConnectionString(connectionString, "VaaniNumbers");
    this.calls = TableClient.fromConnectionString(connectionString, "VaaniCalls");
    this.pushTokens = TableClient.fromConnectionString(connectionString, "VaaniPushTokens");
  }

  async init() {
    await Promise.all([
      this.users.createTable().catch(ignoreConflict),
      this.emailIndex.createTable().catch(ignoreConflict),
      this.numbers.createTable().catch(ignoreConflict),
      this.calls.createTable().catch(ignoreConflict),
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

class MemoryStore {
  constructor() {
    this.users = new Map();
    this.emailIndex = new Map();
    this.numbers = new Map();
    this.calls = new Map();
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
  const { participants, ...entity } = call;
  return {
    ...entity,
    participantsJson: json(participants || []),
  };
}

function deserializeCall(entity) {
  return {
    ...entity,
    callId: entity.callId || entity.rowKey,
    participants: parseJson(entity.participantsJson, []),
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
  if (!SUPPORTED_VOICES.some((item) => item.id === voice)) throwHttp(400, "Unsupported voice.");
  return voice;
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
    spokenLanguage: user.spokenLanguage || DEFAULT_LANGUAGE,
    listenLanguage: user.listenLanguage || DEFAULT_LANGUAGE,
    preferredVoice: user.preferredVoice || DEFAULT_VOICE,
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
  const claims = verifyUserToken(token);
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
    build: "ssml-voice-tuning-20260714-1",
    activeCalls: calls.size,
    activeTranslations: translationManager.status().activeSessions,
    auth: "azure-jwt",
    store: store.constructor.name,
    pubsub: Boolean(pubsub),
    push: Boolean(messaging),
    translation: true,
    translationProvider: translationManager.status().provider,
    speechConfigured: translationManager.status().configured,
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
    const updates = {
      spokenLanguage: cleanLanguage(req.body?.spokenLanguage, "spoken language"),
      listenLanguage: cleanLanguage(req.body?.listenLanguage, "listening language"),
      preferredVoice: cleanVoice(req.body?.preferredVoice),
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
    res.json({ languages: SUPPORTED_LANGUAGES, voices: SUPPORTED_VOICES, defaultVoice: DEFAULT_VOICE });
  } catch (error) {
    next(error);
  }
});

app.post("/api/realtime-token", async (req, res, next) => {
  try {
    const user = await requireUser(req);
    if (!pubsub) throwHttp(500, "Azure Web PubSub is not configured.");
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

    const callId = crypto.randomUUID();
    const callData = {
      callId,
      callerUid: caller.uid,
      calleeUid: callee.uid,
      callerNumber: caller.number,
      calleeNumber: callee.number,
      callerSuffix: caller.suffix,
      calleeSuffix: callee.suffix,
      callerLanguage: caller.spokenLanguage || DEFAULT_LANGUAGE,
      calleeLanguage: callee.spokenLanguage || DEFAULT_LANGUAGE,
      callerSpokenLanguage: caller.spokenLanguage || DEFAULT_LANGUAGE,
      callerListenLanguage: caller.listenLanguage || DEFAULT_LANGUAGE,
      calleeSpokenLanguage: callee.spokenLanguage || DEFAULT_LANGUAGE,
      calleeListenLanguage: callee.listenLanguage || DEFAULT_LANGUAGE,
      callerVoice: caller.preferredVoice || DEFAULT_VOICE,
      calleeVoice: callee.preferredVoice || DEFAULT_VOICE,
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
    if (call.status !== "ringing") throwHttp(412, "This call is no longer ringing.");

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
    await getCallForParticipant(callId, user.uid);
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 40) : "ended";
    const updatedCall = await store.updateCall(callId, { status: "ended", endedBy: user.uid, endedReason: reason, endedAt: nowIso() });
    notifyCallUpdate(updatedCall);
    await translationManager.stop(callId);
    cleanupCall(callId);
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

function verifyBridgeToken(header) {
  const token = (header || "").replace(/^Bearer\s+/i, "");
  if (!token) throwHttp(401, "Missing bridge token");
  return jwt.verify(token, APP_JWT_SECRET, { audience: "vaani-setu-app", issuer: "vaani-setu-azure" });
}

function getCallState(callId) {
  if (!calls.has(callId)) calls.set(callId, { peers: new Map(), pipelines: new Map(), createdAt: Date.now() });
  return calls.get(callId);
}

app.post("/webrtc/offer", async (req, res, next) => {
  try {
    const claims = verifyBridgeToken(req.headers.authorization);
    const { sdp, type } = req.body || {};
    if (type !== "offer" || typeof sdp !== "string") throwHttp(400, "Expected SDP offer.");

    const state = getCallState(claims.callId);
    const peer = new wrtc.RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    state.peers.set(claims.role, peer);
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) cleanupPeer(claims.callId, claims.role);
    };
    peer.ontrack = async (event) => {
      console.log(`Received ${event.track.kind} track for ${claims.callId}/${claims.role}`);
      if (event.track.kind !== "audio") return;
      await ensurePipeline(state, claims);
    };
    peer.addTransceiver("audio", { direction: "sendrecv" });
    await peer.setRemoteDescription({ type, sdp });
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await waitForIceGathering(peer);
    res.json({ type: peer.localDescription.type, sdp: peer.localDescription.sdp });
  } catch (error) {
    next(error);
  }
});

app.post("/calls/:callId/end", (req, res) => {
  cleanupCall(req.params.callId);
  res.json({ ok: true });
});

async function ensurePipeline(state, claims) {
  const key = claims.role;
  if (state.pipelines.has(key)) return state.pipelines.get(key);
  const pipeline = new TranslationPipeline({
    sourceLanguage: claims.sourceLanguage,
    targetLanguage: claims.targetLanguage,
    onAudioDelta: () => {},
    onTranscript: (delta) => console.log(`Transcript ${claims.callId}/${claims.role}:`, delta),
  });
  await pipeline.connect();
  state.pipelines.set(key, pipeline);
  return pipeline;
}

function cleanupCall(callId) {
  const state = calls.get(callId);
  if (!state) return;
  for (const role of Array.from(state.peers.keys())) cleanupPeer(callId, role);
  calls.delete(callId);
}

function cleanupPeer(callId, role) {
  const state = calls.get(callId);
  if (!state) return;
  const peer = state.peers.get(role);
  if (peer) peer.close();
  state.peers.delete(role);
  const pipeline = state.pipelines.get(role);
  if (pipeline) pipeline.close();
  state.pipelines.delete(role);
  if (state.peers.size === 0) calls.delete(callId);
}

function waitForIceGathering(peer) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 2500);
    peer.onicegatheringstatechange = () => {
      if (peer.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    };
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || error.statusCode || 500).json({ error: error.message || "Internal error" });
});

store = createStore();
await store.init();
const server = app.listen(PORT, () => {
  console.log(`Vaani Setu bridge listening on ${PORT}`);
});

const wss = new WebSocketServer({ server, path: "/ws/calls" });
wss.on("connection", async (socket, req) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token") || "";
    const claims = verifyUserToken(token);
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
  } catch (error) {
    console.error("WebSocket auth failed", error);
    socket.close(1008, "Unauthorized");
  }
});


