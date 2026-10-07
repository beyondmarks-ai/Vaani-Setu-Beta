import { SarvamAIClient } from "sarvamai";

export const MAX_MESSAGE_LENGTH = 1000;

// Text messages must never pass through the speech pipeline's truncation.
export function createTextTranslator(apiKey, { client = apiKey ? new SarvamAIClient({ apiSubscriptionKey: apiKey }) : null } = {}) {
  return async (text, source, target, style = "pure") => {
    if (!["pure", "mixed"].includes(style)) throw new Error("Unknown message translation style.");
    if ((source === "en" && target === "en") || !/[\p{L}\p{N}]/u.test(text)) return text;
    if (!client) throw new Error("Message translation is not configured.");
    async function translate(input, from, to, outputStyle = style) {
      const response = await client.text.translate({
        input,
        source_language_code: `${from === "or" ? "od" : from}-IN`,
        target_language_code: `${to === "or" ? "od" : to}-IN`,
        mode: outputStyle === "mixed" && to !== "en" ? "code-mixed" : "formal",
        ...(outputStyle === "pure" ? { output_script: "fully-native" } : {}),
        model: "mayura:v1",
        numerals_format: "international",
      }, { timeoutInSeconds: 15, maxRetries: 0 });
      if (typeof response?.translated_text !== "string" || !response.translated_text.trim()) {
        throw new Error("Translation returned no text.");
      }
      return response.translated_text;
    }
    // Same-language messages can still need English words removed or added.
    // Mayura requires distinct source/target languages, so normalize via English.
    if (source === target) return translate(await translate(text, source, "en", "pure"), "en", target);
    try {
      return await translate(text, source, target);
    } catch (error) {
      if (source === "en" || target === "en") throw error;
      return translate(await translate(text, source, "en", "pure"), "en", target);
    }
  };
}

export function historyPage(items, query, idField) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const key = (item) => `${item.createdAt}|${item[idField]}`;
  const ordered = items.sort((a, b) => key(b).localeCompare(key(a)))
    .filter((item) => !query.before || key(item) < query.before);
  const page = ordered.slice(0, limit);
  return { items: page, nextCursor: ordered.length > limit ? key(page.at(-1)) : null };
}

export function callHistoryEntry(call, uid, now = Date.now()) {
  const outgoing = call.callerUid === uid;
  let outcome = call.status;
  if (call.acceptedAt) outcome = call.endedAt ? "completed" : "ongoing";
  else if (["rejected", "declined"].includes(call.endedReason) || call.status === "rejected") outcome = "declined";
  else if (call.status === "ended" || (call.status === "ringing" && Date.parse(call.expiresAt) <= now)) {
    outcome = outgoing ? "unanswered" : "missed";
  }
  return {
    callId: call.callId,
    remoteNumber: outgoing ? call.calleeNumber : call.callerNumber,
    direction: outgoing ? "outgoing" : "incoming",
    outcome,
    createdAt: call.createdAt,
    durationSeconds: call.acceptedAt && call.endedAt
      ? Math.max(0, Math.floor((Date.parse(call.endedAt) - Date.parse(call.acceptedAt)) / 1000)) : 0,
  };
}
