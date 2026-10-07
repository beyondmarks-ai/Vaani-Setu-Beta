# Vaani Setu Bridge

Node.js bridge service for Vaani Setu calls, translated messages, and history.

It handles:

- App JWT authentication
- Vaani call creation, accept, and end endpoints
- Azure WebSocket call signaling at `/ws/calls`
- `POST /api/realtime-token` selects Azure Web PubSub when configured, otherwise the built-in authenticated WebSocket
- LiveKit room token generation
- two-way Sarvam translation over LiveKit
- `POST /api/messages` for translated, idempotent message sending
- `GET /api/conversations` and `GET /api/messages/:suffix` for private message history
- `GET /api/calls` for participant-scoped call history

History endpoints for calls and messages return `{ items, nextCursor }`. Pass the returned cursor as the URL-encoded `before` query parameter for older entries; `limit` defaults to 50 and is capped at 100. A send requires `targetSuffix`, `text`, `sourceLanguage`, and a stable `messageId` (16–80 alphanumeric/hyphen characters). Reuse that ID when retrying the same content. The recipient's `messageLanguage` preference determines the target language, falling back to their existing listening language.

The recipient's `messageTranslationStyle` is `pure` (default) or `mixed` and is
saved through `PATCH /api/me` along with the existing profile fields. Pure uses
Mayura formal translation in the native script; mixed uses Mayura code-mixed
output with native-language words in their own script and English words in
English letters. English targets always use pure output. Each message stores
its actual `translationStyle`; changing preferences affects future incoming
messages across chats, and retries/history preserve the original result.
Same-language Indic messages are normalized through English to apply the style.
Stored messages from older versions without this field remain readable.

Azure Table Storage holds the original and translated text in `VaaniMessages`. Existing call records remain in `VaaniCalls`. Tables are created at startup; no historical call migration is needed. Participant-filtered history queries currently scan these tables before paginating; a larger deployment should add per-user history indexes.

## Local Install

```powershell
cd bridge
npm install
npm run lint
```

## Configuration

Set `BRIDGE_PUBLIC_URL` to the bridge's public HTTPS origin behind a TLS proxy. The app obtains a short-lived, recipient-specific WebSocket URL from `/api/realtime-token`; reconnecting replays unexpired incoming invitations. Without Web PubSub, use a single bridge replica because live socket connections are held in memory. Firebase Admin credentials enable background push separately; they are not required for incoming calls while the app is open.

Create a local `.env` from `.env.azure.example` if you run locally. Real `.env` files are ignored by git.

Required production variables:

```text
FIREBASE_SERVICE_ACCOUNT_BASE64
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
BRIDGE_JWT_SECRET
SARVAM_API_KEY
AZURE_STORAGE_CONNECTION_STRING
```

Optional Sarvam tuning variables:

```text
SARVAM_TRANSLATE_TIMEOUT_MS
SARVAM_TTS_TIMEOUT_MS
SARVAM_TTS_PACE
```

The translation worker uses `saaras:v3` in same-language `transcribe`
mode, `mayura:v1` in `modern-colloquial` mode, and streaming
`bulbul:v3` speech. API keys stay on the backend and must never be bundled
into the Flutter APK.

Speech input is forwarded in 40 ms chunks. Every utterance, including short
replies, uses the persistent TTS WebSocket and starts playback on the first audio
chunk. REST synthesis is only a fallback when streaming fails before any audio
has been published; partially played speech is never repeated. The app's Odia
code remains `or`, mapped to Sarvam's `od-IN` at the provider boundary.

Per-direction status includes translation/synthesis queue depths and latency
measurements. Numeric `speech_latency` logs report first audio timing without
transcript content. `speechEndToAudioMs` starts at the provider's END_SPEECH event,
so it excludes silence detection before that event and device playback latency.

## Deploy

From the repo root:

```powershell
az containerapp up --name vaani-setu-bridge --resource-group <resource-group> --source bridge
```

Keep at least one replica warm for faster call setup:

```powershell
az containerapp update --name vaani-setu-bridge --resource-group <resource-group> --min-replicas 1
```
