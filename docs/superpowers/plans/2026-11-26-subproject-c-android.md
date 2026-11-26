# Sub-project C (Android App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shop owner signs in on Android with a phone number, links to their CA's shop with an invite code, snaps or picks a GST bill, and the same hybrid cascade as the web (on-device read first; cloud only after private numbers are blacked out) reads, checks and saves it where the CA's web inbox sees it.

**Architecture:** `android/core` is a pure Kotlin JVM library that mirrors `web/src/core` file for file and is tested on the JVM against `shared/test-vectors`. `android/app` is a thin Compose application: adapters wrap Firebase AI Logic, ML Kit OCR, Canvas, Remote Config, Firestore and Storage behind the core's interfaces; two view models (session, bill flow) drive seven screens. Firestore rules gain a shop-owner role and a one-time invite-code link.

**Tech Stack:** Kotlin 2.4.21, Android Gradle Plugin 9.5.1 (built-in Kotlin), Gradle wrapper 9.6.0, JDK 21 to run, Java 17 bytecode, Compose BOM 2026.11.01, compileSdk/targetSdk 37, minSdk 29, Firebase BoM 35.2.0 + `firebase-ai-ondevice` 16.0.0-beta08, ML Kit text-recognition 16.0.1 (bundled), kotlinx-serialization-json, kotlinx-coroutines, JUnit 5.

Spec: `docs/superpowers/specs/2026-11-26-subproject-c-android-design.md`.

## Global Constraints

- The TypeScript core in `web/src/core` is the specification for the Kotlin core. Behaviour must be identical. Do not change the TypeScript core's behaviour to make a port easier.
- `android/core` must not import `android.*`, `androidx.*` or `com.google.*`.
- Never use `PREFER_ON_DEVICE` or `PREFER_IN_CLOUD`. The text `PREFER_` must not appear in any Kotlin source under `android/` (a test enforces it; write the words differently in comments).
- The cloud adapter must never receive the original image bytes. Fail closed everywhere the web core does.
- No PII values in Firestore, logs or Logcat. Route logs carry counts and types only. Do not log OCR text.
- Wire strings are exactly the web's: statuses `draft | approved | rejected | manual_entry`; paths `device | cloud`; reasons as in `web/src/core/types.ts`; route-log keys as in `web/src/core/router/routeLog.ts`.
- `applicationId` and namespace of the app: `com.hisaabcheck.app`. Core package: `com.hisaabcheck.core`.
- Default cloud model on both platforms: `gemini-3.5-flash-lite`.
- Device read timeout 8000 ms. Image longest side at most 1600 px, JPEG.
- `google-services.json` is never committed. The project must build with and without it.
- In every source file, write non-printing or special characters as escape sequences, never literally (an earlier task in this project broke lint by writing a literal byte-order mark).
- Environment for every Gradle command:
  `export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"; export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"`
- This Mac has 8 GB of RAM and several agents work at once. Run Gradle ONLY through `android/gw` (created in Task 1), which lets one build run at a time; never call `./gradlew` or `gradle` directly after Task 1. Use `--console=plain`. Run the narrowest task that proves your change (`:core:test --tests '...'`, `:app:compileDebugKotlin`).
- Nothing can be run on a phone here (no device, no emulator, no Firebase project). App tasks are verified by compiling and assembling; say plainly in every report that nothing ran on a device.
- Web commands run from `web/`: `npx vitest run`; rules tests `PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:rules`; `npm run build`; `npm run lint`.
- Several agents share this checkout. Touch only the files your task names. Commit only your own paths: `git add <paths>` then `git commit <paths> -F -` with a heredoc message ending with your session's standard Co-Authored-By line. Never amend, rebase, reset, stash or push.

## File structure

```
android/gw                                   one-build-at-a-time Gradle wrapper script          (Task 1)
android/settings.gradle.kts, build.gradle.kts, gradle.properties, gradle/libs.versions.toml,
android/gradlew, gradle/wrapper/*                                                               (Task 1)
android/core/build.gradle.kts                                                                   (Task 1)
android/core/src/main/kotlin/com/hisaabcheck/core/
  Types.kt                                   every type and adapter interface                   (Task 1)
  config/Defaults.kt, config/ParseConfig.kt                                                     (stub 1, real 2)
  shield/Gstin.kt, Verhoeff.kt, Shield.kt, Adequacy.kt, PiiLabels.kt                            (Task 2)
  redact/PlanRedaction.kt                                                                       (Task 2)
  extract/Prompts.kt, extract/Parse.kt                                                          (Task 2)
  checks/Checks.kt                                                                              (stub 1, real 2)
  router/ProcessBill.kt, Timeout.kt, RouteLog.kt                                                (stub 1, real 5)
android/core/src/test/kotlin/com/hisaabcheck/core/...                                           (Tasks 1, 2, 5)
android/app/build.gradle.kts, src/main/AndroidManifest.xml, res/...                             (Task 1)
android/app/src/main/java/com/hisaabcheck/app/
  HisaabCheckApp.kt, MainActivity.kt, AppRoot.kt, Model.kt                                      (Task 1, wired in 8)
  adapters/ImageLoader.kt, BitmapPainter.kt, MlKitOcr.kt, FirebaseAiDevice.kt,
           FirebaseAiCloud.kt, RemoteConfigSource.kt, BillStore.kt                              (Task 4)
  adapters/SessionStore.kt                                                                      (Task 6)
  session/SessionViewModel.kt, ui/SignInScreen.kt, ConsentScreen.kt, LinkShopScreen.kt          (Task 6)
  bill/BillViewModel.kt, ui/HomeScreen.kt, ProcessingScreen.kt, PreviewScreen.kt, ResultScreen.kt (Task 7)
firebase/firestore.rules, firebase/storage.rules, firebase/remoteconfig.template.json           (Task 3)
web/src/core/invite/code.ts, web/src/adapters/store.ts, web/src/features/shops/ShopsPage.tsx,
web/src/core/router/routeLog.ts, web/src/core/config/defaults.ts, tests                         (Task 3)
README.md, docs/superpowers/2026-11-26-subproject-c-followups.md                                (Task 8)
```

Parallel groups: Task 1 and Task 3 can run together. Then Tasks 2 and 4 together (with 3 if still running). Then Tasks 5, 6 and 7 together. Task 8 last.

---

### Task 1: Gradle project, core types, placeholder app

**Files:** everything marked "(Task 1)" above, plus `.gitignore` additions.

**Interfaces — Produces** (later tasks compile against these exact names):

- [ ] **Step 1: Build scripts.** Create under `android/`:

`gw` (executable; the only way anyone runs Gradle in this repo):

```bash
#!/bin/bash
# Runs ./gradlew with one build at a time across all agents (8 GB machine).
cd "$(dirname "$0")" || exit 1
LOCK="${TMPDIR:-/tmp}/hisaabcheck-gradle.lock"
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  sleep 3; waited=$((waited + 3))
  if [ "$waited" -ge 1200 ]; then echo "gw: gave up waiting for $LOCK after 20 minutes (remove it if no build is running)" >&2; exit 75; fi
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM
./gradlew --console=plain "$@"
```

`gradle/libs.versions.toml` with these versions: agp 9.5.1, kotlin 2.4.21, composeBom 2026.11.01, activityCompose 1.13.0, lifecycle (viewmodel-compose) latest stable resolvable, coroutines (kotlinx-coroutines-core and -android, same version) latest stable resolvable, serialization 1.13.0, junit 5.14.4, mlkitText 16.0.1, exif 1.4.2, firebaseBom 35.2.0, firebaseAiOnDevice 16.0.0-beta08, googleServices 4.6.0. Plugins: `com.android.application`, `org.jetbrains.kotlin.jvm`, `org.jetbrains.kotlin.plugin.compose`, `org.jetbrains.kotlin.plugin.serialization`, `com.google.gms.google-services`. If a listed version does not resolve, pick the nearest that does and record it in your report.

`settings.gradle.kts`: `pluginManagement` and `dependencyResolutionManagement` with `google()`, `mavenCentral()` (and `gradlePluginPortal()` for plugins), `RepositoriesMode.FAIL_ON_PROJECT_REPOS`, `rootProject.name = "HisaabCheck"`, `include(":core", ":app")`.

Root `build.gradle.kts`: the five plugins with `apply false`.

`gradle.properties`: `org.gradle.jvmargs=-Xmx1536m -Dfile.encoding=UTF-8`, `kotlin.daemon.jvmargs=-Xmx1024m`, `org.gradle.parallel=false`, `android.useAndroidX=true`.

Wrapper: run Homebrew's `gradle wrapper --gradle-version 9.6.0` once inside `android/` (with `JAVA_HOME` set as in Global Constraints), commit `gradlew`, `gradlew.bat`, `gradle/wrapper/*`.

`core/build.gradle.kts`: `kotlin("jvm")` + serialization plugin via the catalogue; Java source/target 17 and `jvmTarget = JVM_17`; dependencies `kotlinx-serialization-json`, `kotlinx-coroutines-core`; tests: JUnit 5 (BOM, `junit-jupiter`, platform launcher), `kotlinx-coroutines-test`; `tasks.test { useJUnitPlatform(); systemProperty("repoRoot", rootProject.projectDir.parentFile.absolutePath) }` so tests can find `shared/test-vectors` and scan `android/`.

`app/build.gradle.kts`: `com.android.application` + compose plugin (AGP 9 has built-in Kotlin: do NOT apply `org.jetbrains.kotlin.android`). `namespace` and `applicationId` `com.hisaabcheck.app`, `compileSdk = 37`, `minSdk = 29`, `targetSdk = 37`, versionCode 1, versionName "0.1", `buildFeatures { compose = true; buildConfig = true }`, Java 17 compile options. Apply the Google services plugin only when the file exists: `if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")`. Dependencies: `project(":core")`, Compose BOM + ui + material3 + ui-tooling-preview, activity-compose, lifecycle-viewmodel-compose, kotlinx-coroutines-android, exifinterface, ML Kit text-recognition, Firebase BoM platform with `firebase-ai`, `firebase-auth`, `firebase-firestore`, `firebase-storage`, `firebase-config`, `firebase-appcheck-playintegrity`, and `debugImplementation` `firebase-appcheck-debug`, plus `firebase-ai-ondevice` at its explicit version.

`.gitignore` (repo root): add `android/.gradle/`, `android/build/`, `android/*/build/`, `android/local.properties`, `android/app/google-services.json`, `*.apk`, `.kotlin/`.

`android/app/google-services.json.example`: a dummy file with `project_info` (project_number, project_id, storage_bucket), one `client` with `client_info.mobilesdk_app_id`, `android_client_info.package_name` = `com.hisaabcheck.app`, one `api_key.current_key`, and `configuration_version` "1", all obviously fake values.

- [ ] **Step 2: Core types.** Create `android/core/src/main/kotlin/com/hisaabcheck/core/Types.kt` exactly:

```kotlin
package com.hisaabcheck.core

import java.time.Instant

enum class PathTaken(val wire: String) { DEVICE("device"), CLOUD("cloud") }
enum class Reason(val wire: String) {
    PASSED("passed"), TOTAL_MISMATCH("total_mismatch"), INVALID_GSTIN("invalid_gstin"), LOW_CONFIDENCE("low_confidence"),
    DEVICE_TIMEOUT("device_timeout"), DEVICE_ERROR("device_error"), INVALID_JSON("invalid_json"),
    NO_DEVICE_MODEL("no_device_model"), CLOUD_ONLY_MODE("cloud_only_mode"), CLOUD_ERROR("cloud_error"),
    OCR_ERROR("ocr_error"), USER_KEPT_LOCAL("user_kept_local"), REDACT_ERROR("redact_error")
}
enum class BillStatus(val wire: String) { DRAFT("draft"), APPROVED("approved"), REJECTED("rejected"), MANUAL_ENTRY("manual_entry") }
enum class RoutingMode(val wire: String) { SMART("smart"), DEVICE_ONLY("device_only"), CLOUD_ONLY("cloud_only") }
enum class Availability { AVAILABLE, DOWNLOADABLE, DOWNLOADING, UNAVAILABLE }
/** POSSIBLE_ID: a near-miss of PAN, Aadhaar or mobile; hidden as a precaution. The enum names are the wire strings. */
enum class PiiType { PAN, AADHAAR, PHONE, BANK_ACCOUNT, IFSC, POSSIBLE_ID }

data class LineItem(val description: String, val hsn: String, val qty: Double, val rate: Double, val amount: Double)
data class Extraction(
    val supplierName: String, val supplierGstin: String, val invoiceNo: String, val invoiceDate: String, val placeOfSupply: String,
    val items: List<LineItem>? = null, val itemCount: Double? = null,
    val taxableValue: Double, val cgst: Double, val sgst: Double, val igst: Double, val total: Double, val confidence: Double,
)
data class Checks(val total: Boolean, val gstin: Boolean, val taxSplit: Boolean, val date: Boolean, val required: Boolean)
data class CheckResult(val checks: Checks, val score: Double, val hardFail: Reason?, val escalate: Boolean)

data class Config(
    val routingMode: RoutingMode, val confidenceThreshold: Double, val consentOcrThreshold: Double,
    val totalToleranceInr: Double, val maxDeviceLineItems: Int, val cloudModel: String,
    val extractionPromptVersion: String, val maskPii: Boolean,
)

data class Box(val x0: Double, val y0: Double, val x1: Double, val y1: Double)
/** confidence is on the 0–100 scale the web OCR uses. */
data class OcrWord(val text: String, val bbox: Box, val confidence: Double, val line: Int)
data class PiiMatch(val type: PiiType, val wordIndexes: List<Int>)
data class ShieldResult(val gstinWordIndexes: List<Int>, val matches: List<PiiMatch>, val uncertain: Boolean, val uncertainReasons: List<String>)
data class RedactionPlan(val boxes: List<Box>, val piiTypes: List<PiiType>, val piiMasked: Int)

/** A bill photo as JPEG bytes. Identity (===) of [bytes] is how the cascade proves the original was never sent. */
class ImageInput(val bytes: ByteArray, val width: Int, val height: Int)

interface DeviceModel {
    suspend fun availability(): Availability
    suspend fun download(onProgress: (Double) -> Unit)
    suspend fun extract(image: ImageInput, prompt: String): String
}
interface CloudModel { suspend fun extract(redacted: ImageInput, prompt: String, model: String): String }
interface Ocr { suspend fun recognize(image: ImageInput): List<OcrWord> }
interface Painter { suspend fun paint(image: ImageInput, boxes: List<Box>): ByteArray }
fun interface Clock { fun now(): Instant }

data class RouteInfo(val path: PathTaken, val reason: Reason, val confidence: Double, val promptVersion: String, val modelName: String)
class ProcessedBill(
    val status: BillStatus, val extraction: Extraction?, val checks: Checks?, val route: RouteInfo,
    val piiTypes: List<PiiType>, val piiMasked: Int, val latencyMs: Long, val estCostUsd: Double, val redactedImage: ByteArray?,
)
enum class Step { AVAILABILITY, DEVICE_READ, CHECKING, REDACTING, AWAITING_CONSENT, CLOUD_READ, DONE }
sealed interface ConsentResult {
    class Send(val image: ByteArray) : ConsentResult
    data object Keep : ConsentResult
}
```

- [ ] **Step 3: Core stubs** (signatures the app compiles against; bodies are replaced by Tasks 2 and 5). Each body is `TODO("Task N")` except the constants:

```kotlin
// config/Defaults.kt
package com.hisaabcheck.core.config
val DEFAULT_REMOTE_VALUES: Map<String, String> = mapOf(
    "routing_mode" to "smart", "confidence_threshold" to "0.8", "consent_ocr_threshold" to "0.6",
    "total_tolerance_inr" to "1", "max_device_line_items" to "10", "cloud_model" to "gemini-3.5-flash-lite",
    "extraction_prompt_version" to "v1", "mask_pii" to "true",
)
const val CLOUD_COST_PER_CALL_USD = 0.0003
const val DEVICE_TIMEOUT_MS = 8000L
const val MIN_OCR_WORDS = 15
const val MIN_OCR_MEDIAN_CONFIDENCE = 50.0

// config/ParseConfig.kt
fun parseConfig(values: Map<String, String>, isProd: Boolean): Config

// checks/Checks.kt
fun runChecks(e: Extraction, cfg: Config, today: Instant): CheckResult

// shield/PiiLabels.kt
fun piiLabel(type: String): String

// shield/Gstin.kt
fun isValidGstin(g: String): Boolean

// router/ProcessBill.kt
class RouterDeps(
    val device: DeviceModel, val cloud: CloudModel, val ocr: Ocr, val painter: Painter,
    val config: Config, val clock: Clock, val deviceTimeoutMs: Long = DEVICE_TIMEOUT_MS,
)
interface RouterHooks {
    fun onStep(step: Step)
    suspend fun askConsent(redacted: ByteArray, plan: RedactionPlan): ConsentResult
}
suspend fun processBill(img: ImageInput, deps: RouterDeps, hooks: RouterHooks): ProcessedBill

// router/RouteLog.kt
val ROUTE_LOG_KEYS: List<String>   // same 13 names and order as web/src/core/router/routeLog.ts
/** Field map for a routeLogs document, without createdAt (the store adds the server timestamp). platform is "android". */
fun toRouteLogFields(p: ProcessedBill, billId: String, shopId: String, caUid: String): Map<String, Any>
```

- [ ] **Step 4: The scan test.** `android/core/src/test/kotlin/com/hisaabcheck/core/NoPreferModesTest.kt`: walks every `.kt` file under `<repoRoot>/android` (skipping `build` and `.gradle` directories), asserts at least 5 files were scanned, and asserts none contains the text formed by `"PREFER" + "_"` (build the needle by concatenation so this file does not contain it). Also a second test in the same file: no file under `android/core/src/main` contains `import android`, `import androidx` or `import com.google`.

- [ ] **Step 5: Placeholder app.** `AndroidManifest.xml` (INTERNET permission; application class `.HisaabCheckApp`; one exported launcher activity `.MainActivity`; a `FileProvider` with authority `${applicationId}.fileprovider` and `res/xml/file_paths.xml` exposing `cache-path` — no CAMERA permission), a Material 3 theme, `strings.xml` with the app name "HisaabCheck".

```kotlin
// Model.kt
package com.hisaabcheck.app
data class Shop(val id: String, val caUid: String, val shopName: String, val storeImages: Boolean)

// HisaabCheckApp.kt — Application subclass
// val firebaseReady: Boolean = FirebaseApp.getApps(this).isNotEmpty() (false when the app was built without google-services.json)
// When ready: install App Check — the debug provider when BuildConfig.DEBUG, Play Integrity otherwise.
// The debug provider class exists only in debug builds: put the two factory choices in
// src/debug/java/.../AppCheckInstaller.kt and src/release/java/.../AppCheckInstaller.kt (same function name).

// AppRoot.kt
@Composable fun AppRoot(firebaseReady: Boolean)   // shows "Firebase is not set up. Add google-services.json and rebuild." when false, else a placeholder text

// MainActivity.kt — ComponentActivity; setContent { theme { AppRoot((application as HisaabCheckApp).firebaseReady) } }
```

- [ ] **Step 6: Verify.** `./gw :core:test` passes (the scan tests; stubs are not called). `./gw :app:assembleDebug` succeeds without `google-services.json`. Then copy the example to `android/app/google-services.json`, run `./gw :app:assembleDebug` again to prove the plugin path works, and delete the copy. Report APK path and size, the resolved versions, and how long a clean build took.

- [ ] **Step 7: Commit** `feat(android): Gradle project, core types and placeholder app`.

---

### Task 2: Kotlin core — shield, checks, config, parser, redaction

**Files:** create/replace under `android/core/src/main/kotlin/com/hisaabcheck/core/`: `config/ParseConfig.kt`, `shield/Gstin.kt`, `shield/Verhoeff.kt`, `shield/Shield.kt`, `shield/Adequacy.kt`, `shield/PiiLabels.kt`, `redact/PlanRedaction.kt`, `extract/Prompts.kt`, `extract/Parse.kt`, `checks/Checks.kt`; tests under `android/core/src/test/kotlin/com/hisaabcheck/core/`. Do not touch `Types.kt`, `config/Defaults.kt` or `router/*`.

**Interfaces:**
- Consumes: `Types.kt` and `config/Defaults.kt` from Task 1.
- Produces (packages `com.hisaabcheck.core.<dir>`): `parseConfig(values, isProd)`, `gstinCheckChar(first14)`, `gstinStateCode(g)`, `isValidGstin(g)`, `placeOfSupplyCode(pos): Int?`, `isValidVerhoeff(digits)`, `runShield(words: List<OcrWord>, consentOcrThreshold: Double): ShieldResult`, `ocrAdequate(words)`, `PII_LABEL`, `piiLabel(type)`, `planRedaction(words, shield, width: Int, height: Int, pad: Double = 4.0): RedactionPlan`, `devicePrompt(cfg)`, `cloudPrompt(cfg)`, `parseExtraction(raw: String): Extraction?`, `WEIGHTS`, `runChecks(e, cfg, today: Instant): CheckResult`.

Each Kotlin file is a faithful port of the TypeScript file of the same name in `web/src/core/` (`shield/shield.ts` → `shield/Shield.kt`, and so on). Read the TypeScript file and its test in `web/tests/core/` before porting.

- [ ] **Step 1: Write the tests first.**
  - `ShieldVectorsTest`: load `<repoRoot>/shared/test-vectors/pii.json` with kotlinx-serialization (`Json.parseToJsonElement`). For every case build words the way `web/tests/helpers.ts` `wordsFromLines` does (split each line on spaces; boxes 10 px per character; `confidence` from the case or 95), run `runShield(words, 0.6)` and assert exactly what `web/tests/core/shield.test.ts` asserts for a vector (types found, number of GSTIN words, `uncertain`). Use a JUnit dynamic test per vector named after the case, and assert the file holds at least 55 cases.
  - `ChecksVectorsTest`: the same for `bills.json`, asserting what `web/tests/core/checks.test.ts` asserts (checks, score, hardFail, escalate, patches applied the way that test applies them, the same fixed "today").
  - Ports, test by test with the same names and values, of `checksums.test.ts`, `parse.test.ts`, `parseConfig.test.ts` (expect cloud model `gemini-3.5-flash-lite` as the default), `planRedaction.test.ts`, `adequacy.test.ts`, `piiLabels.test.ts`, and every non-vector test in `shield.test.ts` and `checks.test.ts`.
- [ ] **Step 2: Run** `./gw :core:test` and see the new tests fail (stubs throw or files are missing).
- [ ] **Step 3: Port the code.** Rules that keep the two languages in step:
  - JavaScript `\s` also matches non-breaking space and other Unicode spaces; Java's does not. Wherever a TypeScript pattern uses `\s`, write an explicit character class in Kotlin that covers the same characters (space, tab, line breaks, vertical tab, form feed, no-break space, Ogham space mark, en quad through hair space, line and paragraph separators, narrow no-break space, medium mathematical space, ideographic space, byte-order mark), using escape sequences. Add one test proving a mobile number split by a no-break space is still found.
  - Do not enable Unicode character classes: `\d`, `\w` and `\b` must stay ASCII-based as in JavaScript.
  - Upper-case with the root locale. String indexes are UTF-16 units in both languages.
  - `Number(...)`, `parseFloat`, `Number.isFinite`, truthiness and `??` have exact meanings in the TypeScript; reproduce them case by case (the parser tests pin them: missing amounts become 0, `"1,234.50"`, `"118/-"`, non-object items, null `itemCount`). Do not accept inputs the TypeScript rejects.
  - JavaScript `Math.round` rounds a tie toward positive infinity (2.5 → 3, -2.5 → -2). Use a Kotlin call with the same rule for the one use (`maxDeviceLineItems`) and pin it with a test for 2.5.
  - JSON: use `Json { isLenient = false }` and `JsonElement` navigation; a JSON number that is not finite, or a field of the wrong type, is handled as the TypeScript handles it.
  - Dates: `java.time`; "today" is the IST calendar date of the given `Instant`, as in `checks.ts`.
  - Sparse line arrays in `shield.ts` `buildLines`: a line index with no words is an empty line; negative indexes do not occur.
- [ ] **Step 4: Run** `./gw :core:test` until everything passes. If a shared vector passes on the web and fails in Kotlin, the Kotlin port is wrong — never edit a vector or weaken an assertion; if you believe the TypeScript itself is wrong, stop and report it.
- [ ] **Step 5: Commit** `feat(android-core): shield, checks, config, parser and redaction ported with shared vectors`.

---

### Task 3: Rules for shop owners, invite codes on the web, cloud model default

**Files:** `firebase/firestore.rules`, `firebase/storage.rules`, `firebase/remoteconfig.template.json`, `web/tests/rules/firestore.rules.test.ts`, `web/src/core/invite/code.ts` (new), `web/tests/core/inviteCode.test.ts` (new), `web/src/adapters/store.ts`, `web/tests/adapters/storeReview.test.ts` or a new `storeInvite.test.ts`, `web/src/features/shops/ShopsPage.tsx`, `web/src/core/router/routeLog.ts`, `web/src/core/config/defaults.ts`, `web/tests/core/parseConfig.test.ts`, `README.md` (the one `cloud_model` table row only). Nothing under `android/`.

**Interfaces — Produces:** the rules the Android `SessionStore` and `BillStore` (Tasks 4 and 6) rely on; `inviteCode(bytes: Uint8Array): string | null`; `createInvite(shop: Shop, caUid: string): Promise<string>`; `Shop` gains optional `inviteCode?: string` and `ownerUid?: string`; `RouteLogDoc.platform: 'web' | 'android'`.

- [ ] **Step 1: Rules tests first** (add a `describe('shop owners and invites')` block; seed a shop `s1` of CA `alice` with `inviteCode: 'ABCD2345'` and no owner, `invites/ABCD2345` `{ shopId: 's1', caUid: 'alice' }`, and a shop `linked` of `alice` with `ownerUid: 'ravi'` and a draft and an approved bill). Assert:
  - a user creates themselves with role `owner`; still cannot create or become `admin`;
  - `ravi2` reads `invites/ABCD2345` by id; listing `invites` fails; an invite cannot be updated; only its CA deletes it;
  - the CA creates an invite for their own shop with `createdAt` server time and a valid code id; fails for another CA's shop, a wrong `caUid`, extra keys, or an id that is not 8 characters of the allowed alphabet;
  - link: `ravi2` updates `s1` with `{ ownerUid: 'ravi2', claimedWith: 'ABCD2345' }` — passes; with a wrong code — fails; setting someone else as owner — fails; changing any other field in the same write — fails; a second link by anyone on an already linked shop — fails; a shop with no `inviteCode` cannot be linked;
  - owner `ravi` reads shop `linked` and its bills; another signed-in user cannot; an owner cannot read a shop they do not own, and cannot delete a bill or the shop;
  - owner creates a bill with status `draft` and with `manual_entry`; cannot create one as `approved` or `rejected`; updates their draft; cannot set it to `approved`/`rejected`; cannot change the approved bill in any way; cannot reopen it;
  - the CA's existing abilities on `linked` are unchanged (approve, reject, reopen, lock);
  - route log from `ravi` with `platform: 'android'`, `shopId: 'linked'`, `caUid: 'alice'` — passes; with `caUid: 'ravi'` or for shop `s1` — fails; `platform: 'web'` from the owner — fails; the CA's web log still passes; an owner cannot read route logs.
- [ ] **Step 2: Run the rules tests** and see the new ones fail.
- [ ] **Step 3: Rules.** In `firestore.rules`:
  - helpers `shopData(shopId)` (the shop's `.data`), `isOwnerOf(shopId)` = signed in and `shopData(shopId).get('ownerUid', null) == uid()`; keep `ownsShop` (the CA).
  - `users`: create allows role `ca` or `owner`.
  - `shops`: read if `caUid == uid()` or `resource.data.get('ownerUid', null) == uid()`; delete and create unchanged; update = the existing CA rule OR the link rule: signed in, `resource.data.get('ownerUid', null) == null`, `resource.data.get('inviteCode', null) is string`, `request.resource.data.ownerUid == uid()`, `request.resource.data.claimedWith == resource.data.inviteCode`, and `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['ownerUid', 'claimedWith'])`.
  - `bills`: read if CA or owner; delete CA only; create = CA rule OR (`isOwnerOf` and `validBill` and new status in `['draft','manual_entry']`); update = CA rule OR (`isOwnerOf` and `validBill` and stored status (default `draft`) in `['draft','manual_entry']` and new status in `['draft','manual_entry']`).
  - `invites/{code}`: `get` if signed in; `list` never; create if signed in, `code.matches('^[A-HJKMNP-Z2-9]{8}$')`, keys exactly `shopId`, `caUid`, `createdAt`, `caUid == uid()`, `createdAt == request.time`, `ownsShop(shopId)`; delete if `resource.data.caUid == uid()`; update never.
  - `routeLogs`: in `validRouteLog` replace the three conditions `d.caUid == uid()`, `d.platform == 'web'` and `ownsShop(d.shopId)` with: (`d.platform == 'web'` and `d.caUid == uid()` and `ownsShop(d.shopId)`) OR (`d.platform == 'android'` and `isOwnerOf(d.shopId)` and `d.caUid == shopData(d.shopId).caUid`). Everything else in the function stays.
  In `storage.rules`: read, and create/update under the existing size, type and `storeImages` conditions, are allowed for the CA or the shop's `ownerUid`; delete stays CA only.
- [ ] **Step 4: Rules tests pass** — all old ones and all new ones. Report real counts.
- [ ] **Step 5: Web, test-first.**
  - `core/invite/code.ts`: `export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'` (31 characters: no I, L, O, 0, 1) and `inviteCode(bytes: Uint8Array): string | null` — walks the bytes, skips any byte of 248 or more (so every character is equally likely), maps `byte % 31` to the alphabet, returns the first 8 characters or `null` if fewer than 8 usable bytes were given. Tests: deterministic outputs for fixed bytes, skipping of high bytes, `null` on too few, result matches `^[A-HJKMNP-Z2-9]{8}$`.
  - `store.ts`: `createInvite(shop, caUid)`: draws 16 random bytes with `crypto.getRandomValues` until `inviteCode` returns a code, then one batched write: `invites/{code}` `{ shopId, caUid, createdAt: serverTimestamp() }` and `shops/{id}` update `{ inviteCode: code }`; returns the code. Extend `Shop` with the two optional fields. Mocked-Firestore test for the batch contents.
  - `ShopsPage.tsx`: on each shop card, when `ownerUid` is set show "Owner linked"; else when `inviteCode` is set show the code in a monospace box labelled "Invite code for the owner's phone"; else a button "Invite owner" that calls `createInvite` and shows an error with `role="alert"` on failure. Keep the existing links.
  - `routeLog.ts`: `platform: 'web' | 'android'` in the type; the web still writes `'web'`.
  - Cloud model default → `gemini-3.5-flash-lite` in `defaults.ts`, `remoteconfig.template.json`, the README table row and the tests that pin the default.
- [ ] **Step 6: Verify** `npx vitest run`, rules tests, `npm run build`, `npm run lint` (0 errors).
- [ ] **Step 7: Commit** in two commits: `feat(rules): shop owners, invite codes and Android route logs`; `feat(web): invite code for the owner, Android platform in route logs, current cloud model default`.

---

### Task 4: Android adapters

**Files:** create under `android/app/src/main/java/com/hisaabcheck/app/adapters/`: `ImageLoader.kt`, `BitmapPainter.kt`, `MlKitOcr.kt`, `FirebaseAiDevice.kt`, `FirebaseAiCloud.kt`, `RemoteConfigSource.kt`, `BillStore.kt`. Nothing else.

**Interfaces:**
- Consumes: core `Types.kt` interfaces; stubs `parseConfig`, `DEFAULT_REMOTE_VALUES`, `toRouteLogFields`; `Shop` from `Model.kt`.
- Produces:
  - `object ImageLoader { suspend fun load(context: Context, uri: Uri, maxSide: Int = 1600): ImageInput }` — upright software bitmap, longest side at most `maxSide`, JPEG quality 90; throws on failure.
  - `class BitmapPainter : Painter`
  - `class MlKitOcr : Ocr`
  - `class FirebaseAiDevice : DeviceModel`
  - `class FirebaseAiCloud : CloudModel`
  - `class RemoteConfigSource(isProd: Boolean) { suspend fun load(): Config }`
  - `class BillStore { fun save(shop: Shop, bill: ProcessedBill, billId: String? = null): SavedBill; suspend fun updateFields(shopId: String, billId: String, e: Extraction, checks: Checks); fun watchRecent(shopId: String, max: Int = 20, onChange: (List<BillSummary>) -> Unit, onError: (Exception) -> Unit): ListenerRegistration }` with `class SavedBill(val billId: String, val synced: Deferred<Boolean>, val photo: Deferred<PhotoResult>)`, `enum class PhotoResult { STORED, SKIPPED, FAILED }`, `data class BillSummary(val id: String, val supplierName: String, val invoiceDate: String, val total: Double, val status: String)`.

Facts gathered from the official docs on 2026-11-26 (treat as leads; the compiler is the judge — if a name does not exist, find the real one by reading the dependency's classes, for example by listing the AAR's `classes.jar` with `javap`, and say what you found):

- On-device status: `FirebaseAIOnDevice.checkStatus()` returns `OnDeviceModelStatus` (`UNAVAILABLE`, `DOWNLOADABLE`, `DOWNLOADING`, `AVAILABLE`). `FirebaseAIOnDevice.download()` returns a Flow of `DownloadStatus` (`DownloadStarted` with `bytesToDownload`, `DownloadInProgress` with `totalBytesDownloaded`, `DownloadCompleted`, `DownloadFailed`). These need `@OptIn(PublicPreviewAPI::class)`.
- Models: `Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(modelName = ..., onDeviceConfig = OnDeviceConfig(mode = InferenceMode.ONLY_ON_DEVICE))`; the cloud one with `InferenceMode.ONLY_IN_CLOUD`. Request: `model.generateContent(content { image(bitmap); text(prompt) })`; answer text in `.text`; `inferenceSource` on the response says `ON_DEVICE` or `IN_CLOUD`.
- ML Kit: `TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)`, `InputImage.fromBitmap(bitmap, 0)`, result `textBlocks` → `lines` → `elements`; an element has `text`, `boundingBox` (nullable `Rect`) and `confidence` (0 to 1).
- Remote Config: `Firebase.remoteConfig`, `setDefaultsAsync(map)`, `fetchAndActivate()`, settings with a minimum fetch interval.
- Firebase KTX artifacts no longer exist; the Kotlin extensions are in the main artifacts.

Behaviour required:

- `FirebaseAiDevice.availability()` maps the four statuses one to one; any exception → `UNAVAILABLE`. `extract` decodes the JPEG bytes to a bitmap, sends prompt + bitmap to the on-device-only model, and throws unless the response's inference source is on-device (fail closed: a missing or cloud source is an error). `download` reports progress as a 0..1 fraction and throws on `DownloadFailed`.
- `FirebaseAiCloud.extract` builds a cloud-only model for the given model name, sends the bytes it was given (decoded to a bitmap) and the prompt, returns the text; throws on an empty answer.
- `MlKitOcr.recognize`: one `OcrWord` per element; `confidence` × 100; `line` counts lines across all blocks from 0; box from `boundingBox`. If any element has a null box, throw (the cascade then blocks the cloud path). Never log the recognised text.
- `BitmapPainter.paint`: decode, copy to a mutable ARGB bitmap, fill every box solid black, encode JPEG quality 90, return new bytes (never the input array).
- `RemoteConfigSource.load()`: fetch-and-activate with a 30 s minimum interval and a 3 s timeout; on any failure use the activated or default values; build the key→string map for the eight keys in `DEFAULT_REMOTE_VALUES` and return `parseConfig(map, isProd)`.
- `BillStore.save`: the same order and shape as the web's `saveProcessedBill` in `web/src/adapters/store.ts` — bill document first at `shops/{shopId}/bills/{billId}` (new auto id, or the given id on a retry) with the extraction fields flattened at top level using the web's field names, `checks` (map of five booleans, or null), `status` (wire string), `route` (map: `path`, `reason` wire strings, `confidence`, `promptVersion`, `modelName`), `createdAt` server timestamp; omit `items`/`itemCount` when null. Then a best-effort route log: `toRouteLogFields(...)` plus `createdAt` server timestamp, in `routeLogs` with an auto id; its failure never affects the bill. Then, only when `shop.storeImages` and `bill.redactedImage != null`, upload those bytes to Storage `shops/{shopId}/bills/{billId}.jpg` as `image/jpeg` and set `imagePath` on the bill; any failure there → `FAILED`. `synced` completes `true` on server acknowledgement and `false` if the server refuses. `updateFields` writes the ten fields, `checks` and `editedAt` server timestamp. `watchRecent` listens to the newest bills by `createdAt`.

- [ ] **Step 1:** Write the seven files.
- [ ] **Step 2:** `./gw :app:compileDebugKotlin` until clean, then `./gw :app:assembleDebug`.
- [ ] **Step 3:** Self-review against "Behaviour required"; list in your report every API name that differed from the leads above and how you confirmed the real one.
- [ ] **Step 4: Commit** `feat(android): adapters for on-device and cloud AI, OCR, painting, config and bill storage`.

---

### Task 5: Kotlin core — cascade and route log

**Files:** replace `android/core/src/main/kotlin/com/hisaabcheck/core/router/ProcessBill.kt` and `RouteLog.kt`, create `router/Timeout.kt`; tests `ProcessBillTest.kt`, `RouteLogTest.kt`. Depends on Task 2 being committed.

**Interfaces:** keep the signatures Task 1 declared (`RouterDeps`, `RouterHooks`, `processBill`, `ROUTE_LOG_KEYS`, `toRouteLogFields`).

- [ ] **Step 1: Port the tests first.** Every test in `web/tests/core/processBill.test.ts` and `web/tests/core/routeLog.test.ts`, with the same names, inputs and expectations, using fake adapters and `kotlinx-coroutines-test` (`runTest`; the device-timeout cases must use virtual time, not real sleeps). Keep the assertions that the cloud fake never receives the original bytes (`!==` identity on the `ByteArray`), in every scenario that reaches the cloud.
- [ ] **Step 2: See them fail** with `./gw :core:test --tests '*ProcessBillTest*' --tests '*RouteLogTest*'`.
- [ ] **Step 3: Port** `web/src/core/router/processBill.ts` line by line into a `suspend fun`. OCR starts at once in an `async` child and its failure is captured as an outcome, exactly as the web captures the promise. The timeout uses `withTimeoutOrNull`/`withTimeout` and maps to `device_timeout`; a `CancellationException` from the caller's scope must still propagate (do not swallow cancellation in the broad catches). The fail-closed check is reference identity on the bytes. `modelName` is the config's cloud model on the cloud path and `gemini-nano` otherwise. `toRouteLogFields` returns the 12 fields other than `createdAt` with wire strings, `piiTypes` as a list of names, `platform` = `android`.
- [ ] **Step 4: All core tests pass** (`./gw :core:test`).
- [ ] **Step 5: Commit** `feat(android-core): cascade and route log ported with the web's router tests`.

---

### Task 6: Session — sign-in, consent, link shop

**Files:** create `android/app/src/main/java/com/hisaabcheck/app/adapters/SessionStore.kt`, `session/SessionViewModel.kt`, `ui/SignInScreen.kt`, `ui/ConsentScreen.kt`, `ui/LinkShopScreen.kt`. Nothing else (wiring into `AppRoot` is Task 8).

**Interfaces — Produces:**

```kotlin
sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState                         // show SignInScreen
    data class NeedsConsent(val uid: String) : SessionState      // show ConsentScreen
    data class NeedsShop(val uid: String) : SessionState         // show LinkShopScreen
    data class Ready(val uid: String, val shop: Shop) : SessionState
}
class SessionViewModel : ViewModel() {
    val state: StateFlow<SessionState>
    fun signOut()
}
@Composable fun SignInScreen(vm: SessionViewModel)
@Composable fun ConsentScreen(vm: SessionViewModel)
@Composable fun LinkShopScreen(vm: SessionViewModel)
```

Behaviour:

- Phone sign-in with Firebase Auth: `PhoneAuthOptions` (number in E.164 with `+91` prefilled and editable, 60 s timeout, the current activity, callbacks), `PhoneAuthProvider.verifyPhoneNumber`; on `onCodeSent` show a 6-digit field; `PhoneAuthProvider.getCredential(verificationId, code)` then `signInWithCredential`; `onVerificationCompleted` signs in directly. Errors show under the field with plain words (wrong number format, wrong code, too many attempts, no connection); what the user typed stays.
- `SessionStore`: `ensureUser(uid, phone)` creates `users/{uid}` `{ role: 'owner', phone, createdAt }` if missing; `recordConsent(uid)` sets `consentVersion` `2026-11-v1` and `consentAt` server time (same version string as the web's `CONSENT_VERSION`); `findShop(uid)` queries `shops` where `ownerUid == uid` (limit 1); `linkShop(uid, code)`: normalise the code (trim, upper-case), reject anything not matching the 8-character alphabet before any network call, read `invites/{code}`, then update `shops/{shopId}` with exactly `{ ownerUid: uid, claimedWith: code }`, then read the shop. Map failures to: unknown code, shop already linked (permission denied on the update), no connection.
- Consent screen: the same statement as the web's consent page (`web/src/features/auth/ConsentPage.tsx` — read it and reuse the wording, adapted from "CA" to "shop owner" only where it names the reader), one "I agree" button, and "Sign out".
- State machine: signed out → sign-in; signed in with no consent of the current version → consent; no linked shop → link; else `Ready`.
- Large tap targets (at least 48 dp), labels on every field, errors announced (`semantics { liveRegion = LiveRegionMode.Polite }`).

- [ ] **Step 1:** Write the five files. **Step 2:** `./gw :app:compileDebugKotlin` clean. **Step 3:** Self-review against the rules in `firebase/firestore.rules` (the link write must change exactly the two keys). **Step 4: Commit** `feat(android): phone sign-in, consent and invite-code link`.

---

### Task 7: Bill flow — home, processing, preview, result

**Files:** create `android/app/src/main/java/com/hisaabcheck/app/bill/BillViewModel.kt`, `ui/HomeScreen.kt`, `ui/ProcessingScreen.kt`, `ui/PreviewScreen.kt`, `ui/ResultScreen.kt`. Nothing else. Depends on Task 4 being committed.

**Interfaces — Produces:**

```kotlin
sealed interface BillScreen {
    data object Home : BillScreen
    data class Processing(val step: Step) : BillScreen
    data class Preview(val redacted: ByteArray, val plan: RedactionPlan) : BillScreen
    data class Result(val billId: String, val bill: ProcessedBill) : BillScreen
    data class Failed(val message: String) : BillScreen
}
class BillViewModel(private val shop: Shop, app: Application) : AndroidViewModel(app) {
    val screen: StateFlow<BillScreen>
    val aiStatus: StateFlow<Availability>
    val recent: StateFlow<List<BillSummary>>
    fun onPhoto(uri: Uri)                       // load → processBill → save → Result
    fun onConsent(result: ConsentResult)        // answers the Preview
    fun downloadModel()
    fun retry()                                 // re-run the cascade for the same photo and bill id, while the photo is in memory
    fun saveEdits(fields: Map<String, String>)  // parse, re-run checks, BillStore.updateFields
    fun done()                                  // back to Home; drops the photo from memory
}
@Composable fun HomeScreen(vm: BillViewModel, shopName: String, onSignOut: () -> Unit)
@Composable fun ProcessingScreen(step: Step)
@Composable fun PreviewScreen(redacted: ByteArray, onSend: (ByteArray) -> Unit, onKeep: () -> Unit)
@Composable fun ResultScreen(vm: BillViewModel, state: BillScreen.Result)
```

Behaviour:

- Home: shop name; "Snap bill" (`ActivityResultContracts.TakePicture` with a `FileProvider` URI in the cache directory; keep the pending URI in `rememberSaveable`) and "Pick from gallery" (`PickVisualMedia`, images only); an AI status chip ("On-device AI ready", "On-device AI can be downloaded" with a "Download on-device AI" button and progress, "Downloading…", "No on-device AI on this phone — bills are read in the cloud with private numbers hidden"); the last 20 bills (supplier, date, total, status) from `BillStore.watchRecent`.
- Flow in the view model: `ImageLoader.load` → `RemoteConfigSource.load()` → `processBill` with the real adapters; `onStep` updates `Processing`; `askConsent` switches to `Preview` and suspends until `onConsent` is called; when the cascade returns, `BillStore.save` immediately, then `Result`. Any exception outside the cascade → `Failed` with a plain message and a "Try again" button. The original photo bytes stay only in memory and are dropped on `done()`.
- Preview: the redacted image fills the width; dragging on it draws an extra black rectangle (stored in image coordinates, scaled from the displayed size); "Undo last box"; "Send to cloud" paints the extra boxes onto the image with `BitmapPainter` and returns `ConsentResult.Send(newBytes)`; "Keep on device" returns `ConsentResult.Keep`. Explain in one sentence what the owner is looking at.
- Result: badge text and colour by the same rule as the web (`web/src/features/result/labels.ts` `badgeText`): device + passed → "Read on device"; cloud → "Checked in cloud: <reason>"; otherwise "Manual entry: <reason>", with the same reason wording as the web's `REASON` map; "N private number(s) hidden: <types>" using `piiLabel`; one red line per failed check with the web's `CHECK_MSG` wording; the ten fields in the web's order with the web's labels, numeric keyboard for amounts, red outline on a field whose check failed; "Save changes" (parses like the web's `web/src/features/result/fields.ts` `parseForm`: trims text, upper-cases the GSTIN, amounts must be numbers of 0 or more with commas and the rupee sign allowed; invalid fields are marked and nothing is saved), re-runs `runChecks` with the default config and calls `updateFields`; sync status ("Saved", "Will sync when online", "Not saved — the server refused this bill"); photo status when the shop stores photos; "Retry cloud" when the reason is `cloud_error` and the photo is still in memory; "Done".
- Strings are plain English for a shop owner. Tap targets at least 48 dp; every icon button has a content description.

- [ ] **Step 1:** Write the five files. **Step 2:** `./gw :app:compileDebugKotlin` clean. **Step 3:** Self-review: the original bytes are never handed to anything but the cascade; nothing logs bill content. **Step 4: Commit** `feat(android): capture, processing, send-to-cloud preview and result screens`.

---

### Task 8: Wiring, README, runtime check list, full verification

**Files:** `android/app/src/main/java/com/hisaabcheck/app/AppRoot.kt` (and `MainActivity.kt` if needed), `README.md`, `docs/superpowers/2026-11-26-subproject-c-followups.md` (new).

- [ ] **Step 1: Wire** `AppRoot(firebaseReady)`: not ready → the "Firebase is not set up" screen; else a `SessionViewModel`; `Loading` → progress; `SignedOut` → `SignInScreen`; `NeedsConsent` → `ConsentScreen`; `NeedsShop` → `LinkShopScreen`; `Ready` → a `BillViewModel` keyed by the shop id (view-model factory), switching on `BillScreen` to `HomeScreen`, `ProcessingScreen`, `PreviewScreen`, `ResultScreen` or the failure message. System back on Result/Failed returns to Home; back on Home leaves the app.
- [ ] **Step 2: Full verification**, recording the real summary lines: `./gw :core:test`; `./gw :app:assembleDebug` without `google-services.json`, and once with the example copied in then removed; from `web/`: unit tests, rules tests, build, lint. Report the APK path and size.
- [ ] **Step 3: README.** In the existing plain, measured tone: what the Android app does; that the Kotlin core passes the same shared vectors as the web core (with the real test counts); how to build the APK from the command line (the two environment variables, `android/gw :app:assembleDebug`, where the APK lands); the Firebase setup the owner must do (register `com.hisaabcheck.app` with the debug keystore's SHA-1 and SHA-256 — give the `keytool` command for `~/.android/debug.keystore`; download `google-services.json` into `android/app/`; enable phone sign-in and add a test phone number; register the App Check debug token from Logcat; deploy the rules); which phones have on-device AI and what happens on others; the invite-code steps for CA and owner. State plainly that the app has been compiled and unit-tested but never run on a phone.
- [ ] **Step 4: Follow-ups file**, same shape as `docs/superpowers/2026-11-26-subproject-b-followups.md`: state and counts; verified here vs not; the runtime checks in order (install, App Check token, sign-in with a test number, link, a clean bill, a blurry bill, the preview, the redacted image, the bill in the web inbox and its route log on the dashboard, on-device path on a supported phone, offline save); decisions made during the build; known gaps.
- [ ] **Step 5: Commit** `feat(android): wire the screens together; README and runtime check list for sub-project C`.
