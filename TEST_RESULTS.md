# Messaging and history validation — 7 October 2026

## Passed

- `flutter analyze`: no issues after the final implementation changes.
- Flutter tests: all 19 tests passed after the message-style toggle. Coverage includes incoming translation/original text, automatic refresh, writing/reading language selection, failed-send draft preservation, duplicate-safe retries, history loading/retry, conversation navigation, call direction/outcome/duration, saved reading/style preferences, failed preference saves, small-screen keyboard layout, HTML server errors, malformed success responses, incoming-call navigation on an idle screen, duplicate invitations, recipient checks, and sign-out during navigation.
- `npm run lint` in `bridge`: all three backend source files pass syntax checks.
- `npm test` in `bridge`: 15 passing tests, including speech translation, messaging API/translator/history and styles, the app's actual realtime-token/call-invitation flow, and the speech streaming regressions described below.
- Azurite storage integration: 4 passing tests using `TEST_AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`. Verified persisted messages and calls through a fresh Azure storage client.
- Live Sarvam samples: English → Hindi, Hindi → Telugu, and Telugu → Hindi returned translated text.
- Live messaging API flow with two local test accounts: Hindi → Telugu and Telugu → Hindi both sent, translated using Sarvam, saved, and reloaded with original and translated text intact.
- Android debug APK built successfully using the D: SDK, package cache, Gradle cache, and source snapshot. The call-signaling build completed in 1m 41s, followed by a 31s incremental build after a formatting correction. Final analysis reports no issues.
- Android 36.1 emulator smoke test: APK installation succeeded, the sign-in screen rendered, and tapping **New user? Create account** opened **Create your account**. No production account was created.
- Corrected the notification initialization icon from the removed mipmap resource to the existing drawable resource. Verified that the final compiled bundle contains the corrected reference.

The automated backend tests use local memory or Azurite. They exercise authenticated HTTP/WebSocket clients, offline/relogin recovery, pagination, concurrent retry deduplication, invalid input, translation-provider failure, unauthenticated requests, account isolation, expired-call rejection, call-history outcomes, invitation delivery, accept/end updates, and pending-invitation recovery. A separate live signaling probe used disposable production test accounts and removed them afterward, as detailed below.

## Remaining verification and rollout

- A physical two-phone exchange and audio-call quality remain unverified.
- The updated bridge is deployed and healthy; see the deployment verification below. Authenticated two-device messaging on the production service still needs a physical-device check. No production users were impersonated and no test messages were sent to real users.
- Background message push notifications are not included. Open conversation/history screens update automatically, and offline messages are retrieved on reconnect.

## Verified APK

- Path: `D:\Vaani-Setu-Validation\Vaani-Setu-message-styles.apk` (also copied to `Vaani-Setu-messaging-debug.apk`)
- Size: 202,688,446 bytes
- SHA-256: `BBC29A4CFFE565F132AA16CAE9B66F68E300C4A49866E4BFAA34EF9368AF69DD`
- Build log: `D:\Vaani-Setu-Validation\message-style-android-build.log`
- Login screenshot: `D:\Vaani-Setu-Validation\vaani-login.png`

## Live deployment and HTML response fix

The reported `FormatException` was reproduced against the deployed service: messaging and conversation routes returned HTTP 404 with an HTML body because the old backend image did not include those routes.

- Azure Container Registry build `cu2` succeeded for `ca8a2b0984bfacr.azurecr.io/vaani-setu-bridge:messages-20261007-jsonfix`.
- Updated the existing `vaani-setu-bridge` Container App in `vaani-setu-rg`, preserving its configured environment variables and secret references.
- Revision `vaani-setu-bridge--messages-20261007` is active and Healthy.
- Live `/health` reports build `messaging-history-20261007-1`, `messaging: true`, `callHistory: true`, `store: AzureTableStore`, and `sarvamConfigured: true`. Storage initialization completes before the server starts listening.
- Live unauthenticated GET requests to `/api/messages/02`, `/api/conversations`, and `/api/calls`, and POST `/api/messages`, all return HTTP 401 JSON with `Sign in before continuing.` This verifies route availability and the authentication guard, not a production message exchange.
- An unknown `/api` route returns HTTP 404 JSON, instead of an Express HTML error page.
- The client decoder now handles HTML error responses and malformed JSON without exposing a raw parsing exception. Five new regression tests cover this behavior.

The existing messaging APK can use the newly deployed messaging endpoints immediately. The replacement APK above includes defensive response handling and the later call-signaling fixes. The earlier emulator UI smoke test predates the latest calling-fix APK; the replacement passed analysis, the full Flutter suite, and the Android build.

Rollback image, if needed: `ca8a2b0984bfacr.azurecr.io/vaani-setu-bridge:cli-containerapp-20261001134048588714`.

## LiveKit configuration verification

The LiveKit Cloud sign-in completed for project `rakesh`. The official LiveKit CLI 2.18.8 was installed under `D:\Vaani-Setu-Validation\livekit-cli` and its download checksum was verified.

- Set `LIVEKIT_URL` and secret references for `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` on the existing Azure Container App, preserving other settings.
- Revision `vaani-setu-bridge--livekit-20261007` is Healthy, is the latest ready revision, and receives all ingress traffic.
- Executed a read-only LiveKit RoomService authentication check inside that deployed container. It succeeded (`LIVEKIT_AUTHENTICATED_rooms=0`).
- Two temporary RTC participants connected to the configured LiveKit Cloud project and received non-silent synthetic audio in both directions. The test room was deleted and its absence verified. Script: `D:\Vaani-Setu-Validation\verify-livekit.mjs`.
- The existing messaging health endpoint remains healthy after the configuration rollout. No APK change was required.

This checks deployed credentials and actual bidirectional media transport using test clients. A call between the two physical Android devices, including microphone permissions, ringing, and translated speech quality, remains unverified. The official LiveKit Docs MCP was also configured and its protocol handshake and tool discovery succeeded; it supplies documentation, not Cloud account access.

## Foreground call signaling fix

The receiving app was open but `/api/realtime-token` required Azure Web PubSub, which this deployment does not use. The endpoint now issues a one-hour token scoped to the built-in WebSocket. The app connects without waiting for FCM registration; the server replays still-ringing invitations after reconnect. The incoming-call presenter schedules a Flutter frame explicitly so an idle screen does not wait for another tap. Duplicate connections/invitations and sign-out races are guarded, and the native notification-cancel method is wired up.

- ACR build `cu3` succeeded for image `call-signaling-20261007`.
- Revision `vaani-setu-bridge--signaling-20261007` is Healthy and receives all traffic. Its live health response reports build `call-signaling-20261007-1`, `realtime: websocket`, and `livekitConfigured: true`.
- The live probe called the public registration, realtime-token, call-creation and call-end endpoints with two disposable accounts. Both clients connected through the returned public `wss://` URLs. The receiver got the matching `incoming_call` event and then the `ended` update. It printed `LIVE_PUBLIC_WSS_INVITATION_RECEIVED` and `LIVE_PUBLIC_WSS_END_RECEIVED`.
- The probe verified ownership before deleting its test users, email indexes, number reservations and call records, then printed `DISPOSABLE_TEST_ACCOUNTS_NUMBERS_AND_CALLS_REMOVED`. No real user was called. Probe source: `D:\Vaani-Setu-Validation\verify-deployed-call-signaling.mjs`.
- Background push remains disabled. The available Google account lacks IAM access to the app's existing Firebase project `vaani-setu-4afa4`; Firebase Admin credentials were not created or configured. This does not block the foreground WebSocket flow verified above.
- Install the calling-fix APK on both phones to receive the Flutter navigation and connection fixes. Physical Android-to-Android ringing/answering remains a user-device verification step.

## Translated speech latency

The backend now streams even very short replies over its persistent TTS socket,
instead of waiting for the complete REST audio response. Input batching is 40 ms,
and TTS buffering uses the provider's smaller supported chunk settings. Ordered
playback, pre-audio failure recovery, and protection against replaying partially
played speech are covered by regression tests. The same path applies to all
supported languages; no language pair or replacement voice/model was hardcoded.

- Backend syntax checks and all 14 tests pass. The five added tests cover short
  reply streaming, ordered socket reuse, failure recovery without duplicate
  playback, empty responses and late audio after stop, exact PCM batching, and
  the Odia provider locale mapping.
- Three alternating baseline/optimized runs sent the same English PCM fixture
  in real time through live STT, Hindi translation, and synthesized PCM output.
  Baseline speech-end-to-first-output measurements were 1761, 1848, and 1742 ms;
  optimized measurements were 1321, 1483, and 1319 ms. Median latency fell from
  **1761 to 1321 ms (440 ms / 25%)**. All six runs recognized and synthesized one
  utterance without errors.
- Live short-greeting streaming succeeded for English, Bengali, Gujarati,
  Hindi, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, and Telugu: all 11
  produced audio with zero REST fallbacks. First output after submitting text
  ranged from 244 to 441 ms in the final sweep. This measures TTS only.
- Fixed an existing Odia locale mismatch: the app retains `or`, while current
  Sarvam APIs receive `od-IN`. Live Odia STT connection and English/Odia
  translation in both directions succeeded.
- Artifacts: `D:\Vaani-Setu-Validation\speech-latency-comparison.log`,
  `streaming-language-results.log`, `benchmark-speech.mjs`, and `verify-odia.mjs`.
- ACR build `cu4` succeeded for image `speech-latency-20261007` (digest
  `sha256:9f73e25d07a04453d36c8dc8ccf8e49873ecf0fa658f2f3800a9a7d57bc7d7de`).
  Revision `vaani-setu-bridge--latency-20261007` is Healthy with 100% traffic.
  Public health reports `speech-latency-20261007-1`, configured LiveKit/Sarvam,
  WebSocket signaling, messaging, and call history. No active calls were present
  before rollout.
- Inside the deployed Linux container, short Hindi and Odia speech produced
  streamed PCM without REST fallback (first audio 237 and 272 ms respectively).
  The temporary probe was removed; it made no calls to real users. The previous
  `call-signaling-20261007` image remains available for rollback.

The timing comparison is a small synthetic benchmark using real speech services,
not a two-phone acoustic measurement or a benchmark of every language pair.
LiveKit transport, device playback, sentence length, and provider/network load
can add delay. Numeric per-direction latency and queue metrics were added for
diagnosis. This backend-only change requires no new APK; the previous Flutter
analysis/tests/build results above were not rerun for it.

## Pure and mixed message translation

The chat reading controls now include **Pure language** and **Mixed + English**.
Mixed output keeps Indian-language words in their native script and English
words in English letters, as requested. Each recipient's choice is saved to
their profile for new incoming messages in all chats. Previously saved messages
and retry results retain their original translation and style. English targets
use pure English and disable mixing. Call translation behavior is unchanged.

- `flutter analyze --no-pub`: no issues. All 19 Flutter tests pass, including
  style persistence/serialization, recovering the latest saved preference when
  reopening a chat, failed saves retaining the previous selection, original text
  for same-language rewrites, English-only behavior, and a 360×640 layout with
  a 300-pixel keyboard inset.
- Backend syntax checks and all 15 tests pass. Tests cover mode selection,
  English pivots preserving the final style, same-language normalization, Odia
  locale mapping, invalid styles, recipient-specific preferences, history, and
  stable retries after the recipient changes their preferences.
- Live provider samples returned both styles for all 11 supported languages.
  Hindi and Kannada examples distinguish formal native-script translation from
  native-script-plus-English output. Same-language Hindi style normalization
  also returned output. These are functional checks, not native-speaker quality
  certification; wording and borrowed terms can vary by sentence.
- Live sample log: `D:\Vaani-Setu-Validation\message-style-live-results.log`.
  Automated logs: `message-style-backend-tests.log` and
  `message-style-flutter-tests.log` in the same directory.
- ACR build `cu5` succeeded for image `message-styles-20261007`. Revision
  `vaani-setu-bridge--styles-20261007` is Healthy and receives 100% traffic;
  public health reports `message-styles-20261007-1`.
- A live public-API probe created two disposable accounts, saved recipient
  preferences, and exchanged four messages covering Hindi and Kannada in both
  styles. Saved history and retries preserved each original result despite
  subsequent preference changes. It printed
  `LIVE_STYLES_PREFERENCES_HISTORY_AND_RETRIES_VERIFIED`, then verified ownership
  and removed its accounts, number reservations, indexes, and messages.
  Probe source: `D:\Vaani-Setu-Validation\verify-deployed-message-styles.mjs`.
- The updated Android debug APK built successfully on D: in 3m 21s from
  `app-20261007-121035`. Its ZIP integrity and compiled toggle labels/profile
  field were verified. Install the message-styles APK above on both devices;
  physical-phone interaction with this toggle has not been tested here.

## D: build setup

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_android_on_d.ps1` for future builds. The script copies the Flutter SDK and this app's Dart dependencies to D:, creates a fresh source snapshot including uncommitted changes, and writes the APK to the path above. The original source repository and `android/local.properties` remain in place. The installed Android SDK is read from C:; build caches and temporary files use D:.

The previous failures came from C: running out of space and the shared Flutter SDK Gradle cache. The separate SDK copy on D: resolved the build failure. The test emulator also uses its own configuration and data on D:.

Temporary validation data and an isolated Gradle/dependency cache are under `D:\Vaani-Setu-Validation`. To relieve C: disk pressure while preserving generated artifacts, these ignored cache/output directories now use junctions to `D:\Vaani-Setu-Validation\previous-build`:

- `build/app/intermediates`
- `build/app/outputs`
- `.dart_tool/flutter_build`

Temporary Android and Azure storage emulators were stopped after testing. Use the verified APK above; the older APK under the original C: build directory predates these changes.
