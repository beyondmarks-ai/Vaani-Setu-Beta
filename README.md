# Vaani Setu Beta

Vaani Setu is a Flutter Android calling and messaging app that assigns each signed-in user a six-digit Vaani number with the `0209` prefix. An Azure-hosted bridge handles accounts, translated messages, call history, and LiveKit audio calls.

## Current Stack

- Flutter Android app
- Azure bridge authentication for email/password sign-in
- Azure Table Storage for user numbers, call state, and message history
- Firebase Cloud Messaging for background incoming-call fallback
- Azure Container Apps bridge for call signaling and LiveKit token creation
- LiveKit for realtime audio rooms

## Messaging and History

Open **Messages** using the chat icon on the dialer, then choose **New message** and enter another user's last two digits or full Vaani number. In a conversation:

- **I am writing in** selects the language of each outgoing message.
- **Read new messages in** saves your preferred language for incoming messages across devices. It applies to future messages; saved translations retain their original target language.
- **Pure language / Mixed + English** saves your preferred style for new incoming messages. Mixed mode keeps Indian-language words in their native script and English words in English letters. English reading uses pure English.
- The recipient sees the translated text automatically. Replies use the other user's reading preference. Expand a message to see its original text or translation.
- Both versions and timestamps remain in message history. Offline recipients can retrieve messages when they reconnect. Open chats refresh automatically, with realtime events and a polling fallback.
- Failed translations keep the draft available to retry. Retrying the same draft in the open chat does not duplicate a successfully saved message.

The **Call history** icon shows incoming/outgoing calls, missed/unanswered or declined calls, completed calls, timestamps, and completed-call durations. Older calls and messages can be loaded from their history screens.

Messages support the same 11 Indian languages as calling, with a maximum of 1,000 UTF-16 code units per message. The current app target is Android.

Deploy the updated bridge as well as installing the updated APK. Set `AZURE_STORAGE_CONNECTION_STRING` for durable history and `SARVAM_API_KEY` for translation. Without Azure storage, the development fallback loses all data when the bridge restarts. Message updates currently appear while the app's conversation/history screens are open; background message push notifications are not implemented.

## Tests

```powershell
flutter analyze
flutter test
cd bridge
npm run lint
npm test
```

The tests cover translated messages in both directions, original text preservation, language selection, translation errors, retries, realtime events, offline/relogin history, pagination, account isolation, and call outcomes. Translation providers are stubbed in automated tests; they do not measure live Sarvam translation quality or LiveKit audio quality.

To run storage integration tests against a local Azurite Table service on port 10002:

```powershell
$env:TEST_AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true'
cd bridge
node --test test/messages.test.js
```

Use a local emulator or dedicated disposable test storage account: the integration test creates test users, messages, and calls.

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

If C: has limited space, build from a separate source snapshot on D: using:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_android_on_d.ps1
```

The script copies the Flutter SDK and Dart package cache to `D:\Vaani-Setu-Validation`, then uses D: for Gradle caches, temporary files, the source snapshot, and APK output. It reads the already-installed Android SDK from its existing location. The working repository and its local SDK settings stay in place. The finished APK is `D:\Vaani-Setu-Validation\Vaani-Setu-messaging-debug.apk`. Add `-Offline` when all required dependencies are already cached.

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
