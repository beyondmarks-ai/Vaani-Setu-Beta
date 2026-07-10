# Vaani Setu Beta

Vaani Setu is a Flutter calling prototype that assigns each signed-in user a six-digit Vaani number with the `0209` prefix, then connects users through LiveKit rooms using an Azure-hosted bridge.

## Current Stack

- Flutter Android app
- Firebase Auth for email/password sign-in
- Cloud Firestore for user numbers and call state
- Firebase Cloud Messaging for background incoming-call fallback
- Azure Container Apps bridge for call signaling and LiveKit token creation
- LiveKit for realtime audio rooms

## Local Setup

Install Flutter, Node.js, Firebase CLI, and Azure CLI. Then run:

```powershell
flutter pub get
cd bridge
npm install
cd ..
```

Firebase Android config is expected at:

```text
android/app/google-services.json
```

## Build Android

The app has a default bridge URL configured in code. To override it:

```powershell
flutter build apk --debug --dart-define=BRIDGE_URL=https://your-bridge-url
```

Default build:

```powershell
flutter build apk --debug
```

APK output:

```text
build/app/outputs/flutter-apk/app-debug.apk
```

## Azure Bridge

Deploy the bridge from the repo root:

```powershell
az containerapp up --name vaani-setu-bridge --resource-group <resource-group> --source bridge
```

Required runtime environment variables are documented in `bridge/.env.azure.example`. Do not commit real API keys, LiveKit secrets, service-account JSON, or JWT secrets.

## Firebase

Deploy Firestore rules:

```powershell
npx -y firebase-tools@latest deploy --only firestore:rules --project <firebase-project-id>
```

## Git Hygiene

Ignored locally:

- Flutter and Android build outputs
- `node_modules`
- `.env` files
- Firebase debug logs
- local Android SDK files