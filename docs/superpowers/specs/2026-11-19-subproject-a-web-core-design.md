# Sub-project A: Foundation, bill-reading core and web owner flow

Date: 2026-11-19 · Source of truth for requirements: `PRD1.md` (FR/NFR ids below refer to it)
Target: working, hosted web entry by 23 Nov 2026.

## 1. Scope

**In scope**

- Firebase foundation for `hisaabcheck-dev` (and later `-prod`): Auth (Google), App Check (reCAPTCHA Enterprise), Remote Config template, Firestore + rules, Hosting.
- The bill-reading core in TypeScript: availability check, privacy shield, image redaction, extraction, checks, confidence, router, route logs (FR-5 to FR-12, FR-14).
- Web app for CAs: Google sign-in, consent screen, create/pick client shop, upload bills, consent preview, result screen with badge, routing dashboard (FR-1, FR-2 web half, FR-4, FR-13, FR-20).
- Accuracy and leak-check tool, run on 40 real bills (day-1 priority, used to lock the prompt).

**Out of scope (later sub-projects)**

- B: bill inbox and filters, approve/reject, CSV/Tally export (FR-16 to FR-18).
- C: Android app, phone OTP, invite codes, offline queue (FR-3, FR-15, FR-21).
- D: loan report PDF (FR-19), delete-my-data flow.

## 2. Stack

React 18 + Vite + TypeScript (strict), Tailwind CSS, React Router, Vitest. Firebase JS SDK (`firebase/ai`, `auth`, `app-check`, `remote-config`, `firestore`, `storage`) pinned to an exact version. Tesseract.js (lazy-loaded). Firebase emulators + `@firebase/rules-unit-testing` for rules tests.

## 3. Architecture

Approach: a plain TS core with swappable adapters. `src/core/` never imports React or Firebase; it talks to the outside world only through the interfaces in `core/types.ts`.

```
hisaabcheck/
  web/
    src/core/
      types.ts        Bill, Checks, RouteDecision, Config + adapter interfaces
      config/         defaults (bundled) + parse/validate Remote Config values
      shield/         GSTIN finder (allow-list), PAN/Aadhaar(Verhoeff)/phone/bank/IFSC
                      matchers, uncertainty detector
      redact/         OCR words + matches -> padded black boxes; RedactionPlan
      extract/        prompts by version, JSON schema, tolerant parser
      checks/         FR-9 checks, GSTIN checksum + state code, confidence score
      router/         processBill(): the cascade (state machine)
    src/adapters/     firebaseAi (device + cloud), tesseractOcr, canvasPainter,
                      remoteConfig, firestoreStore, routeLogger
    src/features/     auth, consent, shops, upload, preview, result, dashboard
    src/dev/accuracy/ dev-only accuracy + leak-check page (not in prod build)
  shared/test-vectors/  JSON fixtures reused by the Kotlin port in sub-project C
  firebase/           firestore.rules, storage.rules, remoteconfig.template.json,
                      firebase.json, .firebaserc
```

**Adapter interfaces (core/types.ts)**

| Interface | Methods | Real implementation |
| --- | --- | --- |
| `DeviceModel` | `availability(): 'available' \| 'downloadable' \| 'downloading' \| 'unavailable'`, `download(onProgress)`, `extract(image, prompt): string` | `firebase/ai` with `InferenceMode.ONLY_ON_DEVICE` |
| `CloudModel` | `extract(redactedImage, prompt, model): string` | `firebase/ai` with `InferenceMode.ONLY_IN_CLOUD` |
| `Ocr` | `recognize(image): OcrWord[]` (text, bbox, confidence) | Tesseract.js, lazy-loaded worker |
| `Painter` | `paint(image, boxes): Blob` | `OffscreenCanvas` / canvas |
| `ConfigSource` | `get(): Config` | Remote Config with bundled defaults |
| `Clock` | `now()` | `Date` |

`PREFER_ON_DEVICE` / `PREFER_IN_CLOUD` are never used (FR-8). A unit test scans `src/` and fails if `PREFER_` appears.

## 4. The cascade: `processBill(image, ctx)`

`processBill` is a state machine that returns steps the UI can show, and it pauses for consent when needed.

1. **Availability.** `available` → step 2. `downloadable`/`downloading` → the UI shows the "Download on-device AI" button (download needs a user click); this bill goes to step 4 with reason `no_device_model`. `unavailable` → step 4, reason `no_device_model`. `routing_mode = cloud_only` → step 4, reason `cloud_only_mode`.
2. **Device read + OCR in parallel.** Device read on the raw image with an 8 s timeout. OCR starts at the same moment. The prompt is chosen by `extraction_prompt_version`; in a single call the device prompt always asks for totals plus `itemCount`, and asks for `items` only "if there are `max_device_line_items` or fewer". If `items` is missing, the totals-only check is used.
3. **Checks.** Parse JSON, run checks, compute confidence (section 5). Pass → save with path `device`. Fail → reason is the first failed hard check, else `low_confidence`, `device_timeout`, `device_error` or `invalid_json`. In `device_only` mode → save as `manual_entry` with the device fields and stop.
4. **Redact.** Wait for OCR. Shield finds GSTINs first (never redacted), then PII matches; boxes are padded by 4 px and painted black. If the uncertainty detector fires → return `needsConsent` with the redacted image; resume on user choice. "Keep on device" → save as `manual_entry`.
5. **Cloud read** on the redacted image using `cloud_model`, then checks again. Save with path `cloud`, keeping the escalation reason. Checks failing again → saved as `draft` with red marks (the CA fixes it in the review screen in sub-project B).
6. **Save + log.** Write the bill and one route log entry. No restore step.

`mask_pii` is forced to `true` when `import.meta.env.PROD`.

## 5. Checks and confidence

Hard checks (any failure escalates regardless of score): total check, GSTIN valid.

| Check | Rule | Weight |
| --- | --- | --- |
| total | sum(items.amount) + cgst + sgst + igst = total within `total_tolerance_inr`; totals-only read: taxableValue + tax = total | 0.35 (hard) |
| gstin | 15 chars, format, mod-36 checksum, state code 01–38 and matches place of supply when given | 0.25 (hard) |
| taxSplit | (cgst = sgst within ₹1 and igst = 0) or (cgst = sgst = 0 and igst > 0) | 0.15 |
| date | valid YYYY-MM-DD, not in the future, not older than 3 years | 0.10 |
| required | supplierName, supplierGstin, invoiceNo, invoiceDate, total present | 0.10 |
| model | model's own `confidence`, clamped 0–1 | 0.05 |

Score = sum of weights of passing checks + 0.05 × model confidence. Escalate if any hard check fails or score < `confidence_threshold`.

## 6. Privacy shield and redaction

- **GSTIN first:** `\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b` (tolerant of OCR `O`/`0` confusion in the checksum test). Matching word spans go on an allow-list.
- **PAN:** `\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b`, skipped if inside an allow-listed GSTIN span.
- **Aadhaar:** 12 digits (allowing spaces as 4-4-4), first digit 2–9, Verhoeff valid.
- **Phone:** Indian mobile `(\+91[\s-]?|0)?[6-9]\d{9}`, plus 10-digit numbers with a phone label nearby (Ph, Mob, Tel, Contact).
- **Bank account:** 9–18 digits with a label nearby (A/c, Account, Acc No).
- **IFSC:** `\b[A-Z]{4}0[A-Z0-9]{6}\b`.
- Matches spanning several OCR words merge their boxes.
- **Uncertain** (opens the preview, FR-11): an OCR word with confidence < `consent_ocr_threshold` that looks PII-like; a partial match (e.g. `[A-Z]{5}\d{2,3}`); or a PII label (PAN, Aadhaar, A/c, Mob, Ph, IFSC) with no value matched within the same line or the next word.
- OCR words, text and boxes exist only in memory for the bill being processed.

## 7. Data model (refines the PRD)

- `users/{uid}`: role, name, email, `consentVersion`, `consentAt`, createdAt.
- `shops/{shopId}`: caUid, shopName, gstin, state, `storeImages` (default false), createdAt. (`ownerUid`, `inviteCode`, `privacyTier` arrive with Android.)
- `shops/{shopId}/bills/{billId}`: PRD fields + `status: draft | approved | rejected | manual_entry` (adds `manual_entry`), `route: {path, reason, confidence, promptVersion, modelName}`, `checks: {total, gstin, taxSplit, date, required}` as booleans, `imagePath?` (redacted image only, only when `storeImages`).
- `routeLogs/{logId}`: PRD fields + `shopId`, `caUid`, `piiTypes: string[]` (types only, never values).

**Rules:** a CA reads and writes only shops where `caUid == request.auth.uid` and their bills; route logs can be created only with `caUid == uid`, and read by their CA or an admin; nobody updates or deletes route logs. Admin role is set by hand in Firestore for now.

## 8. Web screens

1. **Sign in** with Google, then a **consent screen** on first sign-in (specific, separate statement for bill processing; stores version and time).
2. **Shops:** list, plus "Add client shop" (name, GSTIN validated by the same core checker, state, store-images toggle off by default).
3. **Upload** for the chosen shop: drag-and-drop or pick several JPEG/PNG; images resized to max 1600 px in the browser. Each bill gets a card showing live steps (Checking device AI → Reading on device → Checking maths → Hiding private numbers → Reading in cloud → Saved). Header shows an on-device AI status chip and the "Download on-device AI" button with progress.
4. **"Send to cloud?" preview:** the redacted image; the user drags rectangles to black out more; buttons Send to cloud / Keep on device.
5. **Result:** the original image (local object URL only) beside the fields; failed checks in red with a short reason; badge "Read on device" or "Checked in cloud: <reason>"; fields editable, Save keeps `draft`. A toggle shows the redacted version that was sent, for the demo.
6. **Routing dashboard:** live (`onSnapshot`) totals for % device vs cloud, reasons breakdown, PII items redacted by type, raw PII sent (always 0, from the leak check), estimated cost saved (cloud bills × cost per call vs all bills × cost), current `routing_mode`.

Accessibility (NFR-10): labelled controls, keyboard-usable preview drawing alternative (add box by selecting a detected OCR word), contrast AA.

## 9. Error handling

| Failure | Behaviour |
| --- | --- |
| Device read throws / > 8 s | reason `device_error` / `device_timeout` → cloud path (or `manual_entry` in `device_only`) |
| Model returns invalid JSON | tolerant parse (strip fences, trailing commas); else reason `invalid_json` → escalate |
| Cloud call fails (network, App Check, quota) | save as `manual_entry` with reason `cloud_error` and any device fields; card shows Retry while the image is still in memory |
| OCR fails | cloud path is blocked, since redaction cannot be proven → saved as `manual_entry` with reason `ocr_error` and any device fields; card explains why |
| Remote Config fetch fails | bundled defaults; minimum fetch interval 30 s so a live switch is picked up for the next bill |
| Firestore write fails / offline | Firestore persistent local cache queues writes; card shows "Will sync" |

## 10. Testing

- **Unit (Vitest), test-first:** shield matchers and Verhoeff/GSTIN checksums from `shared/test-vectors/pii.json` (includes GSTIN-next-to-PAN, PAN-inside-GSTIN, spaced Aadhaar, invalid Verhoeff, labelled bank numbers); checks and confidence from `shared/test-vectors/bills.json`; redaction box planning; config parsing and prod `mask_pii` lock; no-`PREFER_` scan.
- **Router:** table-driven tests with fake adapters, covering every path: device pass, each escalation reason, every availability state, each routing mode, consent send/keep, cloud error, OCR failure. Asserts the cloud adapter is never called with the raw image.
- **Rules:** emulator tests for CA isolation and the append-only route logs.
- **Accuracy + leak check (`src/dev/accuracy`, Chrome on a Nano-capable machine):** takes a folder of bills + ground-truth JSON, runs device and cloud for each, writes a CSV of per-field accuracy, path, latency and cost; re-OCRs each redacted image and fails on any PII match. Results feed the README and the demo numbers.
- **Manual demo checklist** before deploy: each storyboard scene from the PRD works on the hosted URL.

## 11. Manual setup the user must do

Create `hisaabcheck-dev` on the Blaze plan in asia-south1; enable AI Logic (Gemini Developer API), App Check with a reCAPTCHA Enterprise key, Google sign-in, Firestore, Storage, Remote Config; add the web app and share its config; register a debug token for local dev; secure a Nano-capable Chrome machine (16 GB RAM, 22 GB free disk); collect 40 real bills with ground-truth values.

## 12. Build order

1. Repo scaffold, core types, test vectors, shield + checks (pure TS, test-first).
2. Firebase adapters + accuracy tool → run on real bills → lock prompt v1 (19–20 Nov).
3. Redaction + router with fakes, then real adapters.
4. Auth, consent, shops, upload, preview, result screens.
5. Route logs + dashboard, rules + rules tests, Remote Config template, deploy to Hosting (by 23 Nov).
