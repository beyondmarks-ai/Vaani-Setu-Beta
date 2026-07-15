import {
  AudioFrame,
  AudioResampler,
  AudioResamplerQuality,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { SarvamAIClient } from "sarvamai";

const LIVEKIT_RATE = 48000;
const SPEECH_INPUT_RATE = 16000;
const TTS_OUTPUT_RATE = 24000;
const CHANNELS = 1;
const BOT_PREFIX = "translator";
const MAX_TTS_CHARS = Number(process.env.TRANSLATION_MAX_TTS_CHARS || 260);
const TRANSLATE_TIMEOUT_MS = Number(process.env.SARVAM_TRANSLATE_TIMEOUT_MS || 3000);
const TTS_TIMEOUT_MS = Number(process.env.SARVAM_TTS_TIMEOUT_MS || 15000);
const TTS_PING_MS = 25000;
const TTS_STREAM_MIN_CHARS = 50;

const LANGUAGE_LOCALES = {
  en: "en-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  hi: "hi-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  or: "or-IN",
  pa: "pa-IN",
  ta: "ta-IN",
  te: "te-IN",
};

const SARVAM_SPEAKERS = new Set([
  "shubh",
  "aditya",
  "anand",
  "rahul",
  "rohan",
  "simran",
  "priya",
  "kavya",
  "ritu",
  "ishita",
]);


function pcmBuffer(samples) {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
}

function bufferToPcm16(buffer) {
  return new Int16Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 2));
}

function makeFrame(samples, sampleRate) {
  return new AudioFrame(samples, sampleRate, CHANNELS, Math.floor(samples.length / CHANNELS));
}

function code(value, fallback = "en") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return LANGUAGE_LOCALES[normalized] ? normalized : fallback;
}

function speechLocale(languageCode) {
  return LANGUAGE_LOCALES[code(languageCode)] || LANGUAGE_LOCALES.en;
}

function ttsSpeaker(preferredVoice) {
  const requested = String(preferredVoice || "").trim();
  const normalized = requested.toLowerCase();
  if (SARVAM_SPEAKERS.has(normalized)) return normalized;
  if (/Madhur|Prabhat|Bashkar|Niranjan|Gagan|Midhun|Manohar|Sukant|Ojas|Valluvar|Mohan|Salman|echo/i.test(requested)) {
    return "aditya";
  }
  return "simran";
}

function isUsefulText(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return false;
  if (cleaned.length < 2) return false;
  return /[\p{L}\p{N}]/u.test(cleaned);
}

function trimForSpeech(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_TTS_CHARS) return cleaned;
  return cleaned.slice(0, MAX_TTS_CHARS).replace(/\s+\S*$/, "");
}

function normalizedSpeech(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function isSimilarSpeech(left, right) {
  const a = normalizedSpeech(left);
  const b = normalizedSpeech(right);
  if (!a || !b) return false;

  const compactA = a.replace(/\s+/g, "");
  const compactB = b.replace(/\s+/g, "");
  if (compactA === compactB) return true;

  const shorter = compactA.length <= compactB.length ? compactA : compactB;
  const longer = compactA.length > compactB.length ? compactA : compactB;
  if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.7) return true;

  const aTokens = new Set(a.split(/\s+/));
  const bTokens = new Set(b.split(/\s+/));
  if (Math.min(aTokens.size, bTokens.size) < 2) return false;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, bTokens.size) >= 0.75;
}

async function withTimeout(task, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function translateWithSarvamFallback({
  sourceText,
  sourceLanguage,
  targetLanguage,
  translateOnce,
  onPivot,
}) {
  if (sourceLanguage === targetLanguage) return sourceText;
  try {
    const direct = await translateOnce(sourceText, sourceLanguage, targetLanguage);
    if (isUsefulText(direct)) return direct;
  } catch (error) {
    if (sourceLanguage === "en" || targetLanguage === "en") throw error;
    onPivot?.(error);
  }
  const english = await translateOnce(sourceText, sourceLanguage, "en");
  if (!isUsefulText(english)) throw new Error("Sarvam returned an empty English pivot translation.");
  const translated = await translateOnce(english, "en", targetLanguage);
  if (!isUsefulText(translated)) throw new Error("Sarvam returned an empty target translation.");
  return translated;
}

async function createBotToken({ apiKey, apiSecret, roomName, identity }) {
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: "Vaani Translator",
    ttl: "30m",
    metadata: JSON.stringify({ roomName, role: "translator" }),
  });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
  return token.toJwt();
}

class DirectionPipeline {
  constructor({ callId, label, sourceLanguage, targetLanguage: outputLanguage, voice, outputSource, sarvamApiKey, shouldSuppressEcho, onOutput }) {
    this.callId = callId;
    this.label = label;
    this.outputSource = outputSource;
    this.sarvamApiKey = sarvamApiKey;
    this.shouldSuppressEcho = shouldSuppressEcho;
    this.onOutput = onOutput;
    this.sourceLanguage = code(sourceLanguage);
    this.targetLanguage = code(outputLanguage);
    this.voice = ttsSpeaker(voice);
    this.client = new SarvamAIClient({ apiSubscriptionKey: sarvamApiKey });
    this.inputResampler = new AudioResampler(LIVEKIT_RATE, SPEECH_INPUT_RATE, CHANNELS, AudioResamplerQuality.QUICK);
    this.outputResampler = new AudioResampler(TTS_OUTPUT_RATE, LIVEKIT_RATE, CHANNELS, AudioResamplerQuality.QUICK);
    this.sttSocket = null;
    this.ttsSocket = null;
    this.ttsPingTimer = null;
    this.currentTts = null;
    this.pendingInput = Buffer.alloc(0);
    this.active = false;
    this.state = "idle";
    this.inputFrames = 0;
    this.outputFrames = 0;
    this.recognizedCount = 0;
    this.synthesizedCount = 0;
    this.lastInputAt = 0;
    this.lastRecognizedAt = 0;
    this.lastOutputAt = 0;
    this.lastSourceText = "";
    this.lastTranslatedText = "";
    this.lastError = "";
    this.lastTranslationLatencyMs = 0;
    this.lastSttLatencyMs = 0;
    this.processingChain = Promise.resolve();
    this.outputChain = Promise.resolve();
    this.ttsAudioChain = Promise.resolve();
  }

  async start() {
    if (this.active) return;
    this.active = true;
    try {
      await Promise.all([this.openSttSocket(), this.openTtsSocket()]);
      this.state = "listening";
    } catch (error) {
      this.active = false;
      throw error;
    }
  }

  async openSttSocket() {
    this.sttSocket = await this.client.speechToTextStreaming.connect({
      "language-code": speechLocale(this.sourceLanguage),
      model: "saaras:v3",
      mode: "transcribe",
      input_audio_codec: "pcm_s16le",
      sample_rate: String(SPEECH_INPUT_RATE),
      high_vad_sensitivity: true,
      vad_signals: true,
      flush_signal: true,
      "Api-Subscription-Key": this.sarvamApiKey,
      reconnectAttempts: 8,
    });
    this.sttSocket.on("open", () => {
      if (this.active) this.state = "listening";
    });
    this.sttSocket.on("message", (message) => this.handleSttMessage(message));
    this.sttSocket.on("close", (event) => {
      if (!this.active) return;
      this.state = "reconnecting-stt";
      this.lastError = `Sarvam STT socket closed (${event.code || "unknown"})`;
    });
    this.sttSocket.on("error", (error) => this.recordError("Sarvam STT", error));
    await this.sttSocket.waitForOpen();
  }

  async openTtsSocket() {
    clearInterval(this.ttsPingTimer);
    let configuredForConnection = false;
    this.ttsSocket = await this.client.textToSpeechStreaming.connect({
      model: "bulbul:v3",
      send_completion_event: true,
      "Api-Subscription-Key": this.sarvamApiKey,
      reconnectAttempts: 8,
    });
    this.ttsSocket.on("open", () => {
      if (!this.active) return;
      configuredForConnection = false;
      try {
        this.configureTtsSocket();
        configuredForConnection = true;
      } catch (error) {
        this.recordError("Sarvam TTS configuration", error);
      }
    });
    this.ttsSocket.on("message", (message) => this.handleTtsMessage(message));
    this.ttsSocket.on("close", (event) => {
      if (!this.active) return;
      this.lastError = `Sarvam TTS socket closed (${event.code || "unknown"})`;
      this.rejectCurrentTts(new Error(this.lastError));
    });
    this.ttsSocket.on("error", (error) => {
      this.recordError("Sarvam TTS", error);
      this.rejectCurrentTts(error);
    });
    await this.ttsSocket.waitForOpen();
    if (!configuredForConnection) {
      this.configureTtsSocket();
      configuredForConnection = true;
    }
    this.ttsPingTimer = setInterval(() => {
      try {
        if (this.ttsSocket?.readyState === 1) this.ttsSocket.ping();
      } catch (_) {
        // The SDK reconnect loop handles transient ping races.
      }
    }, TTS_PING_MS);
  }

  configureTtsSocket() {
    // The current Sarvam SDK adds legacy Bulbul fields (including an empty
    // dict_id) that the v3 endpoint rejects. Send the documented v3 payload
    // directly until the SDK serializer is corrected upstream.
    this.ttsSocket.socket.send(
      JSON.stringify({
        type: "config",
        data: {
          target_language_code: speechLocale(this.targetLanguage),
          speaker: this.voice,
          pace: Number(process.env.SARVAM_TTS_PACE || 1.05),
          speech_sample_rate: TTS_OUTPUT_RATE,
          output_audio_codec: "linear16",
          min_buffer_size: 50,
          max_chunk_length: 220,
        },
      }),
    );
  }

  handleSttMessage(message) {
    if (!this.active || !message) return;
    if (message.type === "events") {
      if (message.data?.signal_type === "START_SPEECH") this.state = "recognizing";
      if (message.data?.signal_type === "END_SPEECH") this.state = "transcribing";
      return;
    }
    if (message.type === "error") {
      this.recordError("Sarvam STT", new Error(message.data?.error || "Unknown STT error"));
      return;
    }
    if (message.type !== "data") return;
    const sourceText = trimForSpeech(message.data?.transcript);
    if (!isUsefulText(sourceText)) return;
    this.lastSttLatencyMs = Math.round(Number(message.data?.metrics?.processing_latency || 0) * 1000);
    this.handleTranscript(sourceText);
  }

  handleTranscript(sourceText) {
    if (this.shouldSuppressEcho?.(sourceText)) {
      this.state = "listening";
      console.log(`Suppressed translated audio echo ${this.callId}/${this.label}`);
      return;
    }
    this.recognizedCount += 1;
    this.lastRecognizedAt = Date.now();
    this.lastSourceText = sourceText;
    this.processingChain = this.processingChain
      .then(async () => {
        if (!this.active) return;
        this.state = "translating";
        const startedAt = Date.now();
        const translated = await this.translateTranscript(sourceText);
        if (!this.active || !isUsefulText(translated)) return;
        this.lastTranslationLatencyMs = Date.now() - startedAt;
        this.lastTranslatedText = translated;
        this.queueSynthesis(translated);
      })
      .catch((error) => {
        this.recordError("Sarvam translation", error);
      });
  }

  async translateOnce(input, sourceLanguage, targetLanguage) {
    const request = this.client.text.translate({
      input: trimForSpeech(input),
      source_language_code: speechLocale(sourceLanguage),
      target_language_code: speechLocale(targetLanguage),
      mode: "modern-colloquial",
      model: "mayura:v1",
      numerals_format: "international",
    });
    const response = await withTimeout(request, TRANSLATE_TIMEOUT_MS, "Sarvam translation");
    return trimForSpeech(response?.translated_text);
  }

  async translateTranscript(sourceText) {
    return translateWithSarvamFallback({
      sourceText,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      translateOnce: (text, source, target) => this.translateOnce(text, source, target),
      onPivot: () => {
        console.warn(`Sarvam direct language pair failed ${this.callId}/${this.label}; using documented English pivot.`);
      },
    });
  }

  handleInputFrame(frame) {
    if (!this.active || this.sttSocket?.readyState !== 1) return;
    try {
      const resampledFrames = this.inputResampler.push(makeFrame(frame.data, LIVEKIT_RATE));
      for (const resampled of resampledFrames) {
        this.pendingInput = Buffer.concat([this.pendingInput, pcmBuffer(resampled.data)]);
      }
      const chunkBytes = Math.floor((SPEECH_INPUT_RATE * 2) / 10);
      while (this.pendingInput.length >= chunkBytes) {
        const chunk = this.pendingInput.subarray(0, chunkBytes);
        this.pendingInput = this.pendingInput.subarray(chunkBytes);
        this.sttSocket.transcribe({
          audio: chunk.toString("base64"),
          sample_rate: SPEECH_INPUT_RATE,
          encoding: "audio/wav",
        });
      }
      this.inputFrames += 1;
      this.lastInputAt = Date.now();
    } catch (error) {
      this.recordError("Sarvam STT input", error);
    }
  }

  handleTtsMessage(message) {
    if (!message) return;
    if (message.type === "audio" && message.data?.audio) {
      const audio = Buffer.from(message.data.audio, "base64");
      this.ttsAudioChain = this.ttsAudioChain
        .catch(() => {})
        .then(() => this.captureTtsAudio(audio));
      return;
    }
    if (message.type === "event" && message.data?.event_type === "final") {
      const current = this.currentTts;
      if (!current) return;
      this.ttsAudioChain
        .then(async () => {
          for (const frame of this.outputResampler.flush()) {
            await this.outputSource.captureFrame(frame);
            this.outputFrames += 1;
          }
          current.resolve();
        })
        .catch(current.reject);
      return;
    }
    if (message.type === "error") {
      this.rejectCurrentTts(new Error(message.data?.message || "Sarvam TTS failed"));
    }
  }

  async captureTtsAudio(audio) {
    if (!this.active || audio.length < 2) return;
    const offset = audio.subarray(0, 4).toString("ascii") === "RIFF" ? Math.min(44, audio.length) : 0;
    const pcm = audio.subarray(offset, audio.length - ((audio.length - offset) % 2));
    if (!pcm.length) return;
    const samples = bufferToPcm16(pcm);
    for (const frame of this.outputResampler.push(makeFrame(samples, TTS_OUTPUT_RATE))) {
      await this.outputSource.captureFrame(frame);
      this.outputFrames += 1;
    }
  }

  async synthesizeShort(text) {
    const response = await withTimeout(
      this.client.textToSpeech.convert({
        text,
        target_language_code: speechLocale(this.targetLanguage),
        speaker: this.voice,
        pace: Number(process.env.SARVAM_TTS_PACE || 1.05),
        speech_sample_rate: TTS_OUTPUT_RATE,
        model: "bulbul:v3",
        output_audio_codec: "wav",
        temperature: Number(process.env.SARVAM_TTS_TEMPERATURE || 0.6),
      }),
      TTS_TIMEOUT_MS,
      "Sarvam short TTS",
    );
    const audios = response?.audios || response?.data?.audios;
    if (!Array.isArray(audios) || !audios.length) {
      throw new Error("Sarvam short TTS returned no audio.");
    }
    for (const encoded of audios) {
      await this.captureTtsAudio(Buffer.from(encoded, "base64"));
    }
    for (const frame of this.outputResampler.flush()) {
      await this.outputSource.captureFrame(frame);
      this.outputFrames += 1;
    }
  }

  rejectCurrentTts(error) {
    const current = this.currentTts;
    if (current) current.reject(error instanceof Error ? error : new Error(String(error)));
  }

  async synthesize(text) {
    if (!this.active) return;
    this.state = "synthesizing";
    this.onOutput?.(text);
    if (Array.from(text).length < TTS_STREAM_MIN_CHARS) {
      await this.synthesizeShort(text);
      this.synthesizedCount += 1;
      this.lastOutputAt = Date.now();
      if (this.active) this.state = "listening";
      return;
    }
    if (!this.ttsSocket) await this.openTtsSocket();
    if (this.ttsSocket?.readyState !== 1) {
      await withTimeout(this.ttsSocket.waitForOpen(), 5000, "Sarvam TTS reconnect");
    }
    if (this.ttsSocket?.readyState !== 1) throw new Error("Sarvam TTS socket is not connected.");
    try {
      await withTimeout(
        new Promise((resolve, reject) => {
          this.currentTts = {
            resolve: () => {
              this.currentTts = null;
              resolve();
            },
            reject: (error) => {
              this.currentTts = null;
              reject(error);
            },
          };
          this.ttsSocket.convert(text);
          this.ttsSocket.flush();
        }),
        TTS_TIMEOUT_MS,
        "Sarvam TTS",
      );
    } catch (error) {
      this.currentTts = null;
      try {
        this.ttsSocket?.close();
      } catch (_) {
        // Recreate the socket before the next utterance.
      }
      this.ttsSocket = null;
      throw error;
    }
    this.synthesizedCount += 1;
    this.lastOutputAt = Date.now();
    if (this.active) this.state = "listening";
  }

  queueSynthesis(text) {
    this.outputChain = this.outputChain
      .then(() => this.synthesize(text))
      .catch((error) => this.recordError("Sarvam TTS", error));
  }

  recordError(stage, error) {
    this.lastError = error?.message || String(error);
    if (this.active) this.state = "failed";
    console.error(`${stage} failed ${this.callId}/${this.label}`, error);
  }

  async stop() {
    this.active = false;
    clearInterval(this.ttsPingTimer);
    try {
      if (this.pendingInput.length && this.sttSocket?.readyState === 1) {
        this.sttSocket.transcribe({
          audio: this.pendingInput.toString("base64"),
          sample_rate: SPEECH_INPUT_RATE,
          encoding: "audio/wav",
        });
      }
      this.sttSocket?.close();
      this.rejectCurrentTts(new Error("Call ended."));
      this.ttsSocket?.close();
      await Promise.allSettled([this.processingChain, this.outputChain, this.ttsAudioChain]);
      this.inputResampler.close();
      this.outputResampler.close();
    } catch (error) {
      console.error(`Sarvam direction cleanup failed ${this.callId}/${this.label}`, error);
    }
  }

  status() {
    return {
      active: this.active,
      state: this.state,
      sttMode: "transcribe",
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      voice: this.voice,
      inputFrames: this.inputFrames,
      outputFrames: this.outputFrames,
      recognizedCount: this.recognizedCount,
      synthesizedCount: this.synthesizedCount,
      lastInputAt: this.lastInputAt,
      lastRecognizedAt: this.lastRecognizedAt,
      lastOutputAt: this.lastOutputAt,
      lastSourceText: this.lastSourceText,
      lastTranslatedText: this.lastTranslatedText,
      lastSttLatencyMs: this.lastSttLatencyMs,
      lastTranslationLatencyMs: this.lastTranslationLatencyMs,
      lastError: this.lastError,
    };
  }
}

class LiveKitTranslationSession {
  constructor({ call, livekitUrl, apiKey, apiSecret, sarvamApiKey }) {
    this.call = call;
    this.callId = call.callId;
    this.livekitUrl = livekitUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.sarvamApiKey = sarvamApiKey;
    this.identity = `${BOT_PREFIX}-${this.callId}`;
    this.room = new Room();
    this.active = false;
    this.lastError = "";
    this.streamReaders = new Map();
    this.recentDeliveredAudio = new Map();
    this.toCallerSource = new AudioSource(LIVEKIT_RATE, CHANNELS, 2000);
    this.toCalleeSource = new AudioSource(LIVEKIT_RATE, CHANNELS, 2000);
    this.toCallerTrack = LocalAudioTrack.createAudioTrack(`translated-to-${call.callerUid}`, this.toCallerSource);
    this.toCalleeTrack = LocalAudioTrack.createAudioTrack(`translated-to-${call.calleeUid}`, this.toCalleeSource);

    this.callerToCallee = new DirectionPipeline({
      callId: this.callId,
      label: "caller-to-callee",
      sourceLanguage: call.callerSpokenLanguage || call.callerLanguage || "en",
      targetLanguage: call.calleeListenLanguage || call.calleeLanguage || "en",
      voice: call.calleeVoice || "simran",
      outputSource: this.toCalleeSource,
      sarvamApiKey: this.sarvamApiKey,
      shouldSuppressEcho: (text) => this.isRecentEcho(call.callerUid, text),
      onOutput: (text) => this.rememberDeliveredAudio(call.calleeUid, text),
    });
    this.calleeToCaller = new DirectionPipeline({
      callId: this.callId,
      label: "callee-to-caller",
      sourceLanguage: call.calleeSpokenLanguage || call.calleeLanguage || "en",
      targetLanguage: call.callerListenLanguage || call.callerLanguage || "en",
      voice: call.callerVoice || "simran",
      outputSource: this.toCallerSource,
      sarvamApiKey: this.sarvamApiKey,
      shouldSuppressEcho: (text) => this.isRecentEcho(call.calleeUid, text),
      onOutput: (text) => this.rememberDeliveredAudio(call.callerUid, text),
    });
  }

  rememberDeliveredAudio(userId, text) {
    const now = Date.now();
    const recent = this.recentDeliveredAudio.get(userId) || [];
    recent.push({ text, at: now });
    this.recentDeliveredAudio.set(userId, recent.filter((item) => now - item.at < 8000).slice(-4));
  }

  isRecentEcho(userId, text) {
    const now = Date.now();
    const recent = (this.recentDeliveredAudio.get(userId) || []).filter((item) => now - item.at < 8000);
    this.recentDeliveredAudio.set(userId, recent);
    return recent.some((item) => isSimilarSpeech(item.text, text));
  }

  async start() {
    if (this.active) return;
    await Promise.all([this.callerToCallee.start(), this.calleeToCaller.start()]);

    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      this.attachRemoteAudio(track, publication, participant);
    });
    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      this.maybeSubscribe(publication, participant);
    });
    this.room.once(RoomEvent.Disconnected, () => {
      this.active = false;
    });

    const token = await createBotToken({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      roomName: this.callId,
      identity: this.identity,
    });
    console.log(`Sarvam translator connecting ${this.callId} as ${this.identity}`);
    this.active = true;
    await this.room.connect(this.livekitUrl, token, { autoSubscribe: true, dynacast: false });
    console.log(`Sarvam translator connected ${this.callId}`);

    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant.publishTrack(this.toCallerTrack, options);
    await this.room.localParticipant.publishTrack(this.toCalleeTrack, options);
    console.log(`Sarvam translator tracks published ${this.callId}`);
    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        this.maybeSubscribe(publication, participant);
      }
    }
  }

  maybeSubscribe(publication, participant) {
    if (!participant || participant.identity === this.identity) return;
    if (publication.kind !== TrackKind.KIND_AUDIO) return;
    if (participant.identity !== this.call.callerUid && participant.identity !== this.call.calleeUid) return;
    try {
      publication.setSubscribed(true);
    } catch (error) {
      this.lastError = error.message || String(error);
      console.error(`Translator subscribe failed ${this.callId}`, error);
    }
  }

  attachRemoteAudio(track, publication, participant) {
    if (!track || !publication || !participant) return;
    if (participant.identity === this.identity) return;
    if (participant.identity !== this.call.callerUid && participant.identity !== this.call.calleeUid) return;
    if (publication.kind !== TrackKind.KIND_AUDIO) return;

    const key = `${participant.identity}:${publication.sid || track.sid || publication.name}`;
    if (this.streamReaders.has(key)) return;

    const direction = participant.identity === this.call.callerUid ? this.callerToCallee : this.calleeToCaller;
    console.log(`Sarvam translator attached audio ${this.callId}/${participant.identity}`);
    const stream = new AudioStream(track, LIVEKIT_RATE, CHANNELS);
    const reader = stream.getReader();
    this.streamReaders.set(key, reader);

    void (async () => {
      try {
        while (this.active) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          direction.handleInputFrame(value);
        }
      } catch (error) {
        if (this.active) {
          this.lastError = error.message || String(error);
          console.error(`Translator audio stream failed ${this.callId}/${participant.identity}`, error);
        }
      } finally {
        this.streamReaders.delete(key);
        try {
          reader.releaseLock();
        } catch (_) {
          // Reader may already be released by cancellation.
        }
      }
    })();
  }

  async stop() {
    this.active = false;
    for (const reader of this.streamReaders.values()) {
      try {
        await reader.cancel();
      } catch (_) {
        // Ignore cancellation races while the room is disconnecting.
      }
    }
    this.streamReaders.clear();
    await Promise.allSettled([this.callerToCallee.stop(), this.calleeToCaller.stop()]);
    await Promise.allSettled([this.toCallerTrack.close(), this.toCalleeTrack.close()]);
    await Promise.allSettled([this.toCallerSource.close(), this.toCalleeSource.close()]);
    try {
      await this.room.disconnect();
    } catch (error) {
      console.error(`Translator room disconnect failed ${this.callId}`, error);
    }
  }

  status() {
    return {
      active: this.active,
      provider: "sarvam-saaras-mayura-bulbul",
      participant: this.identity,
      streamReaders: this.streamReaders.size,
      lastError: this.lastError,
      callerToCallee: this.callerToCallee.status(),
      calleeToCaller: this.calleeToCaller.status(),
    };
  }
}

export class TranslationManager {
  constructor({ livekitUrl, apiKey, apiSecret, sarvamApiKey }) {
    this.livekitUrl = livekitUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.sarvamApiKey = sarvamApiKey;
    this.sessions = new Map();
  }

  async start(call) {
    if (!this.livekitUrl || !this.apiKey || !this.apiSecret) {
      console.warn("LiveKit translation is disabled because LiveKit config is missing.");
      return null;
    }
    if (!this.sarvamApiKey) {
      console.warn("Sarvam translation is disabled because SARVAM_API_KEY is missing.");
      return null;
    }
    if (this.sessions.has(call.callId)) return this.sessions.get(call.callId);
    const session = new LiveKitTranslationSession({
      call,
      livekitUrl: this.livekitUrl,
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      sarvamApiKey: this.sarvamApiKey,
    });
    this.sessions.set(call.callId, session);
    try {
      await session.start();
      return session;
    } catch (error) {
      this.sessions.delete(call.callId);
      await session.stop().catch(() => {});
      throw error;
    }
  }

  async stop(callId) {
    const session = this.sessions.get(callId);
    if (!session) return;
    this.sessions.delete(callId);
    await session.stop();
  }

  status(callId) {
    if (callId) return this.sessions.get(callId)?.status() || { active: false };
    return {
      provider: "sarvam-saaras-mayura-bulbul",
      activeSessions: this.sessions.size,
      configured: Boolean(this.sarvamApiKey),
      colloquialConfigured: Boolean(this.sarvamApiKey),
      calls: Array.from(this.sessions.keys()),
    };
  }
}
