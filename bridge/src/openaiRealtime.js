import WebSocket from "ws";

function realtimeConfig() {
  const provider = (process.env.REALTIME_PROVIDER || (process.env.AZURE_OPENAI_ENDPOINT ? "azure" : "openai")).toLowerCase();

  if (provider === "azure") {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/$/, "");
    const deployment = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT || "gpt-realtime-2";
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

export class TranslationPipeline {
  constructor({ sourceLanguage, targetLanguage, onAudioDelta, onTranscript }) {
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
    this.onAudioDelta = onAudioDelta;
    this.onTranscript = onTranscript;
    this.socket = null;
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

    this.socket.on("message", (raw) => this.#handleMessage(raw));
    this.socket.on("error", (error) => console.error("Realtime error", error));

    this.#send({
      type: "translation_session.update",
      session: {
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        modalities: ["audio", "text"],
        instructions: `Translate ${this.sourceLanguage} speech to ${this.targetLanguage}. Output only the translated speech.`,
      },
    });
  }

  appendPcm16(base64Audio) {
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

    if (event.type && event.type.includes("audio") && event.delta && this.onAudioDelta) {
      this.onAudioDelta(event.delta);
    }

    if (event.type && event.type.includes("transcript") && event.delta && this.onTranscript) {
      this.onTranscript(event.delta);
    }

    if (event.type === "error") {
      console.error("Realtime translation session error", event.error || event);
    }
  }
}
