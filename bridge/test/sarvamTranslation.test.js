import assert from "node:assert/strict";
import test from "node:test";
import { translateWithSarvamFallback } from "../src/livekitTranslation.js";

test("same-language speech stays unchanged without translation", async () => {
  const calls = [];
  const result = await translateWithSarvamFallback({
    sourceText: "నమస్కారం",
    sourceLanguage: "te",
    targetLanguage: "te",
    translateOnce: async (...args) => {
      calls.push(args);
      return "unexpected";
    },
  });
  assert.equal(result, "నమస్కారం");
  assert.deepEqual(calls, []);
});

test("direct Sarvam language pair keeps the source-language transcript", async () => {
  const calls = [];
  const result = await translateWithSarvamFallback({
    sourceText: "మీరు ఎలా ఉన్నారు?",
    sourceLanguage: "te",
    targetLanguage: "hi",
    translateOnce: async (text, source, target) => {
      calls.push({ text, source, target });
      return "आप कैसे हैं?";
    },
  });
  assert.equal(result, "आप कैसे हैं?");
  assert.deepEqual(calls, [
    { text: "మీరు ఎలా ఉన్నారు?", source: "te", target: "hi" },
  ]);
});

test("unsupported direct Indic pair pivots only inside text translation", async () => {
  const calls = [];
  const result = await translateWithSarvamFallback({
    sourceText: "మీరు ఎలా ఉన్నారు?",
    sourceLanguage: "te",
    targetLanguage: "hi",
    translateOnce: async (text, source, target) => {
      calls.push({ text, source, target });
      if (source === "te" && target === "hi") throw new Error("unsupported pair");
      if (target === "en") return "How are you?";
      return "आप कैसे हैं?";
    },
  });
  assert.equal(result, "आप कैसे हैं?");
  assert.deepEqual(calls, [
    { text: "మీరు ఎలా ఉన్నారు?", source: "te", target: "hi" },
    { text: "మీరు ఎలా ఉన్నారు?", source: "te", target: "en" },
    { text: "How are you?", source: "en", target: "hi" },
  ]);
});

test("English language-pair failures are not hidden by a pivot", async () => {
  await assert.rejects(
    translateWithSarvamFallback({
      sourceText: "Hello",
      sourceLanguage: "en",
      targetLanguage: "hi",
      translateOnce: async () => {
        throw new Error("quota exhausted");
      },
    }),
    /quota exhausted/,
  );
});
