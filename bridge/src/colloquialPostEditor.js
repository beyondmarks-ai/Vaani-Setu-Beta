const DEFAULT_TIMEOUT_MS = 900;
const DEFAULT_CIRCUIT_BREAK_MS = 30000;
const DEFAULT_FAILURE_LIMIT = 3;

const LANGUAGE_NAMES = {
  en: "Indian English",
  as: "Assamese",
  bn: "Bengali",
  gu: "Gujarati",
  hi: "Hindi",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  or: "Odia",
  pa: "Punjabi",
  ta: "Tamil",
  te: "Telugu",
  ur: "Urdu",
};

export const BUILT_IN_PROTECTED_TERMS = [
  "app",
  "call",
  "confirm",
  "email",
  "Google",
  "internet",
  "location",
  "meeting",
  "message",
  "mobile",
  "office",
  "online",
  "OTP",
  "password",
  "phone",
  "please",
  "project",
  "software",
  "time",
  "update",
  "WhatsApp",
];

function languageName(code) {
  return LANGUAGE_NAMES[String(code || "").toLowerCase()] || "the selected Indian language";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalized(value) {
  return cleanText(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function containsTerm(text, term) {
  return cleanText(text).toLocaleLowerCase().includes(cleanText(term).toLocaleLowerCase());
}

function numbersIn(text) {
  return cleanText(text).match(/\p{N}+(?:[.,:/-]\p{N}+)*/gu) || [];
}

function sentenceCount(text) {
  const chunks = cleanText(text).split(/[.!?।॥]+/u).filter(Boolean);
  return Math.max(1, chunks.length);
}

function questionLike(text) {
  return /[?？]\s*$/u.test(cleanText(text));
}

function tokenOverlap(left, right) {
  const leftTokens = new Set(normalized(left).split(/\s+/).filter((token) => token.length > 1));
  const rightTokens = new Set(normalized(right).split(/\s+/).filter((token) => token.length > 1));
  if (leftTokens.size < 4 || rightTokens.size < 2) return 1;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / leftTokens.size;
}

function looksLikeAddedReply(candidate, baseline) {
  const replyPatterns = [
    /\bas an ai\b/i,
    /\bhow can i help\b/i,
    /\bwhat (?:do|would) you want (?:me )?to translate\b/i,
    /\btell me what you want\b/i,
    /मैं आपकी कैसे मदद/u,
    /क्या अनुवाद करना चाहते/u,
    /నేను మీకు ఎలా సహాయం/u,
    /ఏమి అనువదించాలి/u,
  ];
  return replyPatterns.some((pattern) => pattern.test(candidate) && !pattern.test(baseline));
}

export function normalizeProtectedTerms(terms) {
  const result = [];
  const seen = new Set();
  for (const value of terms || []) {
    const term = cleanText(value);
    if (!term) continue;
    const key = term.toLocaleLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(term);
    }
  }
  return result;
}

export function extractProtectedTerms(sourceText, directTranslation, configuredTerms = []) {
  const combined = `${cleanText(sourceText)} ${cleanText(directTranslation)}`;
  const latinTokens = (combined.match(/[A-Za-z][A-Za-z0-9._+/#&()-]{1,39}/g) || [])
    .map((term) => term.replace(/[._+/#&()-]+$/g, ""))
    .filter(Boolean);
  const titlePhrases = combined.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  const detected = latinTokens.filter((term) =>
    /^[A-Z0-9._+/#&()-]{2,}$/.test(term) ||
    /[0-9._+/#&()-]/.test(term) ||
    /[a-z][A-Z]/.test(term),
  );
  const candidates = normalizeProtectedTerms([
    ...BUILT_IN_PROTECTED_TERMS,
    ...configuredTerms,
    ...detected,
    ...titlePhrases,
  ]);
  return candidates.filter((term) => containsTerm(combined, term));
}

export function validateColloquialCandidate({
  candidate,
  directTranslation,
  sourceText,
  protectedTerms = [],
}) {
  const text = cleanText(candidate);
  const baseline = cleanText(directTranslation);
  if (!text) return { ok: false, reason: "empty" };

  const ratio = text.length / Math.max(1, baseline.length);
  if (ratio < 0.45 || ratio > 1.8) return { ok: false, reason: "length" };
  if (questionLike(text) !== questionLike(baseline)) return { ok: false, reason: "intent" };
  if (sentenceCount(text) > sentenceCount(baseline) + 1) return { ok: false, reason: "sentences" };
  if (looksLikeAddedReply(text, baseline)) return { ok: false, reason: "reply" };

  for (const number of numbersIn(`${sourceText} ${baseline}`)) {
    if (!text.includes(number)) return { ok: false, reason: "number" };
  }
  for (const term of extractProtectedTerms(sourceText, baseline, protectedTerms)) {
    if (!containsTerm(text, term)) return { ok: false, reason: `term:${term}` };
  }
  if (tokenOverlap(baseline, text) < 0.25) return { ok: false, reason: "overlap" };

  return { ok: true, text };
}

function postEditorConfig(env) {
  const endpoint = String(env.AZURE_OPENAI_ENDPOINT || "").replace(/\/$/, "");
  const apiKey = String(env.AZURE_OPENAI_API_KEY || "");
  const deployment = String(env.AZURE_OPENAI_TEXT_DEPLOYMENT || env.AZURE_OPENAI_CHAT_DEPLOYMENT || "gpt-4o");
  const apiVersion = String(env.AZURE_OPENAI_TEXT_API_VERSION || "2025-01-01-preview");
  const enabled = String(env.COLLOQUIAL_POST_EDIT_ENABLED || "true").toLowerCase() !== "false";
  return { endpoint, apiKey, deployment, apiVersion, enabled };
}

export class ColloquialPostEditor {
  constructor({
    env = process.env,
    fetchImpl = fetch,
    now = () => Date.now(),
    timeoutMs = Number(env.COLLOQUIAL_POST_EDIT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    failureLimit = DEFAULT_FAILURE_LIMIT,
    circuitBreakMs = DEFAULT_CIRCUIT_BREAK_MS,
  } = {}) {
    this.config = postEditorConfig(env);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.failureLimit = failureLimit;
    this.circuitBreakMs = circuitBreakMs;
    this.consecutiveFailures = 0;
    this.disabledUntil = 0;
    this.acceptedCount = 0;
    this.fallbackCount = 0;
    this.lastReason = "";
    this.lastLatencyMs = 0;
  }

  get configured() {
    return Boolean(
      this.config.enabled &&
        this.config.endpoint &&
        this.config.apiKey &&
        this.config.deployment,
    );
  }

  async edit({
    sourceLanguage,
    targetLanguage,
    sourceText,
    directTranslation,
    protectedTerms = [],
  }) {
    const baseline = cleanText(directTranslation);
    const startedAt = this.now();

    if (!this.configured) return this.fallback(baseline, "disabled", startedAt, false);
    if (targetLanguage === "en") return this.fallback(baseline, "target-english", startedAt, false);
    if (startedAt < this.disabledUntil) return this.fallback(baseline, "circuit-open", startedAt, false);

    const requiredTerms = extractProtectedTerms(sourceText, baseline, protectedTerms);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = `${this.config.endpoint}/openai/deployments/${encodeURIComponent(this.config.deployment)}/chat/completions?api-version=${encodeURIComponent(this.config.apiVersion)}`;
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "api-key": this.config.apiKey,
          "content-type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          temperature: 0,
          max_tokens: 180,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "You are a stateless translation post-editor, never an assistant.",
                "Return exactly one JSON object with one key named translation.",
                "Do not answer the speaker, continue a conversation, explain, or add information.",
                "Keep the exact meaning, speaker, tense, question-vs-statement intent, names, numbers, and protected terms.",
                "Rewrite only into simple everyday spoken Indian language with balanced common English words.",
                "For Hindi use casual modern Hindustani, never literary or Sanskrit-heavy wording.",
                "For Telugu use modern conversational Telugu, never literary or official wording.",
                "For other Indian languages use their normal everyday conversational register.",
                "If target is English, leave the direct translation unchanged.",
              ].join(" "),
            },
            {
              role: "user",
              content: JSON.stringify({
                sourceLanguage: languageName(sourceLanguage),
                targetLanguage: languageName(targetLanguage),
                sourceText: cleanText(sourceText),
                directTranslation: baseline,
                protectedTerms: requiredTerms,
              }),
            },
          ],
        }),
      });

      if (!response.ok) throw new Error(`post-edit-http-${response.status}`);
      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content;
      if (typeof raw !== "string") throw new Error("post-edit-missing-content");
      const parsed = JSON.parse(raw);
      const validation = validateColloquialCandidate({
        candidate: parsed.translation,
        directTranslation: baseline,
        sourceText,
        protectedTerms,
      });
      if (!validation.ok) throw new Error(`post-edit-invalid-${validation.reason}`);

      this.consecutiveFailures = 0;
      this.acceptedCount += 1;
      this.lastReason = "accepted";
      this.lastLatencyMs = this.now() - startedAt;
      return {
        text: validation.text,
        usedPostEdit: true,
        reason: "accepted",
        latencyMs: this.lastLatencyMs,
      };
    } catch (error) {
      return this.fallback(
        baseline,
        error?.name === "AbortError" ? "timeout" : error?.message || "error",
        startedAt,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  fallback(text, reason, startedAt, countFailure) {
    if (countFailure) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.failureLimit) {
        this.disabledUntil = this.now() + this.circuitBreakMs;
        this.consecutiveFailures = 0;
      }
    }
    this.fallbackCount += 1;
    this.lastReason = reason;
    this.lastLatencyMs = this.now() - startedAt;
    return {
      text,
      usedPostEdit: false,
      reason,
      latencyMs: this.lastLatencyMs,
    };
  }

  status() {
    return {
      configured: this.configured,
      acceptedCount: this.acceptedCount,
      fallbackCount: this.fallbackCount,
      circuitOpen: this.now() < this.disabledUntil,
      disabledUntil: this.disabledUntil,
      lastReason: this.lastReason,
      lastLatencyMs: this.lastLatencyMs,
    };
  }
}

