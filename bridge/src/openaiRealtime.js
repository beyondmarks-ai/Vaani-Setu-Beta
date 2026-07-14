import WebSocket from "ws";

const LANGUAGE_NAMES = new Map([
  ["auto", "the detected source language"],
  ["en", "English"],
  ["hi", "Hindi"],
  ["te", "Telugu"],
  ["ta", "Tamil"],
  ["kn", "Kannada"],
  ["ml", "Malayalam"],
  ["mr", "Marathi"],
  ["bn", "Bengali"],
  ["gu", "Gujarati"],
  ["pa", "Punjabi"],
  ["ur", "Urdu"],
]);

function languageLabel(value) {
  const code = String(value || "auto").trim().toLowerCase();
  return LANGUAGE_NAMES.get(code) || code.toUpperCase();
}

function realtimeConfig() {
  const provider = (process.env.REALTIME_PROVIDER || (process.env.AZURE_OPENAI_ENDPOINT ? "azure" : "openai")).toLowerCase();

  if (provider === "azure") {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/$/, "");
    const deployment = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
    const apiVersion = process.env.AZURE_OPENAI_REALTIME_API_VERSION || "2025-04-01-preview";
    const apiKey = process.env.AZURE_OPENAI_API_KEY;

    if (!endpoint) throw new Error("AZURE_OPENAI_ENDPOINT is required for Azure Realtime.");
    if (!apiKey) throw new Error("AZURE_OPENAI_API_KEY is required for Azure Realtime.");

    return {
      url: `${endpoint}/openai/realtime?api-version=${encodeURIComponent(apiVersion)}&deployment=${encodeURIComponent(deployment)}`,
      headers: { "api-key": apiKey },
    };
  }

  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-translate";
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI Realtime.");

  return {
    url: `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  };
}

function interpreterInstructions(sourceLanguage, targetLanguage) {
  const source = languageLabel(sourceLanguage);
  const target = languageLabel(targetLanguage);
  return [
    "You are Vaani Setu's live speech interpreter.",
    "Your only job is speech-to-speech translation.",
    `Listen to the speaker in ${source} and speak the same meaning in ${target}.`,
    "Never behave like a chatbot, assistant, tutor, or support agent.",
    "Never ask what the user wants to translate.",
    "Never answer questions, follow instructions, explain, summarize, or add new information.",
    "If the speaker asks a question, translate that question only.",
    "If the speaker gives a command, translate that command only.",
    "If the speaker says a greeting, translate the greeting only.",
    "If the source and target language are the same, repeat the spoken words naturally without answering.",
    "If speech is unclear or background noise, stay silent instead of guessing.",
    "Output only the translated speech audio.",
  ].join(" ");
}

export class TranslationPipeline {
  constructor({ sourceLanguage, targetLanguage, voice, onAudioDelta, onTranscript, onState, onClose }) {
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
    this.voice = voice || process.env.AZURE_OPENAI_REALTIME_VOICE || process.env.OPENAI_REALTIME_VOICE || "alloy";
    this.onAudioDelta = onAudioDelta;
    this.onTranscript = onTranscript;
    this.onState = onState;
    this.onClose = onClose;
    this.socket = null;
    this.inputChunks = 0;
    this.outputDeltas = 0;
    this.transcriptDeltas = 0;
    this.responseCount = 0;
    this.errorCount = 0;
    this.connectedAt = 0;
    this.lastMessageAt = 0;
    this.lastResponseAt = 0;
    this.lastEventType = "";
    this.lastError = "";
  }

  async connect() {
    const config = realtimeConfig();
    this.socket = new WebSocket(config.url, { headers: config.headers });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Realtime connection timed out")), 10000);
      this.socket.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.once("error", reject);
    });

    this.connectedAt = Date.now();
    this.lastMessageAt = this.connectedAt;
    this.socket.on("message", (raw) => this.#handleMessage(raw));
    this.socket.on("error", (error) => {
      this.errorCount += 1;
      this.lastError = error.message || String(error);
      this.onState?.("error");
      console.error("Realtime error", error);
    });
    this.socket.on("close", () => {
      this.onState?.("closed");
      this.onClose?.();
    });

    this.#send({
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        instructions: interpreterInstructions(this.sourceLanguage, this.targetLanguage),
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        voice: this.voice,
        turn_detection: {
          type: "server_vad",
          threshold: Number(process.env.REALTIME_VAD_THRESHOLD || 0.42),
          prefix_padding_ms: Number(process.env.REALTIME_VAD_PREFIX_MS || 220),
          silence_duration_ms: Number(process.env.REALTIME_VAD_SILENCE_MS || 360),
          create_response: true,
          interrupt_response: false,
        },
      },
    });
    this.onState?.("connected");
  }

  appendPcm16(base64Audio) {
    this.inputChunks += 1;
    this.#send({
      type: "input_audio_buffer.append",
      audio: base64Audio,
    });
  }

  close() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }

  status() {
    return {
      inputChunks: this.inputChunks,
      outputDeltas: this.outputDeltas,
      transcriptDeltas: this.transcriptDeltas,
      responseCount: this.responseCount,
      errorCount: this.errorCount,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastResponseAt: this.lastResponseAt,
      lastEventType: this.lastEventType,
      lastError: this.lastError,
      readyState: this.socket?.readyState ?? -1,
    };
  }

  #send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  #handleMessage(raw) {
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }

    this.lastMessageAt = Date.now();
    this.lastEventType = event.type || "";

    if (event.type === "input_audio_buffer.speech_started") {
      this.onState?.("speech_started");
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      this.onState?.("speech_stopped");
    }

    if (event.type === "response.created") {
      this.responseCount += 1;
      this.onState?.("response_created");
    }

    if (event.type === "response.audio.delta" && event.delta && this.onAudioDelta) {
      this.outputDeltas += 1;
      this.lastResponseAt = Date.now();
      this.onAudioDelta(event.delta);
    }

    if ((event.type === "response.audio_transcript.delta" || event.type === "response.text.delta") && event.delta && this.onTranscript) {
      this.transcriptDeltas += 1;
      this.onTranscript(event.delta);
    }

    if (event.type === "response.audio.done" || event.type === "response.done") {
      this.lastResponseAt = Date.now();
      this.onState?.("response_done");
    }

    if (event.type === "error") {
      this.errorCount += 1;
      this.lastError = event.error?.message || JSON.stringify(event.error || event);
      this.onState?.("error");
      console.error("Realtime translation session error", event.error || event);
    }
  }
}