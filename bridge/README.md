# Vaani Setu Bridge

Node.js bridge service for Vaani Setu calls.

It handles:

- Firebase ID token verification
- Vaani call creation, accept, and end endpoints
- Azure WebSocket call signaling at `/ws/calls`
- LiveKit room token generation
- optional Azure/OpenAI realtime translation plumbing

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
```

Optional realtime translation variables:

```text
REALTIME_PROVIDER
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_REALTIME_DEPLOYMENT
AZURE_OPENAI_REALTIME_API_VERSION
AZURE_OPENAI_API_KEY
OPENAI_API_KEY
```

## Deploy

From the repo root:

```powershell
az containerapp up --name vaani-setu-bridge --resource-group <resource-group> --source bridge
```

Keep at least one replica warm for faster call setup:

```powershell
az containerapp update --name vaani-setu-bridge --resource-group <resource-group> --min-replicas 1
```