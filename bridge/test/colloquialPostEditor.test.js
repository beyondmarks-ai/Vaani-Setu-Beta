import assert from "node:assert/strict";
import test from "node:test";

import {
  ColloquialPostEditor,
  extractProtectedTerms,
  normalizeProtectedTerms,
  validateColloquialCandidate,
} from "../src/colloquialPostEditor.js";

test("normalizes protected terms case-insensitively", () => {
  assert.deepEqual(
    normalizeProtectedTerms([" Vaani Setu ", "OTP", "otp", "", "LiveKit"]),
    ["Vaani Setu", "OTP", "LiveKit"],
  );
});

test("detects configured and automatic English terms", () => {
  assert.deepEqual(
    extractProtectedTerms(
      "Please confirm the Vaani Setu meeting at 5 PM",
      "कृपया Vaani Setu meeting की पुष्टि करें",
      ["Vaani Setu"],
    ),
    ["confirm", "meeting", "please", "Vaani Setu", "PM"],
  );
});

test("accepts conversational output that preserves intent and terms", () => {
  const result = validateColloquialCandidate({
    sourceText: "Please confirm the Vaani Setu meeting at 5 PM.",
    directTranslation: "कृपया Vaani Setu meeting की पुष्टि शाम 5 बजे करें।",
    candidate: "Please Vaani Setu meeting शाम 5 PM बजे confirm कर देना।",
    protectedTerms: ["Vaani Setu"],
  });
  assert.equal(result.ok, true);
});

test("rejects added replies, changed intent, and missing protected terms", () => {
  assert.equal(
    validateColloquialCandidate({
      sourceText: "Translate this sentence.",
      directTranslation: "इस वाक्य का अनुवाद करें।",
      candidate: "आप क्या translate करना चाहते हैं?",
    }).reason,
    "intent",
  );

  assert.equal(
    validateColloquialCandidate({
      sourceText: "Open LiveKit now.",
      directTranslation: "LiveKit अभी खोलें।",
      candidate: "ऐप अभी खोलें।",
      protectedTerms: ["LiveKit"],
    }).reason,
    "term:LiveKit",
  );
});

test("post editor accepts valid JSON and reports metrics", async () => {
  const editor = new ColloquialPostEditor({
    env: {
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      AZURE_OPENAI_API_KEY: "test-key",
      AZURE_OPENAI_TEXT_DEPLOYMENT: "gpt-4o",
      COLLOQUIAL_POST_EDIT_ENABLED: "true",
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ translation: "मैं office जा रहा हूं।" }) } }],
      }),
    }),
  });

  const result = await editor.edit({
    sourceLanguage: "en",
    targetLanguage: "hi",
    sourceText: "I am going to the office.",
    directTranslation: "मैं कार्यालय जा रहा हूं।",
  });

  assert.equal(result.usedPostEdit, true);
  assert.equal(result.text, "मैं office जा रहा हूं।");
  assert.equal(editor.status().acceptedCount, 1);
});

test("three invalid model responses open the fallback circuit", async () => {
  let requests = 0;
  let now = 1000;
  const editor = new ColloquialPostEditor({
    env: {
      AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
      AZURE_OPENAI_API_KEY: "test-key",
      AZURE_OPENAI_TEXT_DEPLOYMENT: "gpt-4o",
      COLLOQUIAL_POST_EDIT_ENABLED: "true",
    },
    now: () => now,
    fetchImpl: async () => {
      requests += 1;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: "{bad json" } }] }),
      };
    },
  });

  for (let index = 0; index < 3; index += 1) {
    const result = await editor.edit({
      sourceLanguage: "en",
      targetLanguage: "te",
      sourceText: "Call me today.",
      directTranslation: "ఈ రోజు నాకు కాల్ చేయండి.",
    });
    assert.equal(result.usedPostEdit, false);
  }

  now += 1;
  const circuitResult = await editor.edit({
    sourceLanguage: "en",
    targetLanguage: "te",
    sourceText: "Call me today.",
    directTranslation: "ఈ రోజు నాకు కాల్ చేయండి.",
  });
  assert.equal(circuitResult.reason, "circuit-open");
  assert.equal(requests, 3);
});

