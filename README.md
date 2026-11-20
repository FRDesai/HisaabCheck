# HisaabCheck

## What it is

HisaabCheck is a web app for accountants (CAs) in India. A CA picks a client shop, uploads photos of GST bills, and gets the key fields back (supplier, GSTIN, invoice number and date, taxable value, CGST/SGST/IGST, total) with a set of maths checks and a confidence score. The bill is read by the AI model built into Chrome (Gemini Nano) first. It goes to cloud Gemini only if the on-device read fails its checks or no on-device model exists, and only after private numbers have been blacked out of the image. It is built for the #BuildHybridAI hackathon on Firebase AI Logic hybrid inference.

## How hybrid routing works

The router is `web/src/core/router/processBill.ts`. For each bill it does this, in order:

1. **Availability.** In `smart` mode it asks Chrome whether the on-device model is available. If it is not (or the check throws), the reason is `no_device_model`. In `cloud_only` mode the device is skipped (`cloud_only_mode`).
2. **Device read and OCR in parallel.** OCR (Tesseract.js, in the browser) starts at once, before the device read, so a redaction is ready if the bill has to escalate. The device read has an 8 second timeout (`DEVICE_TIMEOUT_MS`).
3. **Checks and confidence.** The device answer is parsed and checked (see below). If the answer is not valid JSON, the device times out, or it errors, the bill escalates. If the maths checks pass and the confidence is at or above `confidence_threshold`, the bill is saved as a draft from the device read. Nothing leaves the browser.
4. **Redaction.** On escalation, OCR words go through the privacy shield, and the matched private numbers are painted black on a copy of the image.
5. **"Send to cloud?" preview.** If the shield is unsure (a label such as "A/C No" with no value found, a partial match, or a low-OCR-confidence word that looks like a number), the user sees the redacted image. They can draw extra black boxes, then send or keep the bill on the device.
6. **Cloud read.** Only the redacted JPEG is sent, to the model named by `cloud_model`. The answer is parsed and checked again, and the bill is saved as a draft marked as a cloud read. If the cloud checks fail, the user still sees the result with the failed checks and can edit it.

Checks (`web/src/core/checks/checks.ts`): total (line items or taxable value plus tax equals total, within `total_tolerance_inr`), GSTIN (valid format and checksum), tax split (CGST = SGST within the same state, IGST otherwise, judged from GSTIN state and place of supply), date (valid, not in the future, within 3 years, India time), and required fields. The confidence score is a weighted sum: total 0.35, GSTIN 0.25, tax split 0.15, date 0.10, required fields 0.10, plus 0.05 times the model's own confidence. A bill escalates if the total or GSTIN check fails, or the score is below `confidence_threshold`.

Every path that ends in **manual entry** (the bill is saved with status `manual_entry` and the user types the fields):

| Reason | When |
|---|---|
| `ocr_error` | Escalation needed but OCR failed, so private numbers cannot be found. |
| `redact_error` | Painting the redaction failed, or the image to send would be the original. |
| `user_kept_local` | The user chose not to send after the preview. |
| `cloud_error` | The cloud call failed, or its answer was not valid JSON. |
| the device failure reason | `routing_mode` is `device_only` and the device read was not usable (`no_device_model`, `device_timeout`, `device_error`, `invalid_json`, `total_mismatch`, `invalid_gstin` or `low_confidence`). |

**The app picks the inference mode itself.** The Firebase AI SDK has modes that choose between device and cloud automatically and fall back silently. HisaabCheck never uses them. The device adapter always uses the SDK's on-device-only mode and the cloud adapter always uses its cloud-only mode (`web/src/adapters/firebaseAi.ts`), so the router, not the SDK, decides where an image goes. A test (`web/tests/no-prefer.test.ts`) fails the build if the automatic modes appear in `web/src`.

## Privacy design

**What is detected and blacked out** (`web/src/core/shield/shield.ts`): PAN, Aadhaar (the 12 digits must pass the Verhoeff checksum), IFSC codes, mobile numbers and labelled landline numbers, and bank account numbers (only when an account label such as "A/C No" is on the same or the previous line). Each match is painted over with padding.

**GSTINs are never hidden.** They are public identifiers, and the GSTIN is needed to check the bill.

**Fail-closed guards:**
- The cloud is not called if OCR failed.
- The cloud is not called if the image to send is the original (when masking is on).
- The cloud is not called if redaction throws.
- The device adapter refuses to run when Chrome has no on-device model, and rejects any answer whose source is not the device. It never silently uses the cloud.
- The preview component shows and returns only the redacted image; the original is not available to it.

**Logging and storage.** Route logs hold counts and types only: path, reason, number of items masked, the types of private numbers found, latency, estimated cost, model name and prompt version. They hold no image and no extracted values. Firestore rules reject any other key in a route log (`firebase/firestore.rules`). A bill photo is stored only if the shop was created with "store images" on, and only the redacted version is uploaded (JPEG, under 3 MB; `firebase/storage.rules`). A bill read fully on the device has no redacted image, so no photo is stored for it.

**Limits, stated plainly:**
- The shield is pattern-based. It can miss private numbers in unusual formats, layouts or poor OCR.
- The leak check (see the accuracy tool below) re-reads the redacted image with the same detector. It shows that no private number the detector can recognise survived redaction. It does not show that every private number on the bill was found.
- The human preview covers cases the shield flags as uncertain. It cannot help when the shield is confidently wrong.

## Remote Config keys

Defaults are in `web/src/core/config/defaults.ts` and `firebase/remoteconfig.template.json`. If Remote Config cannot be fetched, the defaults are used.

| Key | Default | Meaning |
|---|---|---|
| `routing_mode` | `smart` | `smart`: device first, cloud on failure. `device_only`: never use the cloud. `cloud_only`: skip the device. |
| `confidence_threshold` | `0.8` | A device read scoring below this escalates. |
| `consent_ocr_threshold` | `0.6` | OCR word confidence (as a fraction of 100) below which a number-like word makes the shield "unsure". |
| `total_tolerance_inr` | `1` | Allowed difference in rupees for the total check. |
| `max_device_line_items` | `10` | Limit on line items asked for in the on-device prompt. |
| `cloud_model` | `gemini-3.1-flash-lite` | Cloud model name. |
| `extraction_prompt_version` | `v1` | Recorded on each bill and route log. |
| `mask_pii` | `true` | Redact private numbers before any cloud call. In production builds this is always on, whatever Remote Config says. It can be turned off only in development builds. |

## Setup

**Prerequisites**
- Node.js 20 or newer.
- Java 11 or newer, for the Firestore emulator used by the rules tests.
- Chrome with built-in AI, for the on-device path. Chrome documents these needs for Gemini Nano: 16 GB RAM or more than 4 GB VRAM, and about 22 GB free disk for the model download. Without it, the app still works through the cloud path.

**Firebase project** (the code uses the placeholder project ID `hisaabcheck-dev`):
1. Create a project and put it on the Blaze plan.
2. Pick region `asia-south1` for Firestore and Storage.
3. Enable Firebase AI Logic with the Gemini Developer API.
4. Enable Google sign-in in Authentication.
5. Create Firestore and Storage.
6. Create Remote Config (the template in `firebase/` provides the 8 keys).
7. Set up App Check with reCAPTCHA Enterprise and register a web site key.
8. Register a web app and copy its config.

**Environment.** From `web/`, copy `.env.example` to `.env.local` (it is git-ignored) and fill in the Firebase config values and `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. Keep `VITE_APPCHECK_DEBUG=true` for local development.

**App Check debug token.** With the debug flag on, the first page load prints a debug token in the browser console. Register that token in the Firebase console under App Check. The flag has no effect in production builds.

**Run locally:** `cd web && npm install && npm run dev`.

**Deploy.** From `firebase/`, log in with the Firebase CLI and deploy rules, indexes and Remote Config:

```
cd firebase
firebase deploy --only firestore:rules,firestore:indexes,storage,remoteconfig --project hisaabcheck-dev
```

Hosting deploys from `web/` with `npm run deploy` (it runs the build, then `firebase deploy --only hosting`). The first Storage rules deploy asks for permission to let Storage rules read Firestore (the rules check shop ownership); answer yes. For a hosted build, register the Hosting domain on the reCAPTCHA key and build with `VITE_APPCHECK_DEBUG=false`.

## Tests

Run from `web/`.

- `npm test` runs the unit and component-logic suites with Vitest: 16 files, 145 tests in the last run. They cover config parsing, GSTIN/Aadhaar checksums, shield test vectors, redaction planning, extraction parsing, the checks and score, the router (`processBill`, with fake adapters), route logs and stats, accuracy comparison and summary, the Firebase AI adapter guards, the store adapter, and the rule that the automatic inference modes are not used.
- `npm run test:rules` runs the Firestore rules tests against the Firebase emulator (needs Java; 1 file, 5 tests in the last run). It covers owner-only reads and writes of shops and bills, and route logs being append-only, owner-only and free of extra keys. The Storage rules have no automated test.

## Accuracy and leak-check tool

A development-only page, left out of production builds. Run `npm run dev` (it needs a configured `web/.env.local`, because the cloud read and Remote Config use Firebase) and open `/dev/accuracy`. The route does not require sign-in.

Select the bill images and a file named `truth.json` together. `truth.json` is an object keyed by image file name; each value holds the seven fields compared:

```json
{
  "bill01.jpg": {
    "supplierGstin": "27ABCDE1234F1Z5",
    "invoiceDate": "2026-03-14",
    "taxableValue": 1000,
    "cgst": 90,
    "sgst": 90,
    "igst": 0,
    "total": 1180
  }
}
```

Images with no entry are skipped and listed; entries with no image are listed too. Numbers match within 1 rupee; text matches ignoring case and surrounding spaces.

For each bill the tool runs the device read (if Chrome has the model), then OCR, the shield and redaction, then a cloud read on the redacted image, then re-runs OCR and the shield on the redacted image. Columns in the table and the downloadable CSV:

- device and cloud fields OK: how many of the 7 fields matched truth (`-` if that read did not run or failed), with read time in milliseconds in the CSV.
- masked: private numbers painted over.
- leak (`pii_left`): private numbers the detector still finds in the redacted image. `unchecked` if the bill errored before the check.
- unsure: the shield would have shown the preview.

The summary shows device and cloud field accuracy, failed and unsure bills, and the total leak count. It warns if not all bills were leak-checked.

## Status

Implemented: Google sign-in and consent screen; client shops; bill upload with the full routing cascade; the on-device and cloud adapters; the privacy shield, redaction and consent preview; result screen with checks, editing and manual entry; saving bills and route logs; the routing dashboard; Remote Config; Firestore and Storage rules with a Firestore rules test suite; the accuracy and leak-check tool.

**Not yet verified against a real Firebase project or in Chrome:** sign-in, saving to Firestore, the on-device read, the cloud read, the dashboard with live data, the Storage rules (including the image upload), App Check, and the Hosting deploy. The unit tests use fake adapters, and the rules tests cover only Firestore.

**Measured accuracy:** not yet measured. To be filled in from the 40-bill run.

`CLOUD_COST_PER_CALL_USD` in `web/src/core/config/defaults.ts` is an estimate, to be replaced by a measured value. No speed, cost-saving or on-device-share figures have been measured yet.

## Roadmap

Not in this version:
- CA review and export: bill inbox and filters, approve/reject, CSV and Tally export.
- Android app: phone OTP, invite codes, offline queue.
- Loan-ready report (PDF) and a delete-my-data flow.

## License

Apache License 2.0. See `LICENSE`.
