import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { WebSocket } from "ws";
import { startBridge, MemoryStore, AzureTableStore } from "../src/server.js";
import { createTextTranslator, callHistoryEntry } from "../src/messages.js";

test("message translator preserves long text, scripts, and line breaks", async () => {
  const input = "नमस्ते दुनिया\n".repeat(50);
  const calls = [];
  const translate = createTextTranslator("test", { client: { text: { translate: async (body, options) => {
    calls.push({ body, options });
    return { translated_text: "Hello world\n".repeat(50) };
  } } } });
  assert.equal(await translate(input, "hi", "en"), "Hello world\n".repeat(50));
  assert.equal(calls[0].body.input, input);
  assert.equal(calls[0].body.source_language_code, "hi-IN");
  assert.equal(calls[0].body.target_language_code, "en-IN");
  assert.equal(calls[0].options.timeoutInSeconds, 15);
  assert.equal(await translate("Hello", "en", "en"), "Hello");
  assert.equal(await translate("🙂", "hi", "en"), "🙂");
  assert.equal(calls.length, 1);
});

test("pure and mixed modes preserve the requested style through pivots and same-language rewriting", async () => {
  const calls=[];
  const translate=createTextTranslator("test",{client:{text:{translate:async body=>{
    calls.push(body);
    if(body.source_language_code==='hi-IN' && body.target_language_code==='kn-IN')throw Error('pair');
    return {translated_text:'result'};
  }}}});
  await translate('Hello','en','hi','pure');
  assert.equal(calls.at(-1).mode,'formal');
  assert.equal(calls.at(-1).output_script,'fully-native');
  await translate('Hello','en','kn','mixed');
  assert.equal(calls.at(-1).mode,'code-mixed');
  assert.equal(calls.at(-1).output_script,undefined);
  await translate('नमस्ते','hi','kn','mixed');
  assert.equal(calls.at(-2).target_language_code,'en-IN');
  assert.equal(calls.at(-2).mode,'formal');
  assert.equal(calls.at(-1).mode,'code-mixed');
  await translate('meeting में आइए','hi','hi','pure');
  assert.equal(calls.at(-2).target_language_code,'en-IN');
  assert.equal(calls.at(-1).target_language_code,'hi-IN');
  assert.equal(calls.at(-1).mode,'formal');
  await translate('Hello','en','or','mixed');
  assert.equal(calls.at(-1).target_language_code,'od-IN');
  await assert.rejects(translate('Hi','en','hi','invalid'),/Unknown/);
});

test("message translation uses English pivot and rejects empty/unavailable responses", async () => {
  const calls = [];
  const translate = createTextTranslator("test", { client: { text: { translate: async (body) => {
    calls.push(body);
    if (body.source_language_code === "hi-IN" && body.target_language_code === "te-IN") throw Error("pair");
    return { translated_text: body.target_language_code === "en-IN" ? "Hello" : "నమస్కారం" };
  } } } });
  assert.equal(await translate("नमस्ते", "hi", "te"), "నమస్కారం");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].input, "Hello");
  await assert.rejects(createTextTranslator("")("Hello", "en", "hi"), /not configured/);
  const empty = createTextTranslator("test", { client: { text: { translate: async () => ({ translated_text: "" }) } } });
  await assert.rejects(empty("Hi", "en", "hi"), /no text/);
});

test("call history distinguishes missed, declined, completed and active calls", () => {
  const call = { callId: "call-test", callerUid: "a", calleeUid: "b", callerNumber: "020900", calleeNumber: "020901",
    status: "ringing", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:01:00.000Z" };
  assert.equal(callHistoryEntry(call, "b").outcome, "missed");
  assert.equal(callHistoryEntry(call, "a").outcome, "unanswered");
  assert.equal(callHistoryEntry({ ...call, endedReason: "rejected" }, "b").outcome, "declined");
  const completed = callHistoryEntry({ ...call, acceptedAt: "2026-01-01T00:00:10.000Z", endedAt: "2026-01-01T00:01:15.000Z" }, "a");
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.durationSeconds, 65);
  assert.equal(completed.remoteNumber, "020901");
  assert.equal(callHistoryEntry({ ...call, acceptedAt: call.createdAt }, "b").outcome, "ongoing");
});

test("two authenticated devices exchange translated messages, recover history, and isolate accounts", async (t) => {
  const store = process.env.TEST_AZURE_STORAGE_CONNECTION_STRING
    ? new AzureTableStore(process.env.TEST_AZURE_STORAGE_CONNECTION_STRING) : new MemoryStore();
  const translations = [];
  const instance = await startBridge({ port: 0, dataStore: store, translator: async (text, source, target, style) => {
    translations.push({ text, source, target, style });
    if (text === "FAIL") throw Error("provider unavailable");
    return source === target ? text : `${target}:${text}`;
  } });
  t.after(async () => {
    for (const client of instance.wss.clients) client.terminate();
    instance.wss.close();
    await new Promise((resolve) => instance.server.close(resolve));
  });
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  async function request(path, { user, body, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(base + path, { method, headers: {
      "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${user.token}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...await response.json() };
  }
  const missingRoute = await fetch(base + "/api/missing-route");
  assert.equal(missingRoute.status, 404);
  assert.match(missingRoute.headers.get("content-type"), /application\/json/);
  assert.equal(typeof (await missingRoute.json()).error, "string");
  const health = await request("/health");
  assert.equal(health.messaging, true);
  assert.equal(health.callHistory, true);
  const register = (name) => request("/api/auth/register", { body: { email: `${name}-${Date.now()}@test.local`, password: "test-password" } });
  const a = await register("alice");
  const b = await register("bob");
  const c = await register("charlie");
  assert.equal(a.status, 200);
  const preference = async (user, language) => request("/api/me", { user, method: "PATCH", body: {
    spokenLanguage: language, listenLanguage: language, messageLanguage: language, preferredVoice: "simran",
  } });
  await preference(a, "hi");
  await preference(b, "te");
  const styleResponse=await request('/api/me',{user:b,method:'PATCH',body:{
    spokenLanguage:'te',listenLanguage:'te',preferredVoice:'simran',messageTranslationStyle:'mixed',
  }});
  assert.equal(styleResponse.profile.messageTranslationStyle,'mixed');
  assert.equal((await request('/api/me',{user:a})).profile.messageTranslationStyle,'pure');
  assert.equal((await request('/api/me',{user:b,method:'PATCH',body:{messageTranslationStyle:'invalid'}})).status,400);
  const realtimeA = await request("/api/realtime-token", { user: a, body: {} });
  const realtimeB = await request("/api/realtime-token", { user: b, body: {} });
  assert.equal(realtimeA.status, 200);
  assert.equal(realtimeA.transport, "websocket");
  const socketA = new WebSocket(realtimeA.url);
  await once(socketA, "message");
  const socketB = new WebSocket(realtimeB.url);
  await once(socketB, "message");
  const eventA = once(socketA, "message");
  const eventB = once(socketB, "message");
  const payload = { targetSuffix: b.profile.suffix, text: "नमस्ते\nदोस्त", sourceLanguage: "hi", messageId: "message-0000000001" };
  const sent = await request("/api/messages", { user: a, body: payload });
  assert.equal(sent.status, 201);
  assert.equal(sent.message.translationStyle,'mixed');
  assert.equal(translations.at(-1).style,'mixed');
  assert.equal(sent.message.translatedText, "te:नमस्ते\nदोस्त");
  assert.equal(JSON.parse((await eventA)[0]).message.messageId, payload.messageId);
  assert.equal(JSON.parse((await eventB)[0]).message.messageId, payload.messageId);
  socketB.close();
  const reply = await request("/api/messages", { user: b, body: { targetSuffix: a.profile.suffix,
    text: "ధన్యవాదాలు", sourceLanguage: "te", messageId: "message-0000000002" } });
  assert.equal(reply.message.targetLanguage, "hi");
  assert.equal(reply.message.translationStyle,'pure');
  assert.equal(reply.message.translatedText, "hi:ధన్యవాదాలు");
  assert.equal((await request("/api/messages", { user: a, body: payload })).status, 200);
  assert.equal(translations.length, 2, "retry does not translate or save twice");
  assert.equal((await request("/api/messages", { user: a, body: { ...payload, text: "changed" } })).status, 409);
  const history = await request(`/api/messages/${a.profile.suffix}`, { user: b });
  assert.equal(history.items.length, 2);
  assert.equal(history.items[1].originalText, payload.text);
  const login = await request("/api/auth/login", { body: { email: b.profile.email, password: "test-password" } });
  assert.equal(login.profile.messageTranslationStyle,'mixed');
  assert.equal((await request(`/api/messages/${a.profile.suffix}`, { user: login })).items.length, 2);
  assert.equal((await request("/api/conversations", { user: c })).items.length, 0);
  assert.equal((await request(`/api/messages/${a.profile.suffix}`, { user: c })).items.length, 0);
  assert.equal((await request("/api/conversations", { user: a })).items[0].remoteNumber, b.profile.number);
  for (const path of ["/api/conversations", "/api/calls", `/api/messages/${b.profile.suffix}`]) {
    assert.equal((await request(path)).status, 401);
  }
  assert.equal((await request("/api/messages", { body: payload })).status, 401);
  assert.equal((await request("/api/conversations", { user: { token: "invalid" } })).status, 401);
  for (const change of [{ text: "  " }, { text: "x".repeat(1001) }, { sourceLanguage: "xx" },
    { targetSuffix: a.profile.suffix }, { messageId: "bad" }, { targetSuffix: "'x" }]) {
    assert.equal((await request("/api/messages", { user: a, body: { ...payload, ...change } })).status, 400);
  }
  assert.equal((await request("/api/messages", { user: a, body: { ...payload, targetSuffix: "99", messageId: "missing-000000001" } })).status, 404);
  assert.equal((await request("/api/messages", { user: a, body: { ...payload, text: "FAIL", messageId: "failure-000000001" } })).status, 503);
  assert.equal((await request(`/api/messages/${a.profile.suffix}`, { user: b })).items.length, 2);
  await preference(b, "en");
  const offline = await request("/api/messages", { user: a, body: { ...payload, messageId: "message-0000000003" } });
  assert.equal(offline.message.targetLanguage, "en");
  assert.equal(offline.message.translationStyle,'pure');
  // Preferences affect only future messages; retries retain the original style.
  const retryAfterPreference=await request('/api/messages',{user:a,body:payload});
  assert.equal(retryAfterPreference.message.translationStyle,'mixed');
  assert.equal(retryAfterPreference.message.targetLanguage,'te');
  const first = await request(`/api/messages/${a.profile.suffix}?limit=1`, { user: b });
  const second = await request(`/api/messages/${a.profile.suffix}?limit=1&before=${encodeURIComponent(first.nextCursor)}`, { user: b });
  assert.equal(first.items.length, 1);
  assert.notEqual(first.items[0].messageId, second.items[0].messageId);
  // Concurrent network retries race at the storage layer but save exactly one message.
  const concurrent = { ...payload, messageId: "concurrent-0000001" };
  const results = await Promise.all([1, 2].map(() => request("/api/messages", { user: a, body: concurrent })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  assert.equal((await request(`/api/messages/${a.profile.suffix}`, { user: b })).items.length, 4);
  const call = { callId: `history-${a.profile.uid}`, callerUid: a.profile.uid, calleeUid: b.profile.uid,
    callerNumber: a.profile.number, calleeNumber: b.profile.number, status: "ringing",
    createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:01:00.000Z" };
  await store.createCall(call);
  const aCalls = await request("/api/calls", { user: a });
  const bCalls = await request("/api/calls", { user: b });
  assert.equal(aCalls.items[0].direction, "outgoing");
  assert.equal(bCalls.items[0].outcome, "missed");
  assert.equal((await request("/api/calls", { user: c })).items.length, 0);
  assert.equal((await request(`/api/calls/${call.callId}/accept`, { user: b, body: {} })).status, 412);
  const ended = await request(`/api/calls/${call.callId}/end`, { user: a, body: {} });
  assert.equal(ended.status, "ended");
  const endedAt = (await store.getCall(call.callId)).endedAt;
  await request(`/api/calls/${call.callId}/end`, { user: b, body: {} });
  assert.equal((await store.getCall(call.callId)).endedAt, endedAt);
  if (store instanceof AzureTableStore) {
    const reopened = new AzureTableStore(process.env.TEST_AZURE_STORAGE_CONNECTION_STRING);
    assert.equal((await reopened.listMessages(a.profile.uid)).length, 4);
    assert.equal((await reopened.listCalls(a.profile.uid)).length, 1);
  }
});
