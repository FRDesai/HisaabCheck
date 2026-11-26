# HisaabCheck

## What it is

HisaabCheck is a web app for accountants (CAs) in India. A CA picks a client shop, uploads photos of GST bills, and gets the key fields back (supplier, GSTIN, invoice number and date, taxable value, CGST/SGST/IGST, total) with a set of maths checks and a confidence score. The CA then reviews each bill in an inbox, approves it or rejects it with a note, and exports approved bills as CSV or as Tally XML. The bill is read by the AI model built into Chrome (Gemini Nano) first. It goes to cloud Gemini only if the on-device read fails its checks or no on-device model exists, and only after private numbers have been blacked out of the image. It is built for the #BuildHybridAI hackathon on Firebase AI Logic hybrid inference.

## How hybrid routing works

The router is `web/src/core/router/processBill.ts`. For each bill it does this, in order:

1. **Availability.** In `smart` mode it asks Chrome whether the on-device model is available. If it is not (or the check throws), the reason is `no_device_model`. In `cloud_only` mode the device is skipped (`cloud_only_mode`).
2. **Device read and OCR in parallel.** OCR (Tesseract.js, in the browser) starts at once, before the device read, so a redaction is ready if the bill has to escalate. The device read has an 8 second timeout (`DEVICE_TIMEOUT_MS`).
3. **Checks and confidence.** The device answer is parsed and checked (see below). If the answer is not valid JSON, the device times out, or it errors, the bill escalates. If the maths checks pass and the confidence is at or above `confidence_threshold`, the bill is saved as a draft from the device read. The image is not sent to the cloud model; only the extracted fields and a counts-only route log are saved to Firestore.
4. **Redaction.** On escalation, OCR words go through the privacy shield, and the matched private numbers are painted black on a copy of the image.
5. **"Send to cloud?" preview.** If the shield is unsure (a label such as "A/C No" with no value found, a partial match, or a low-OCR-confidence word that looks like a number), or OCR read too little of the bill to trust the shield (fewer than `MIN_OCR_WORDS` words, or a median word confidence below `MIN_OCR_MEDIAN_CONFIDENCE`; `web/src/core/shield/adequacy.ts`), the user sees the redacted image before anything is sent. They can draw extra black boxes, then send or keep the bill on the device.
6. **Cloud read.** Only the redacted JPEG is sent, to the model named by `cloud_model`. The answer is parsed and checked again, and the bill is saved as a draft marked as a cloud read. If the cloud checks fail, the user still sees the result with the failed checks and can edit it.

Checks (`web/src/core/checks/checks.ts`): total (line items or taxable value plus tax equals total, within `total_tolerance_inr`), GSTIN (valid format and checksum), tax split (CGST = SGST within the same state, IGST otherwise, judged from GSTIN state and place of supply), date (valid, not in the future, within 3 years, India time), and required fields. The confidence score is a weighted sum: total 0.35, GSTIN 0.25, tax split 0.15, date 0.10, required fields 0.10, plus 0.05 times the model's own confidence. A bill escalates if the total or GSTIN check fails, or the score is below `confidence_threshold`.

Every path that ends in **manual entry** (the bill is saved with status `manual_entry` and the user types the fields):

| Reason | When |
|---|---|
| `ocr_error` | Escalation needed but OCR failed, so private numbers cannot be found. |
| `redact_error` | Painting the redaction failed, the preview failed, or the image to send would be the original. |
| `user_kept_local` | The user chose not to send after the preview. |
| `cloud_error` | The cloud call failed, or its answer was not valid JSON. |
| the device failure reason | `routing_mode` is `device_only` and the device read was not usable (`no_device_model`, `device_timeout`, `device_error`, `invalid_json`, `total_mismatch`, `invalid_gstin` or `low_confidence`). |

**The app picks the inference mode itself.** The Firebase AI SDK has modes that choose between device and cloud automatically and fall back silently. HisaabCheck never uses them. The device adapter always uses the SDK's on-device-only mode and the cloud adapter always uses its cloud-only mode (`web/src/adapters/firebaseAi.ts`), so the router, not the SDK, decides where an image goes. A test (`web/tests/no-prefer.test.ts`) text-scans `web/src` and fails `npm test` if the automatic mode names appear.

## Privacy design

**What is detected and blacked out** (`web/src/core/shield/shield.ts`): PAN, Aadhaar (the 12 digits, plain or grouped with spaces or hyphens, must pass the Verhoeff checksum), IFSC codes, mobile numbers and labelled landline numbers, and bank account numbers (only when an account label such as "A/C No", "Acc. Number", "ACC#" or "Account Number" is on the same or the previous line). It also hides **possible ID numbers** as a precaution: Aadhaar-shaped numbers that fail the checksum, and PAN or mobile numbers that match only after undoing a common OCR mix-up (O/0, I/1, l/1, S/5, B/8, Z/2). These are shown as "Possible ID number". Each match is painted over with padding.

**GSTINs are deliberately not masked:** words that match the GSTIN pattern are excluded from redaction. They are public identifiers, and the GSTIN is needed to check the bill.

**Fail-closed guards:**
- The cloud is not called if OCR failed.
- The cloud is not called if the image to send is the original (when masking is on).
- The cloud is not called if redaction throws.
- The cloud is not called without the preview if OCR read too little text to trust the shield.
- With `mask_pii` off (development builds only) the image sent is not labelled as redacted, so it is never stored.
- The device adapter refuses to run when Chrome has no on-device model, and rejects any answer whose source is not the device. It never silently uses the cloud.
- The preview component shows and returns only the redacted image; the original is not available to it.

**OCR download.** OCR runs in the browser, but its worker and English language data are downloaded from a public CDN on first use (no bill data is sent). Self-hosting those files is planned.

**Logging and storage.** Route logs hold counts and types only: path, reason, number of items masked, the types of private numbers found, latency, estimated cost, model name and prompt version. They hold no image and no extracted values. Firestore rules reject any other key in a route log, check each field's type and range, require the server's time as `createdAt`, and accept a log only for a shop the writer owns (`firebase/firestore.rules`). A bill photo is stored only if the shop was created with "store images" on, and only the redacted version is uploaded (JPEG, under 3 MB; `firebase/storage.rules`). A bill read fully on the device has no redacted image, so no photo is stored for it.

**Limits, stated plainly:**
- The shield is pattern-based. It can miss private numbers in unusual formats, layouts or poor OCR.
- The leak check (see the accuracy tool below) re-reads the redacted image with the same detector. It shows that no private number the detector can recognise survived redaction. It does not show that every private number on the bill was found.
- The human preview covers cases the shield flags as uncertain and bills where OCR read too little text. It cannot help when the shield is confidently wrong on a well-read bill.

## Review and export

**Inbox.** Each shop has a bill inbox (`web/src/features/inbox/InboxPage.tsx`). It shows the newest 300 bills of the shop and updates live. A "Load older bills" link adds 300 more. The filters are To review (draft or manual entry), Failed checks (open bills with at least one failed check), Manual entry, Approved, Rejected and All, each with a count, plus a month filter. The month is the invoice date's month; a bill without a valid date falls under the month it was uploaded. Filtering runs in the browser (`web/src/core/review/filters.ts`).

**Review screen.** Opening a bill shows the stored photo next to the fields. The photo is the redacted copy, and it exists only for shops that opted in to storing photos; for other shops the screen says "No photo stored". Edits re-run the checks as you type.
- Approval is blocked while the `required` or `date` check fails, because an approved bill must be exportable by its date.
- If `total`, `gstin` or `taxSplit` fails, the CA can still approve after ticking "I have checked this bill against the paper copy". The tick covers only the failures listed when it was made. The failed checks are saved on the bill as `approvedWithFailedChecks`.
- The taxable value is checked too. When a bill has line items, the `total` check compares the items with the total and never looks at the stored taxable value, yet both exports use it. So the review screen also works out the taxable value the exports would use (a stored 0 counts as total minus tax) and, if taxable value plus tax is more than ₹1 away from the total or the taxable value works out negative, shows a red line "Taxable value + tax ≠ total". This is one more item that needs the paper-copy tick; it is part of the set the tick covers, and an approval with it saves `taxable` in `approvedWithFailedChecks`. The approved-bill banner shows it as "Taxable value + tax ≠ total".
- Reject needs a note of 1 to 500 characters. It is shown on the bill as a note to the client.
- An approved or rejected bill can be reopened; it goes back to draft. A reviewed bill cannot be edited any other way (see Rules below).
- Approve, reject, reopen and save wait for the server's answer. If one has not finished after 4 seconds, the screen shows "Still saving — waiting for the connection." and adds that the change is kept on this computer and will be sent when the connection is back. The code is written so that offline saves wait like this; this has not been tried offline. If the write fails, the screen shows an error and keeps the CA's edits. If the CA leaves the bill before a pending approve or reject finishes, the write still goes through when the connection returns, but the app does not jump to another page when it does.
- After an approve or reject the screen moves to the next open bill. If there is none, it returns to the inbox and says "All bills reviewed." only when the shop's bill list has loaded and holds fewer than 300 bills; otherwise it returns to the inbox with no message.
- Line items are shown read-only. The CA can choose to ignore them, and they are then removed when the bill is saved.
- If the bill is changed elsewhere (for example in another tab) while the form is open, there are three cases. If it was approved or rejected, the form shows the stored values and says so; any unsaved edits are dropped, and the message says they were not saved. If its fields changed and the form has no unsaved edits, the form quietly reloads the new values with no message. If its fields changed and the form has unsaved edits, the edits stay and a message warns that saving will replace the other changes.

**Rules.** Firestore rules (`firebase/firestore.rules`) accept only the four statuses, accept an approval or rejection only in the signed-in owner's own name and at server time (or with the stored review time left as it was), and require a note of 1 to 500 characters on a reject. A reviewed (approved or rejected) bill is locked: the only updates allowed are adding the photo path (`imagePath`, which arrives after the upload) or reopening it to draft while changing nothing but the review fields. So a field edit, a full re-save (for example "Retry cloud" on the upload page for a bill approved in another tab) and a straight switch between approved and rejected are refused; the upload page then shows its usual "Not saved"/"Could not save" message. The rules do not check the contents of `approvedWithFailedChecks`.

**CSV.** From the export panel, pick an invoice-date range (it starts at the month chosen in the inbox, or at the current month if the inbox shows all months). The export reads the bills from the server only, so it needs a connection: offline, the panel says so and offers no download, instead of exporting whatever this browser has cached. The CSV has one row per approved bill in that range, sorted by invoice date, then invoice number: invoice date, invoice no., supplier, supplier GSTIN, place of supply, taxable value, CGST, SGST, IGST, total, read by (device, cloud or manual), approved on, and bill id. The taxable value column is the figure the Tally file books: the stored value, or total minus tax when the stored value is 0. It starts with a byte-order mark so Excel reads ₹ and Indian names correctly. A text cell that begins with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe so a spreadsheet does not run it as a formula.

**Tally XML.** The same range gives two files, to be imported in this order:
1. The ledgers file ("masters"). It creates one ledger per supplier under Sundry Creditors (with the GSTIN if valid), plus `Purchases` (Purchase Accounts), `Input CGST`, `Input SGST`, `Input IGST` (Duties & Taxes) and `Round Off` (Indirect Expenses).
2. The vouchers file: one Purchase voucher per bill, with the supplier credited and the purchase and tax ledgers debited. A gap of up to ₹1 between taxable value plus tax and the total goes to `Round Off`.

Approved bills are left out of the Tally files if taxable value plus tax differs from the total by more than ₹1, if the total is 0 or less, if the taxable value works out negative, if CGST, SGST or IGST is negative, or if the invoice date is not a valid YYYY-MM-DD date. The export panel lists them, saying their amounts do not add up or the date or an amount is not valid. They are still in the CSV.

**The Tally XML has not been imported into a real Tally.** It was written from the format as understood, and nobody has run it. Try it on a test company first.

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
- A recent JDK (the emulator was run with OpenJDK 27 here), for the Firestore emulator used by the rules tests.
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

- `npm test` runs the unit and component-logic suites with Vitest: 29 files, 310 tests in the last run. They cover config parsing, GSTIN/Aadhaar checksums, shield test vectors, redaction planning, extraction parsing, the checks and score, the router (`processBill`, with fake adapters), route logs and stats, accuracy comparison and summary, the Firebase AI adapter guards, the store adapter, the review logic (bill reader, filters, approval rules, the taxable-value check), the CSV and Tally XML export, and the rule that the automatic inference modes are not used. There are no React component tests.
- `npm run test:rules` runs the Firestore rules tests against the Firebase emulator (needs Java; 1 file, 32 tests in the last run). It covers owner-only reads and writes of shops and bills, the review fields (status values, approval only in the owner's own name and at server time, a note of 1 to 500 characters on every reject, including a long Devanagari note), the lock on reviewed bills (no field edit, no full overwrite, no straight approved/rejected switch; the photo path and a reopen still pass), users not being able to make themselves admin, and route logs being append-only, owner-only, free of extra keys, type-checked, server-timed and tied to a shop the writer owns. The Storage rules have no automated test.

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

For each bill the tool runs the device read (if Chrome has the model), then OCR, the shield and redaction, then a cloud read on the redacted image, then re-runs OCR and the shield on the redacted image. A bill the shield is unsure about, or where OCR read too little text, is **not** sent to the cloud by default (the app would show the preview, and this tool has none); its cloud column shows "skipped (unsure)", it is counted separately and left out of the cloud accuracy average. A default-off checkbox, "Also send unsure bills to the cloud (redacted, no preview)", opts in. Columns in the table and the downloadable CSV:

- device and cloud fields OK: how many of the 7 fields matched truth (`-` if that read did not run or failed), with read time in milliseconds in the CSV.
- masked: private numbers painted over.
- leak (`pii_left`): private numbers the detector still finds in the redacted image. `unchecked` if the bill errored before the check.
- unsure: the app would have shown the preview (shield unsure or too little OCR text).
- `cloud_skipped` (CSV): the cloud read was skipped because the bill was unsure.

The tool calls the models directly: it bypasses the router and the "Send to cloud?" preview, so its leak count describes the redaction step, not the full production path.

The summary shows device and cloud field accuracy, failed and unsure bills, skipped cloud reads, and the total leak count. It warns if not all bills were leak-checked.

## Status

Implemented: Google sign-in and consent screen; client shops; bill upload with the full routing cascade; the on-device and cloud adapters; the privacy shield, redaction and consent preview; result screen with checks, editing and manual entry; saving bills and route logs; the routing dashboard; Remote Config; Firestore and Storage rules with a Firestore rules test suite; the accuracy and leak-check tool; the bill inbox with filters; the review screen (approve, approve after the paper-copy tick, reject with a note, reopen); CSV and Tally XML export of approved bills; Firestore rules for the review fields.

**Not yet verified against a real Firebase project or in Chrome:** the inbox, the review screen and the export (none of it has been rendered in a browser, and there are no component tests; see `docs/superpowers/2026-11-26-subproject-b-followups.md` for the check list), the Tally XML in a real Tally, sign-in, saving to Firestore, the on-device read, the cloud read, the dashboard with live data, the Storage rules (including the image upload), App Check, and the Hosting deploy. Also unverified: Tesseract OCR and the shield on real bill photos (the shield has been exercised only on test vectors), a live Remote Config fetch, deployment of the Firestore composite index, App Check enforcement for AI Logic, and the persistent offline cache. The unit tests use fake adapters, and the rules tests cover only Firestore.

**Measured accuracy:** not yet measured. To be filled in from the 40-bill run.

`CLOUD_COST_PER_CALL_USD` in `web/src/core/config/defaults.ts` is an estimate, to be replaced by a measured value. No speed, cost-saving or on-device-share figures have been measured yet.

## Roadmap

Not in this version:
- A cross-shop inbox, an "exported" mark on bills, and editable line items on the review screen.
- Android app: phone OTP, invite codes, offline queue.
- Loan-ready report (PDF) and a delete-my-data flow.

## License

Apache License 2.0. See `LICENSE`.
