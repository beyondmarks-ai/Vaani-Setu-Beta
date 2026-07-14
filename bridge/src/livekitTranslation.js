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
import * as speechsdk from "microsoft-cognitiveservices-speech-sdk";

const LIVEKIT_RATE = 48000;
const SPEECH_INPUT_RATE = Number(process.env.AZURE_SPEECH_INPUT_RATE || 16000);
const TTS_OUTPUT_RATE = Number(process.env.AZURE_TTS_OUTPUT_RATE || 24000);
const CHANNELS = 1;
const BOT_PREFIX = "translator";
const MAX_TTS_CHARS = Number(process.env.TRANSLATION_MAX_TTS_CHARS || 260);

const LANGUAGE_LOCALES = {
  en: "en-IN",
  as: "as-IN",
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
  ur: "ur-IN",
};

const TARGET_LANGUAGES = {
  en: "en",
  as: "as",
  bn: "bn",
  gu: "gu",
  hi: "hi",
  kn: "kn",
  ml: "ml",
  mr: "mr",
  or: "or",
  pa: "pa",
  ta: "ta",
  te: "te",
  ur: "ur",
};

const TTS_VOICES = {
  en: { default: "en-IN-NeerjaNeural", female: "en-IN-NeerjaNeural", male: "en-IN-PrabhatNeural" },
  as: { default: "as-IN-YashicaNeural", female: "as-IN-YashicaNeural", male: "as-IN-PriyomNeural" },
  bn: { default: "bn-IN-TanishaaNeural", female: "bn-IN-TanishaaNeural", male: "bn-IN-BashkarNeural" },
  gu: { default: "gu-IN-DhwaniNeural", female: "gu-IN-DhwaniNeural", male: "gu-IN-NiranjanNeural" },
  hi: { default: "hi-IN-SwaraNeural", female: "hi-IN-SwaraNeural", male: "hi-IN-MadhurNeural" },
  kn: { default: "kn-IN-SapnaNeural", female: "kn-IN-SapnaNeural", male: "kn-IN-GaganNeural" },
  ml: { default: "ml-IN-SobhanaNeural", female: "ml-IN-SobhanaNeural", male: "ml-IN-MidhunNeural" },
  mr: { default: "mr-IN-AarohiNeural", female: "mr-IN-AarohiNeural", male: "mr-IN-ManoharNeural" },
  or: { default: "or-IN-SubhasiniNeural", female: "or-IN-SubhasiniNeural", male: "or-IN-SukantNeural" },
  pa: { default: "pa-IN-VaaniNeural", female: "pa-IN-VaaniNeural", male: "pa-IN-OjasNeural" },
  ta: { default: "ta-IN-PallaviNeural", female: "ta-IN-PallaviNeural", male: "ta-IN-ValluvarNeural" },
  te: { default: "te-IN-ShrutiNeural", female: "te-IN-ShrutiNeural", male: "te-IN-MohanNeural" },
  ur: { default: "ur-IN-GulNeural", female: "ur-IN-GulNeural", male: "ur-IN-SalmanNeural" },
};


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
  return TARGET_LANGUAGES[normalized] ? normalized : fallback;
}

function speechLocale(languageCode) {
  return LANGUAGE_LOCALES[code(languageCode)] || LANGUAGE_LOCALES.en;
}

function targetLanguage(languageCode) {
  return TARGET_LANGUAGES[code(languageCode)] || "en";
}

function ttsVoice(languageCode, preferredVoice) {
  const requested = String(preferredVoice || "").trim();
  if (/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/.test(requested)) return requested;
  const lang = code(languageCode);
  const voiceSet = TTS_VOICES[lang] || TTS_VOICES.en;
  const envName = `AZURE_TTS_VOICE_${lang.toUpperCase()}`;
  const alias = requested.toLowerCase();
  const mappedAlias = alias === "echo" ? voiceSet.male : voiceSet.female;
  return process.env[envName] || voiceSet[alias] || mappedAlias || voiceSet.default;
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

function startContinuousRecognition(recognizer) {
  return new Promise((resolve, reject) => {
    recognizer.startContinuousRecognitionAsync(resolve, reject);
  });
}

function stopContinuousRecognition(recognizer) {
  return new Promise((resolve) => {
    recognizer.stopContinuousRecognitionAsync(resolve, resolve);
  });
}

function escapeSsml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ssmlForText(languageCode, preferredVoice, text) {
  const voice = ttsVoice(languageCode, preferredVoice);
  const locale = speechLocale(languageCode);
  const pitch = process.env.AZURE_TTS_PITCH || "+12%";
  const rate = process.env.AZURE_TTS_RATE || "+8%";
  const volume = process.env.AZURE_TTS_VOLUME || "+8%";
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${voice}"><prosody pitch="${pitch}" rate="${rate}" volume="${volume}">${escapeSsml(text)}</prosody></voice></speak>`;
}
function synthesizeText(speechKey, speechRegion, languageCode, preferredVoice, text) {
  return new Promise((resolve, reject) => {
    const speechConfig = speechsdk.SpeechConfig.fromSubscription(speechKey, speechRegion);
    speechConfig.speechSynthesisLanguage = speechLocale(languageCode);
    speechConfig.speechSynthesisVoiceName = ttsVoice(languageCode, preferredVoice);
    speechConfig.speechSynthesisOutputFormat = speechsdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;

    const synthesizer = new speechsdk.SpeechSynthesizer(speechConfig, null);
    synthesizer.speakSsmlAsync(
      ssmlForText(languageCode, preferredVoice, text),
      (result) => {
        synthesizer.close();
        if (result.reason === speechsdk.ResultReason.SynthesizingAudioCompleted && result.audioData) {
          resolve(Buffer.from(result.audioData));
          return;
        }
        reject(new Error(result.errorDetails || `TTS failed with reason ${result.reason}`));
      },
      (error) => {
        synthesizer.close();
        reject(new Error(String(error)));
      },
    );
  });
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
  constructor({ callId, label, sourceLanguage, targetLanguage: outputLanguage, voice, outputSource, speechKey, speechRegion, shouldSuppressEcho, onOutput }) {
    this.callId = callId;
    this.label = label;
    this.outputSource = outputSource;
    this.speechKey = speechKey;
    this.speechRegion = speechRegion;
    this.shouldSuppressEcho = shouldSuppressEcho;
    this.onOutput = onOutput;
    this.sourceLanguage = code(sourceLanguage);
    this.targetLanguage = code(outputLanguage);
    this.voice = voice || "alloy";
    this.inputResampler = new AudioResampler(LIVEKIT_RATE, SPEECH_INPUT_RATE, CHANNELS, AudioResamplerQuality.QUICK);
    this.outputResampler = new AudioResampler(TTS_OUTPUT_RATE, LIVEKIT_RATE, CHANNELS, AudioResamplerQuality.QUICK);
    this.pushStream = null;
    this.recognizer = null;
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
    this.outputChain = Promise.resolve();
  }

  async start() {
    if (this.active) return;
    const format = speechsdk.AudioStreamFormat.getWaveFormatPCM(SPEECH_INPUT_RATE, 16, CHANNELS);
    this.pushStream = speechsdk.AudioInputStream.createPushStream(format);
    const audioConfig = speechsdk.AudioConfig.fromStreamInput(this.pushStream);
    const translationConfig = speechsdk.SpeechTranslationConfig.fromSubscription(this.speechKey, this.speechRegion);
    translationConfig.speechRecognitionLanguage = speechLocale(this.sourceLanguage);
    translationConfig.addTargetLanguage(targetLanguage(this.targetLanguage));
    translationConfig.outputFormat = speechsdk.OutputFormat.Simple;

    this.recognizer = new speechsdk.TranslationRecognizer(translationConfig, audioConfig);
    this.recognizer.recognizing = (_sender, event) => this.handleRecognizing(event);
    this.recognizer.recognized = (_sender, event) => this.handleRecognized(event);
    this.recognizer.canceled = (_sender, event) => this.handleCanceled(event);
    this.recognizer.sessionStarted = () => {
      this.state = "listening";
    };
    this.recognizer.sessionStopped = () => {
      if (this.active) this.state = "stopped";
    };

    await startContinuousRecognition(this.recognizer);
    this.active = true;
    this.state = "listening";
  }

  handleRecognizing(event) {
    const translated = event.result?.translations?.get(targetLanguage(this.targetLanguage));
    if (isUsefulText(translated)) {
      this.lastTranslatedText = translated;
      this.state = "recognizing";
    }
  }

  handleRecognized(event) {
    const result = event.result;
    if (!result || result.reason !== speechsdk.ResultReason.TranslatedSpeech) return;
    const directTranslation = trimForSpeech(result.translations?.get(targetLanguage(this.targetLanguage)));
    if (!isUsefulText(directTranslation)) return;
    const sourceText = result.text || "";
    if (this.shouldSuppressEcho?.(sourceText)) {
      this.state = "listening";
      console.log(`Suppressed translated audio echo ${this.callId}/${this.label}:`, sourceText);
      return;
    }
    this.recognizedCount += 1;
    this.lastRecognizedAt = Date.now();
    this.lastSourceText = sourceText;

    this.lastTranslatedText = directTranslation;
    this.state = "synthesizing";
    console.log(`Azure Speech translated ${this.callId}/${this.label}:`, {
      source: sourceText,
      translated: directTranslation,
    });
    this.queueSynthesis(directTranslation);
  }
  handleCanceled(event) {
    this.state = "failed";
    this.lastError = event.errorDetails || event.reason || "Azure Speech recognition canceled";
    console.error(`Azure Speech translation canceled ${this.callId}/${this.label}`, this.lastError);
  }

  handleInputFrame(frame) {
    if (!this.active || !this.pushStream) return;
    try {
      const resampledFrames = this.inputResampler.push(makeFrame(frame.data, LIVEKIT_RATE));
      for (const resampled of resampledFrames) {
        this.pushStream.write(pcmBuffer(resampled.data).buffer.slice(pcmBuffer(resampled.data).byteOffset, pcmBuffer(resampled.data).byteOffset + pcmBuffer(resampled.data).byteLength));
      }
      this.inputFrames += 1;
      this.lastInputAt = Date.now();
      if (this.state === "idle") this.state = "listening";
    } catch (error) {
      this.state = "failed";
      this.lastError = error.message || String(error);
      console.error(`Azure Speech input failed ${this.callId}/${this.label}`, error);
    }
  }

  queueSynthesis(text) {
    this.outputChain = this.outputChain
      .then(async () => {
        const audio = await synthesizeText(this.speechKey, this.speechRegion, this.targetLanguage, this.voice, text);
        this.onOutput?.(text);
        const samples = bufferToPcm16(audio);
        const resampledFrames = this.outputResampler.push(makeFrame(samples, TTS_OUTPUT_RATE));
        for (const frame of resampledFrames) {
          await this.outputSource.captureFrame(frame);
          this.outputFrames += 1;
        }
        for (const frame of this.outputResampler.flush()) {
          await this.outputSource.captureFrame(frame);
          this.outputFrames += 1;
        }
        this.synthesizedCount += 1;
        this.lastOutputAt = Date.now();
        this.state = "listening";
      })
      .catch((error) => {
        this.state = "failed";
        this.lastError = error.message || String(error);
        console.error(`Azure Speech SSML TTS failed ${this.callId}/${this.label}`, error);
      });
  }

  async stop() {
    this.active = false;
    try {
      this.pushStream?.close();
    } catch (_) {
      // Ignore stream close races.
    }
    try {
      if (this.recognizer) await stopContinuousRecognition(this.recognizer);
      this.recognizer?.close();
      await this.outputChain;
      this.inputResampler.close();
      this.outputResampler.close();
    } catch (error) {
      console.error(`Azure Speech direction cleanup failed ${this.callId}/${this.label}`, error);
    }
  }

  status() {
    return {
      active: this.active,
      state: this.state,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      inputFrames: this.inputFrames,
      outputFrames: this.outputFrames,
      recognizedCount: this.recognizedCount,
      synthesizedCount: this.synthesizedCount,
      lastInputAt: this.lastInputAt,
      lastRecognizedAt: this.lastRecognizedAt,
      lastOutputAt: this.lastOutputAt,
      lastSourceText: this.lastSourceText,
      lastTranslatedText: this.lastTranslatedText,
      lastError: this.lastError,
    };
  }
}

class LiveKitTranslationSession {
  constructor({ call, livekitUrl, apiKey, apiSecret, speechKey, speechRegion }) {
    this.call = call;
    this.callId = call.callId;
    this.livekitUrl = livekitUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.speechKey = speechKey;
    this.speechRegion = speechRegion;
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
      voice: call.calleeVoice || "alloy",
      outputSource: this.toCalleeSource,
      speechKey: this.speechKey,
      speechRegion: this.speechRegion,
      shouldSuppressEcho: (text) => this.isRecentEcho(call.callerUid, text),
      onOutput: (text) => this.rememberDeliveredAudio(call.calleeUid, text),
    });
    this.calleeToCaller = new DirectionPipeline({
      callId: this.callId,
      label: "callee-to-caller",
      sourceLanguage: call.calleeSpokenLanguage || call.calleeLanguage || "en",
      targetLanguage: call.callerListenLanguage || call.callerLanguage || "en",
      voice: call.callerVoice || "alloy",
      outputSource: this.toCallerSource,
      speechKey: this.speechKey,
      speechRegion: this.speechRegion,
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
    console.log(`Azure Speech translator connecting ${this.callId} as ${this.identity}`);
    this.active = true;
    await this.room.connect(this.livekitUrl, token, { autoSubscribe: true, dynacast: false });
    console.log(`Azure Speech translator connected ${this.callId}`);

    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant.publishTrack(this.toCallerTrack, options);
    await this.room.localParticipant.publishTrack(this.toCalleeTrack, options);
    console.log(`Azure Speech translator tracks published ${this.callId}`);
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
    console.log(`Azure Speech translator attached audio ${this.callId}/${participant.identity}`);
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
      provider: "azure-speech-translation",
      participant: this.identity,
      streamReaders: this.streamReaders.size,
      lastError: this.lastError,
      callerToCallee: this.callerToCallee.status(),
      calleeToCaller: this.calleeToCaller.status(),
    };
  }
}

export class TranslationManager {
  constructor({ livekitUrl, apiKey, apiSecret, speechKey, speechRegion }) {
    this.livekitUrl = livekitUrl;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.speechKey = speechKey;
    this.speechRegion = speechRegion;
    this.sessions = new Map();
  }

  async start(call) {
    if (!this.livekitUrl || !this.apiKey || !this.apiSecret) {
      console.warn("LiveKit translation is disabled because LiveKit config is missing.");
      return null;
    }
    if (!this.speechKey || !this.speechRegion) {
      console.warn("Azure Speech translation is disabled because AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing.");
      return null;
    }
    if (this.sessions.has(call.callId)) return this.sessions.get(call.callId);
    const session = new LiveKitTranslationSession({
      call,
      livekitUrl: this.livekitUrl,
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      speechKey: this.speechKey,
      speechRegion: this.speechRegion,
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
      provider: "azure-speech-translation",
      activeSessions: this.sessions.size,
      configured: Boolean(this.speechKey && this.speechRegion),
      calls: Array.from(this.sessions.keys()),
    };
  }
}