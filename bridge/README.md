# Vaani Setu Bridge

Node.js bridge service for Vaani Setu calls.

It handles:

- Firebase ID token verification
- Vaani call creation, accept, and end endpoints
- Azure WebSocket call signaling at `/ws/calls`
- LiveKit room token generation
- two-way Sarvam translation over LiveKit

## Local Install

```powershell
cd bridge
npm install
npm run lint
```

## Configuration

Create a local `.env` from `.env.azure.example` if you run locally. Real `.env` files are ignored by git.

Required production variables:

```text
FIREBASE_SERVICE_ACCOUNT_BASE64
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
BRIDGE_JWT_SECRET
SARVAM_API_KEY
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

## Deploy

From the repo root:

```powershell
az containerapp up --name vaani-setu-bridge --resource-group <resource-group> --source bridge
```

Keep at least one replica warm for faster call setup:

```powershell
az containerapp update --name vaani-setu-bridge --resource-group <resource-group> --min-replicas 1
```
