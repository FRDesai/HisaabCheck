# Sub-project C: Android app for shop owners

Date: 2026-11-26 · Requirements: `PRD1.md` FR-1, FR-2, FR-3, FR-5 to FR-14 (Android half), Journey 1 · Builds on sub-projects A and B.
Scope decided with the owner on 2026-11-26: **must-haves only.** Deadline: submit by the evening of 30 Nov 2026 IST.

## 1. Scope

**In scope**

- A Kotlin port of the bill-reading core (privacy shield, redaction plan, prompts, parser, checks, cascade, route log), proven against the same `shared/test-vectors` the web app uses.
- An Android app (Kotlin, Jetpack Compose): phone-number sign-in, consent, link to the CA's shop with an invite code, take or pick a bill photo, the hybrid cascade, "Send to cloud?" preview, result screen, save to Firestore.
- Firestore and Storage rules for shop owners, with emulator tests.
- Small web changes: the CA creates and shows an invite code for a shop; route logs accept the Android platform.

**Out of scope**

- Offline capture queue (FR-15), privacy-tier setting (FR-21), notifications (FR-22), Hindi labels (FR-23).
- A custom in-app camera. The system camera app and the system photo picker are used.
- Play Store release. The app is built as an APK and installed by hand.
- Owner-side list of rejected bills with the CA's note (the data is there; the screen is not).

## 2. What can and cannot be verified on the build machine

The Mac used for the build has no phone or emulator attached and the Firebase project does not exist yet.

- **Verified here:** the Kotlin core's unit tests (including every shared vector), the rules tests on the emulator, the web tests, and that the Android app compiles and assembles a debug APK.
- **Not verified here:** anything on a phone — sign-in, camera, OCR on real photos, on-device AI, the cloud call, App Check, saving. These go on a runtime check list for the owner.

On-device AI on Android (Gemini Nano through AICore) runs only on recent phones (Galaxy S25/S26 families, Pixel 9/10/11 at the time of writing). A Galaxy S23+ is not supported, so on that phone every bill takes the redact-then-cloud path. The on-device path is still built and is the first thing the cascade tries.

## 3. Approach

Chosen: **a pure Kotlin `core` module that mirrors the TypeScript core file for file, plus a thin Android `app` module.** The core has no Android or Firebase imports and is tested on the JVM against the shared vectors, so "the phone and the browser make the same decision on the same bill" is a tested fact, not a hope.

Rejected:

- *Share the TypeScript core through a WebView or a JS engine.* No port to keep in step, but the on-device and cloud calls, OCR and image painting are native anyway, debugging across the bridge is slow, and it weakens the "native Android" entry.
- *Kotlin Multiplatform for web and Android.* The right long-term answer; replacing the tested web core four days before the deadline is not.

## 4. Repository layout

```
android/
  settings.gradle.kts, build.gradle.kts, gradle.properties, gradle/libs.versions.toml, gradlew
  core/                      Kotlin JVM library, package com.hisaabcheck.core
    types, config (defaults, parseConfig), shield (gstin, verhoeff, shield, adequacy, piiLabels),
    redact (planRedaction), extract (prompts, parse), checks, router (processBill, timeout, routeLog)
    src/test: vectors from ../../shared/test-vectors + ports of the web core tests
  app/                       Android application, package com.hisaabcheck.app
    adapters/   FirebaseAiDevice, FirebaseAiCloud, MlKitOcr, BitmapPainter, ImageLoader,
                RemoteConfigSource, Store (Firestore + Storage)
    ui/         SignIn, Consent, LinkShop, Home, Processing, SendToCloudPreview, Result
    AppViewModel (screen state), MainActivity, HisaabCheckApp (Firebase + App Check setup)
```

Versions (from official pages on 2026-11-26): Android Gradle Plugin 9.5.1, Gradle 9.6.0 wrapper, Kotlin 2.4.21, Compose BOM 2026.11.01, compileSdk and targetSdk 37, **minSdk 29** (Android 10), Java 17 bytecode, built with JDK 21. Firebase BoM 35.2.0 (`firebase-ai`, `firebase-auth`, `firebase-firestore`, `firebase-storage`, `firebase-config`, `firebase-appcheck-playintegrity`, `firebase-appcheck-debug`), plus `firebase-ai-ondevice` 16.0.0-beta08 (not in the BoM). ML Kit text recognition 16.0.1, bundled model (works offline; about 4 MB per CPU type). Exact versions are pinned in the version catalogue.

`applicationId` is `com.hisaabcheck.app`. It must match the Android app registered in the Firebase project; it can be changed in one place before that registration.

`google-services.json` is not committed. The Google services Gradle plugin is applied only when `android/app/google-services.json` exists, so the project compiles without it; an app built without it shows a "Firebase is not set up" screen instead of crashing. `google-services.json.example` documents the shape.

## 5. Kotlin core

The port follows the TypeScript source as the specification. Behaviour must be identical; where the two languages differ, the Kotlin side adapts:

- Regular expressions: the JavaScript `\s` also matches non-breaking and other Unicode spaces, Java's does not. Patterns that use `\s` are written with an explicit space class so both sides match the same text. `\d` and `\b` stay ASCII on both sides. Upper-casing uses the root locale.
- Numbers are `Double`, as in JavaScript. The parser keeps the web rules (missing or unreadable amounts become 0, comma and "/-" handling, unreadable answer gives null).
- Dates use `java.time` with the same IST calendar-date rule.
- The cascade is a `suspend fun processBill(image, deps, hooks)` with the same steps, reasons and fail-closed rules as the web: the cloud model never receives the original image bytes; an unusable cloud answer is a cloud failure; OCR failure blocks the cloud path; `device_only` and `cloud_only` behave as on the web; device timeout is 8 000 ms.
- An image in the core is JPEG bytes with a width and height. Adapters turn bytes into bitmaps.

Adapter interfaces in the core match the web ones: `DeviceModel` (availability, download with progress, extract), `CloudModel`, `Ocr`, `Painter`, `Clock`, and a `Config` value.

`PREFER_ON_DEVICE` and `PREFER_IN_CLOUD` are never used. A core test scans every Kotlin source file under `android/` and fails if the text `PREFER_` appears.

## 6. Android adapters

| Adapter | Uses | Notes |
| --- | --- | --- |
| `FirebaseAiDevice` | `FirebaseAIOnDevice.checkStatus()` and `download()`; a model created with `OnDeviceConfig(mode = InferenceMode.ONLY_ON_DEVICE)` | Maps the four statuses to the core's availability. Sends the prompt and one bitmap. Rejects any answer whose `inferenceSource` is not on-device (fail closed). |
| `FirebaseAiCloud` | a model created with `OnDeviceConfig(mode = InferenceMode.ONLY_IN_CLOUD)` and the model name from config | Receives only the bytes the cascade hands it (the redacted image). |
| `MlKitOcr` | ML Kit text recognition, Latin, bundled | One core word per ML Kit element: text, box, confidence scaled from 0–1 to 0–100, line number counted across blocks. An element without a box fails the whole read, so the cloud path is blocked (a word that cannot be located cannot be hidden). |
| `BitmapPainter` | `Canvas` | Draws solid black rectangles and returns new JPEG bytes. |
| `ImageLoader` | `ImageDecoder` | Decodes a content URI to an upright software bitmap with a longest side of at most 1600 px, then JPEG bytes. |
| `RemoteConfigSource` | Remote Config | Same keys and bundled defaults as the web; 30 s minimum fetch interval; `mask_pii` is forced on in release builds. |
| `Store` | Firestore, Storage | Section 7. |

App Check: the debug provider in debug builds, Play Integrity in release builds. App Check is enforced for Firebase AI Logic, so a debug build needs its debug token registered in the console before even the cloud path works.

## 7. Data model and rules

Additions (existing documents stay valid):

- `users/{uid}`: `role` may be `owner`; phone number as given by Firebase Auth.
- `shops/{shopId}`: `inviteCode` (string), `ownerUid` (uid, set when the owner links).
- `invites/{code}`: `{ shopId, caUid, createdAt }`. The code is 8 characters from an alphabet without look-alikes (no 0, O, 1, I, L), generated in the browser with the crypto random source.
- `routeLogs`: `platform` is `web` or `android`. A log written from Android carries the shop's `caUid`, so it appears on that CA's routing dashboard.
- Bills written from Android have exactly the web shape (fields, `checks`, `status`, `route`, `createdAt`), so the web inbox, review and export work on them unchanged.

Linking, with no server of our own:

1. On the web, the CA presses "Invite owner" on a shop. The browser writes `invites/{code}` and sets `inviteCode` on the shop.
2. On the phone, the owner types the code. The app reads `invites/{code}` by its id (a single-document read; listing is denied), then updates the shop with `ownerUid` = their uid and `claimedWith` = the code.
3. Rules allow that update only if the shop has no owner yet, only those two fields change, `ownerUid` is the caller, and `claimedWith` equals the shop's stored `inviteCode`.

Rules summary:

| Path | CA of the shop | Owner of the shop | Anyone else signed in |
| --- | --- | --- | --- |
| `users/{uid}` (own) | create as `ca`, update without changing role | create as `owner`, same | — |
| `shops/{id}` | as today | read; the one-time link update | the one-time link update, if they know the code |
| `shops/{id}/bills/{id}` | as today (review lock from B stays) | read; create and update with status `draft` or `manual_entry` only; cannot touch a reviewed bill except the photo path | — |
| `invites/{code}` | create for own shop; read; delete | read by id | read by id |
| `routeLogs` | as today | create for own shop with `platform: android` and the shop's `caUid` | — |
| Storage `shops/{id}/bills/*` | as today | read; upload if the shop stores photos | — |

Only the CA can set `approved` or `rejected`. An owner can never read another shop.

## 8. Screens (Journey 1)

1. **Sign in.** Phone number with +91 prefilled, then the 6-digit code. Uses Firebase phone sign-in; on an APK installed by hand this goes through Firebase's reCAPTCHA page. For the demo, Firebase test phone numbers work without SMS.
2. **Consent.** The same specific, separate statement as the web, with the version and time saved.
3. **Link shop.** One field for the invite code. Errors: unknown code, shop already linked, no connection.
4. **Home.** Shop name; two large buttons, "Snap bill" and "Pick from gallery"; a chip showing on-device AI status with a "Download on-device AI" button when it can be downloaded; the last 20 bills of the shop with status.
5. **Processing.** The same live steps as the web: Checking device AI, Reading on device, Checking maths, Hiding private numbers, Reading in cloud, Saved.
6. **Send to cloud?** Shown only when the shield is unsure or OCR read too little. The redacted image; the owner can drag to black out more; "Send to cloud" or "Keep on device" (saved as manual entry).
7. **Result.** Badge ("Read on device", "Checked in cloud: reason" or "Manual entry: reason"), count and types of hidden numbers, failed checks in red, the ten fields editable, "Save changes". The bill is saved to Firestore as soon as processing ends, before this screen, so a captured bill is never lost; "Save changes" updates it and re-runs the checks.

Navigation is a single activity with one view model holding the current screen; no navigation library. Large tap targets, text contrast AA, content descriptions on icon buttons (NFR-10).

## 9. Error handling

| Failure | Behaviour |
| --- | --- |
| No on-device model, or it is downloading | cloud path with reason `no_device_model`; the Home chip offers the download |
| Device read throws or takes over 8 s | `device_error` / `device_timeout`, then the cloud path |
| OCR fails or a word has no box | `ocr_error`, saved as manual entry; the cloud is not called |
| Cloud call fails (network, App Check, quota) | `cloud_error`, saved as manual entry with any device fields; a Retry button while the photo is in memory |
| Painting fails, or the painter returns the original bytes | `redact_error`, saved as manual entry |
| Firestore write while offline | queued by Firestore's local cache (on by default on Android); the result screen says "Will sync when online" |
| Sign-in fails | message under the field; the number and code stay typed |
| `google-services.json` missing at build time | the app shows "Firebase is not set up" and nothing else |

## 10. Testing

- **Core (JUnit on the JVM), test-first:** every case in `shared/test-vectors/pii.json` and `bills.json`; ports of the web tests for checksums, parser, config, redaction plan, OCR adequacy, route log and the full table of cascade paths with fake adapters, including the assertion that the cloud adapter never receives the original bytes; the `PREFER_` scan.
- **Rules (emulator):** owner link succeeds once and only with the right code; a second link fails; an owner reads and writes only their shop's bills, cannot approve or reject, cannot edit a reviewed bill; invite read by id passes and listing fails; Android route log passes only with the shop's `caUid`; everything from A and B still passes.
- **Web (Vitest):** invite-code generation and the store call; route-log type change.
- **App:** `./gradlew :app:assembleDebug` succeeds with and without `google-services.json`. No instrumented tests.
- **Runtime check list for the owner** (cannot be done here): install the APK, register the App Check debug token, sign in with a test number, link with an invite code, read one clean and one blurry bill, check the redacted image, find the bill in the web inbox, and, on a supported phone, the on-device path.

## 11. Setup the owner must do

Create the Firebase project and enable phone sign-in (Blaze plan for real SMS; test numbers need no SMS); register the Android app `com.hisaabcheck.app` with the debug keystore's SHA-1 and SHA-256; download `google-services.json` into `android/app/`; register the App Check debug token printed in Logcat; deploy the updated rules.

## 12. Build order and parallel work

1. **Foundation (one agent):** Gradle project, both modules, core types and interfaces, a placeholder app that assembles. Everything after this compiles against these interfaces.
2. **Three agents in parallel:** (a) core shield, checks, config, parser, redaction with the shared vectors; (b) rules, rules tests and the web invite changes; (c) Android adapters.
3. **Three agents in parallel:** (a) core cascade and route log; (b) sign-in, consent and link screens; (c) home, processing, preview and result screens.
4. **Wiring, README, runtime check list, whole-branch review.**
