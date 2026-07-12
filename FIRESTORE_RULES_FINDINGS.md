# Firestore Rules Findings

## Codebase Analysis

Language/framework: Flutter/Dart with Firebase Auth and Cloud Firestore.

Collections and paths:
- `users/{uid}`: private authenticated user profile.
- `numbers/{suffix}`: authenticated lookup for assigned two-digit suffixes.

Firestore queries and reads:
- `users/{uid}` one-document read/write through `NumberAssignmentService.ensureAssignedNumber`.
- `numbers/{suffix}` one-document read/write through `NumberAssignmentService.ensureAssignedNumber`.
- `numbers/{suffix}` one-document read through `NumberAssignmentService.findBySuffix` before starting a call.
- No collection list queries, `where`, `orderBy`, or `limit` clauses are used.

Data models:
- `users/{uid}`: `uid`, `email`, `suffix`, `number`, `createdAt`, `updatedAt`.
- `numbers/{suffix}`: `uid`, `suffix`, `number`, `createdAt`.

Devil's advocate attack notes:
- Public list exploit: unauthenticated reads denied; list on `numbers` denied because only `get` is allowed.
- Unauthorized user read/write: `users/{uid}` requires owner; `numbers` create requires request auth UID.
- Update bypass: validators are applied on create and update; immutable fields are protected.
- Ownership hijacking: `uid` must equal auth UID and cannot be changed.
- Resource exhaustion: all string fields have size and pattern limits.
- Required field omission/schema pollution: `keys().hasOnly` and `keys().hasAll` are used.
- PII leak: email exists only in owner-readable `users/{uid}`, not in public `numbers/{suffix}`.
- Query mismatch: app uses direct document gets only, which rules allow for authenticated users on `numbers` and owners on `users`.

Residual risk:
- Since the assignment transaction runs on the client, a modified client can choose any currently unclaimed suffix. Rules prevent duplicates and cross-user ownership but cannot enforce server-side allocation order. A Cloud Function would be stronger if arbitrary suffix choice must be prevented.
