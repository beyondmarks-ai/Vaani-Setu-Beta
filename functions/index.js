const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const jwt = require("jsonwebtoken");

admin.initializeApp();

const bridgeJwtSecret = defineSecret("BRIDGE_JWT_SECRET");
const db = admin.firestore();
const REGION = "us-central1";
const DEFAULT_LANGUAGE = "en";
const CALL_TIMEOUT_MS = 60 * 1000;

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before making calls.");
  }
  return request.auth.uid;
}

function cleanSuffix(value) {
  if (typeof value !== "string" || !/^\d{2}$/.test(value)) {
    throw new HttpsError("invalid-argument", "Target suffix must be exactly 2 digits.");
  }
  return value;
}

function cleanCallId(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpsError("invalid-argument", "Invalid call id.");
  }
  return value;
}

async function getUserProfile(uid) {
  const snapshot = await db.collection("users").doc(uid).get();
  if (!snapshot.exists) {
    throw new HttpsError("failed-precondition", "Your Vaani number is not assigned yet.");
  }
  return snapshot.data();
}

async function getCallForParticipant(callId, uid) {
  const ref = db.collection("calls").doc(callId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Call not found.");
  }

  const call = snapshot.data();
  if (call.callerUid !== uid && call.calleeUid !== uid) {
    throw new HttpsError("permission-denied", "You are not part of this call.");
  }

  return { ref, call };
}

exports.createCall = onCall({ region: REGION }, async (request) => {
  const callerUid = requireAuth(request);
  const targetSuffix = cleanSuffix(request.data && request.data.targetSuffix);
  const caller = await getUserProfile(callerUid);

  if (targetSuffix === caller.suffix) {
    throw new HttpsError("invalid-argument", "You cannot call your own number.");
  }

  const numberSnapshot = await db.collection("numbers").doc(targetSuffix).get();
  if (!numberSnapshot.exists) {
    throw new HttpsError("not-found", "No user has that Vaani number yet.");
  }

  const numberDoc = numberSnapshot.data();
  const calleeUid = numberDoc.uid;
  const callee = await getUserProfile(calleeUid);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + CALL_TIMEOUT_MS);
  const callRef = db.collection("calls").doc();

  const call = {
    callerUid,
    calleeUid,
    callerNumber: caller.number,
    calleeNumber: callee.number,
    callerSuffix: caller.suffix,
    calleeSuffix: callee.suffix,
    callerLanguage: caller.listenLanguage || caller.spokenLanguage || DEFAULT_LANGUAGE,
    calleeLanguage: callee.listenLanguage || callee.spokenLanguage || DEFAULT_LANGUAGE,
    status: "ringing",
    createdAt: now,
    updatedAt: now,
    expiresAt,
    participants: [callerUid, calleeUid],
  };

  await callRef.set(call);
  return { callId: callRef.id, status: "ringing" };
});

exports.acceptCall = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const callId = cleanCallId(request.data && request.data.callId);
  const { ref, call } = await getCallForParticipant(callId, uid);

  if (call.calleeUid !== uid) {
    throw new HttpsError("permission-denied", "Only the callee can accept this call.");
  }
  if (call.status !== "ringing") {
    throw new HttpsError("failed-precondition", "This call is no longer ringing.");
  }

  await ref.update({
    status: "accepted",
    acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { callId, status: "accepted" };
});

exports.endCall = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const callId = cleanCallId(request.data && request.data.callId);
  const reason = typeof request.data.reason === "string" ? request.data.reason.slice(0, 40) : "ended";
  const { ref } = await getCallForParticipant(callId, uid);

  await ref.update({
    status: "ended",
    endedBy: uid,
    endedReason: reason,
    endedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { callId, status: "ended" };
});

exports.createBridgeToken = onCall({ region: REGION, secrets: [bridgeJwtSecret] }, async (request) => {
  const uid = requireAuth(request);
  const callId = cleanCallId(request.data && request.data.callId);
  const { call } = await getCallForParticipant(callId, uid);

  if (!["accepted", "connecting", "active"].includes(call.status)) {
    throw new HttpsError("failed-precondition", "Call must be accepted before connecting media.");
  }

  const role = call.callerUid === uid ? "caller" : "callee";
  const token = jwt.sign(
    {
      sub: uid,
      callId,
      role,
      callerUid: call.callerUid,
      calleeUid: call.calleeUid,
      sourceLanguage: role === "caller" ? call.callerLanguage : call.calleeLanguage,
      targetLanguage: role === "caller" ? call.calleeLanguage : call.callerLanguage,
    },
    bridgeJwtSecret.value(),
    { expiresIn: "10m", audience: "vaani-setu-bridge", issuer: "vaani-setu-functions" }
  );

  return { token, role, expiresInSeconds: 600 };
});
