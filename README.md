# HisaabCheck

## What it is

HisaabCheck is a web app for accountants (CAs) in India, with an Android app for their clients, the shop owners (see "Android app" below). A CA picks a client shop, uploads photos of GST bills, and gets the key fields back (supplier, GSTIN, invoice number and date, taxable value, CGST/SGST/IGST, total) with a set of maths checks and a confidence score. The CA then reviews each bill in an inbox, approves it or rejects it with a note, exports approved bills as CSV or as Tally XML, and can print a one-page Business Health Report (monthly purchases, top suppliers, GST) for a date range. The bill is read by the AI model built into Chrome (Gemini Nano) first. It goes to cloud Gemini only if the on-device read fails its checks or no on-device model exists. Before any cloud call, HisaabCheck blacks out the PAN, Aadhaar, mobile, bank-account and IFSC numbers it finds, and asks you to check the masked image whenever it is unsure. The web app is the CA's side; the Android app is the shop owner's side: the owner photographs bills on a phone and they appear in the CA's inbox. It is built for the #BuildHybridAI hackathon on Firebase AI Logic hybrid inference.

## For judges

**What to look at**
- Hybrid routing with the privacy shield: the device read first, the cloud only on failure, and the masked image shown for a check when the shield is unsure, before any image leaves the device ("How hybrid routing works", "Privacy design"). The shield's tested limits are stated there.
- The CA side: the inbox, the review screen (approve, reject with a note, reopen) and the CSV and Tally XML export ("Review and export").
- The Business Health Report: a one-page summary of the approved bills for a period, printed or saved as a PDF from the browser ("Review and export").
- The Android owner app: phone sign-in, photographing a bill, the same routing in Kotlin, and the owner seeing the CA's rejection note ("Android app").

**Try it**
- Hosted web app: not deployed yet
- Android APK: not published yet
- Video: not recorded yet
- Locally, with no Firebase project: `cd web && npm install && npm run dev:emulators` (needs Java). It starts the Auth, Firestore and Storage emulators and the dev server, and the login page offers "Sign in as test CA" buttons. Sign-in, shops, upload, OCR, redaction, review, export and the rules work there. AI calls do not (Remote Config and the AI service cannot be emulated), so every bill that needs a read ends up as manual entry. See "Setup" for details.
- App Check and its debug tokens are not set up yet. "Setup" below describes how: register the debug token the browser prints in the Firebase console, and register the Hosting domain on the reCAPTCHA key for a hosted build.

**Test bills.** Six made-up bills are in `docs/test-bills/` (images, sources and a table of what each shows). All personal numbers on them (PAN, phone, Aadhaar, bank account) are invented. Run through Tesseract.js and the shield as the app does (27 November 2026), they behave like this:
- `bill1`: PAN and mobile hidden; the preview appears, because the rate "45.00" in the table was read as `4500]` with low confidence.
- `bill2`: bank account (labelled "A/C") and IFSC hidden; the preview appears, because the invoice number and a rate were read with low confidence.
- `bill3`: nothing to hide; no preview.
- `bill4`: Aadhaar-format number and landline hidden; the preview appears, because a table cell was read as `2000` with low confidence (not because of a missing value).
- `bill5`: nothing to hide; no preview.
- `bill6`: the "label without a value" demo. The "PAN:" line has no number, so the preview appears and nothing is hidden.

The previews on bills 1, 2 and 4 depend on how OCR reads table cells, so they can differ between runs, browsers and photos; bill 6's does not.

**Verified and not**
- Verified here: unit tests, rules tests on the emulator, the Kotlin core on the JVM, the shield on 130 computer-generated bill images in three sets read by Tesseract.js (see "Privacy design"), the Android debug APK assembling, and the web app, which has been run only against local emulators in headless Chrome.
- Not verified: any real Firebase project, the cloud read, the on-device AI, any Android phone or emulator, and any photograph of a real bill.
- Details and check lists: `docs/superpowers/2026-11-20-subproject-a-followups.md`, `docs/superpowers/2026-11-26-subproject-b-followups.md`, `docs/superpowers/2026-11-26-subproject-c-followups.md`.

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

**The claim.** Before any cloud call, HisaabCheck blacks out the PAN, Aadhaar, mobile, bank-account and IFSC numbers it finds, and asks you to check the masked image whenever it is unsure. It does not claim that every private number on every bill is hidden; the tested evidence and its limits are below.

**What the shield looks for** (`web/src/core/shield/shield.ts`, run on the words Tesseract.js reads from the photo):
- PAN; Aadhaar (12 digits, plain or grouped with spaces or hyphens, must pass the Verhoeff checksum); IFSC codes, also when OCR read the fifth character (always 0) as O, Q or D or one letter of the bank code as a digit (`SB1N`); mobile numbers (with or without +91, `(+91)` or 0); landline numbers, with a label such as "Ph" or "Tel", with the area code in brackets (`(080) 7229 7102`, also `[044]`, `{080}`, `|080|`, `(O80)` and `(80)`), or written `080 - 23456789`, with or without a label; and bank account numbers next to an account label ("A/C No", "Acc. Number", "ACC#", "Account Number") on the same or the previous line. The `A/C` label is also recognised when OCR reads the slash as another character (for example `AJC`).
- **Possible ID numbers**, hidden as a precaution and shown as "Possible ID number": Aadhaar-shaped numbers that fail the checksum; PAN and mobile numbers that match only after undoing a common OCR mix-up (O/0, I/1, S/5, B/8, Z/2); and **any other unclaimed run of 9 or more digits** (groups joined by a space, hyphen, dot or comma), after dates, times and amounts are set aside, because it could be a bank account whose label OCR misread. An amount at the end of a run of digit groups is not set aside: `8613 5061 1962.00` is hidden whole. This also hides numbers that are not private: e-way bill numbers, acknowledgement numbers and barcodes. If a match sits inside a longer run of digits, the rest of the run is hidden too, including a decimal tail such as `9010.00`.
- GSTINs are left visible (see below).

**When it asks for a check.** The shield marks a bill as unsure, and the user sees the masked image before anything is sent, when: a label (PAN, Aadhaar, IFSC, phone, account) has no value of its own kind found after it; a run of 9 or more digits is still visible after hiding; a group of digits is joined to an amount with 4 or more digits before its decimal point and the two hold 9 or more digits (a two-group account such as `50100234 5678.00` cannot be told from an HSN code next to an amount, so both ask); a word looks like part of a PAN (five letters and 1 to 3 digits); a number-like word was read with low OCR confidence (exempt: an amount not standing next to a bare group of digits, and a word with the GSTIN pattern once OCR look-alikes are undone); or OCR read too little of the bill (see step 5 above). In testing the preview appears on most bills (47 of 64, 27 of 36 and 20 of 30 generated bills in the three sets below).

**What was tested.** A first real run against local emulators found a bank account number sent unhidden after OCR misread its label; it was fixed. The shield was then tested on three sets of computer-generated bill images read by Tesseract.js: 64 bills (six fonts, rotation, blur, low resolution, JPEG, tables); 36 fresh bills from an independent re-review (eight fonts, bracketed landlines, remittance tables, decimal tails), which found 5 silent leaks in the previous version, all fixed; and 30 held-out bills generated with a new seed after the fix was final and run once, without tuning. The held-out bills come from the same generator as the fresh set, so they test unseen numbers and degradations, not new layouts. The words Tesseract.js returned for the first two sets are committed (`shared/test-vectors/ocr-real.json`, `ocr-real-fresh.json`) and replayed by `web/tests/core/shieldRealOcr.test.ts` and its Kotlin port, which pin these figures. A number counts as hidden when every word OCR read for it that holds a digit (or mostly digit look-alike letters) is blacked out; a preview counts as "related" only when a warning points at the number's own line.

| Set | Bills | Private numbers | Hidden | Preview, related | Preview, unrelated | Not read by OCR | Sent silently | Bills previewed |
|---|---|---|---|---|---|---|---|---|
| First | 64 | 310 | 305 | 5 | 0 | 0 | 0 | 47 (73%) |
| Fresh | 36 | 198 | 192 | 3 | 0 | 3 | 0 | 27 (75%) |
| Held-out | 30 | 165 | 165 | 0 | 0 | 0 | 0 | 20 (67%) |

Before this fix the same scoring gave, for the fresh set, 173 hidden, 17 previewed (10 of them only because of an unrelated warning) and 5 sent silently, and for the held-out set 150 hidden, 10 previewed (8 unrelated) and 5 sent silently. On the held-out set the reviewers' stricter scoring, which also counts a visible table border `|` or a `/` between two mobiles as part of the number, gives 160 hidden, 3 previewed and 2 "leaked"; in both of those cases every digit was hidden.

**Numbers OCR never read.** On 3 of the 12 remittance tables in the fresh set, Tesseract.js dropped the whole table row: the account number stays on the image and the shield has nothing to hide, and if nothing else on the bill raises a warning there is no preview. This is not fixed. The fail-closed guards below do not cover it.

**Wrongly hidden** (not private, hidden anyway), first / fresh / held-out set: GSTIN 0 / 0 / 0; invoice numbers 0 / 0 / 0; dates 0 / 0 / 0; HSN codes 6 of 193 / 1 of 133 / 4 of 113; amounts 6 of 642 / 3 of 422 / 0 of 356. Every e-way bill number (first set, 64) and 9-digit reference (fresh and held-out sets, 66) is hidden, by design. Before this fix the counts were the same except amounts on the first set (4).

**What this does not show.** It does not use photographs of real paper bills: the images are synthetic and computer-rendered. It does not use ML Kit, the OCR that the Android app uses. A result on these images says nothing about other bills, other fonts or real camera photos. The count of silent leaks is 0 on these sets only.

**Known remaining gaps:**
- A number OCR does not read at all (for example a dropped table row) is not hidden and not flagged.
- A PAN or IFSC whose shape OCR has misread too far is sent to the preview, not hidden.
- Digits misread as letters inside a number (`5OIOO2345B7891`) can keep it from being hidden; at low OCR confidence it is previewed.
- A dot or time inserted by OCR inside a number (`98450123.45`, `50100 12:30 4567`, `5010 0234.56 78`), an 8-digit local landline with no area code (`2345 6789`), and `(080) 2345.6789` pass without a warning.
- Anything that depends on OCR confidence: a number read with high confidence but wrongly is not flagged.
- Digits glued to letters still count towards the long-digit-run warning; changing that was declined, because it could turn a previewed account number into a silent leak.

**GSTINs are deliberately not masked:** words that match the GSTIN pattern are excluded from redaction. They are public identifiers, and the GSTIN is needed to check the bill.

**Fail-closed guards:**
- The cloud is not called if OCR failed.
- The cloud is not called if the image to send is the original (when masking is on).
- The cloud is not called if redaction throws.
- The cloud is not called without the preview if OCR read too little text to trust the shield.
- With `mask_pii` off (web development builds only; on Android it cannot be turned off in any build) the image sent is not labelled as redacted, so it is never stored.
- The device adapter refuses to run when Chrome has no on-device model, and rejects any answer whose source is not the device. It never silently uses the cloud.
- The preview component shows and returns only the redacted image; the original is not available to it.

**OCR download.** OCR runs in the browser, but its worker and English language data are downloaded from a public CDN on first use (no bill data is sent). Self-hosting those files is planned.

**Sign-out.** The local Firestore cache is cleared on sign-out, so the next person on the same browser or phone does not see the previous account's cached data. If another browser tab blocks the web wipe, the cache is cleared at the next sign-in by a different user instead. Unsent changes are waited for (up to 5 seconds) or the user is asked to confirm before signing out. The Android wipe has not run on a phone.

**Logging and storage.** Route logs hold counts and types only: path, reason, number of items masked, the types of private numbers found, latency, estimated cost, model name and prompt version. They hold no image and no extracted values. Firestore rules reject any other key in a route log, check each field's type and range, require the server's time as `createdAt`, and accept a log only for a shop the writer owns (`firebase/firestore.rules`). A bill photo is stored only if the shop was created with "store images" on, and only the redacted version is uploaded (JPEG, under 3 MB; `firebase/storage.rules`). A bill read fully on the device has no redacted image, so no photo is stored for it.

**Limits, stated plainly:**
- The shield is pattern-based. It can miss private numbers in unusual formats, layouts or poor OCR.
- The leak check in the accuracy tool (below) re-reads the redacted image with the same detector. It can show only that no private number the detector recognises survived redaction. It has not been run on real bills, and it does not show that every private number was found.
- The human preview covers cases the shield flags as uncertain and bills where OCR read too little text. It cannot help when the shield is confidently wrong on a well-read bill.

## Review and export

**Inbox.** Each shop has a bill inbox (`web/src/features/inbox/InboxPage.tsx`). It shows the newest 300 bills of the shop and updates live. A "Load older bills" link adds 300 more. The filters are To review (draft or manual entry), Failed checks (open bills with at least one failed check), Manual entry, Approved, Rejected and All, each with a count, plus a month filter. The month is the invoice date's month; a bill without a valid date falls under the month it was uploaded. Filtering runs in the browser (`web/src/core/review/filters.ts`).

**Review screen.** Opening a bill shows the stored photo next to the fields. The photo is the redacted copy, and it exists only for shops that opted in to storing photos; for other shops the screen says "No photo stored". Edits re-run the checks as you type.
- Approval is blocked while the `required` or `date` check fails, because an approved bill must be exportable by its date.
- If `total`, `gstin` or `taxSplit` fails, the CA can still approve after ticking "I have checked this bill against the paper copy". The tick covers only the failures listed when it was made. The failed checks are saved on the bill as `approvedWithFailedChecks`.
- The taxable value is checked too. When a bill has line items, the `total` check compares the items with the total and never looks at the stored taxable value, yet both exports use it. So the review screen also works out the taxable value the exports would use (a stored 0 counts as total minus tax) and, if taxable value plus tax is more than ₹1 away from the total or the taxable value works out negative, shows a red line "Taxable value + tax ≠ total". This is one more item that needs the paper-copy tick; it is part of the set the tick covers, and an approval with it saves `taxable` in `approvedWithFailedChecks`. The approved-bill banner shows it as "Taxable value + tax ≠ total".
- Reject needs a note of 1 to 500 characters. It is shown on the bill as a note to the client.
- An approved or rejected bill can be reopened; it goes back to draft. A reviewed bill cannot be edited any other way (see Rules below).
- Approve, reject, reopen and save wait for the server's answer. If one has not finished after 4 seconds, the screen shows "Still saving — waiting for the connection." and adds that the change is kept on this computer and will be sent when the connection is back. Signing out first waits up to 5 seconds for such changes to be sent; if they are not sent, the app asks "Stay signed in" or "Sign out anyway", because signing out wipes this browser's offline copy and anything still queued is then lost. The code is written so that offline saves wait like this; this has not been tried offline. If the write fails, the screen shows an error and keeps the CA's edits. If the CA leaves the bill before a pending approve or reject finishes, the write still goes through when the connection returns, but the app does not jump to another page when it does.
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

**Business Health Report.** The export panel has a "Business Health Report" link that opens a one-page report for the shop and the panel's date range (`/shops/<id>/report?from=…&to=…`; without dates it covers the last six calendar months up to the current month). It uses the same bills as the export: approved bills by invoice date, both ends included, read from the server only, so it needs a connection. It shows the purchase value and bill count for each month, the top 5 suppliers (grouped by GSTIN when it is valid, otherwise by name) with their share, CGST, SGST, IGST, taxable value and total purchases, and how many bills were approved, how many of those after the paper-copy tick, and how many dated bills are not approved and left out. The CA prints it, or saves it as a PDF, with the browser's print dialog. It says "Prepared on <date> from bills approved by" the CA (or "the shop's accountant" when the CA's profile has no name), not "Verified by CA", and a "Round-off and differences" row appears in the GST table only when taxable value plus GST does not add up to total purchases, and its footer says the figures come from bills recorded in HisaabCheck and are not an audited statement. Reports are not stored, and the shop owner cannot download them. It has been viewed only against the local emulators, in headless Chrome, where a six-month report printed on one A4 page.

## Remote Config keys

Defaults are in `web/src/core/config/defaults.ts` and `firebase/remoteconfig.template.json`. If Remote Config cannot be fetched, the defaults are used.

| Key | Default | Meaning |
|---|---|---|
| `routing_mode` | `smart` | `smart`: device first, cloud on failure. `device_only`: never use the cloud. `cloud_only`: skip the device. |
| `confidence_threshold` | `0.8` | A device read scoring below this escalates. |
| `consent_ocr_threshold` | `0.6` | OCR word confidence (as a fraction of 100) below which a number-like word makes the shield "unsure". |
| `total_tolerance_inr` | `1` | Allowed difference in rupees for the total check. |
| `max_device_line_items` | `10` | Limit on line items asked for in the on-device prompt. |
| `cloud_model` | `gemini-3.5-flash-lite` | Cloud model name. |
| `extraction_prompt_version` | `v1` | Recorded on each bill and route log. |
| `mask_pii` | `true` | Redact private numbers before any cloud call. On the web it is forced on in production builds, whatever Remote Config says, and can be turned off only in development builds. On Android it cannot be turned off in any build: the app ignores this key. |

## Setup

**Prerequisites**
- Node.js 20 or newer.
- A recent JDK (the emulator was run with OpenJDK 27 here), for the Firestore emulator used by the rules tests.
- Chrome with built-in AI, for the on-device path. Chrome documents these needs for Gemini Nano: 16 GB RAM or more than 4 GB VRAM, and about 22 GB free disk for the model download. Without it, the app still works through the cloud path.

**Firebase project** (the code uses the placeholder project ID `hisaabcheck-dev`):
1. Create a project and put it on the Blaze plan.
2. Pick region `asia-south1` (Mumbai) for Firestore and Storage. That is where saved bill data would live. Cloud reads go through Google's Gemini service, and the code does not control where they are processed.
3. Enable Firebase AI Logic with the Gemini Developer API.
4. Enable Google sign-in in Authentication (CAs, on the web). For the Android app also enable Phone sign-in (see "Android app").
5. Create Firestore and Storage.
6. Create Remote Config (the template in `firebase/` provides the 8 keys).
7. Set up App Check with reCAPTCHA Enterprise and register a web site key.
8. Register a web app and copy its config.

**Environment.** From `web/`, copy `.env.example` to `.env.local` (it is git-ignored) and fill in the Firebase config values and `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`. Keep `VITE_APPCHECK_DEBUG=true` for local development.

**App Check debug token.** With the debug flag on, the first page load prints a debug token in the browser console. Register that token in the Firebase console under App Check. The flag has no effect in production builds.

**Run locally:** `cd web && npm install && npm run dev`.

**Run locally without a Firebase project (emulator mode):** `cd web && npm run dev:emulators` (needs Java on the PATH). It starts the Auth, Firestore and Storage emulators with this repo's rules under the project id `demo-hisaabcheck`, then the dev server on port 5173 with `VITE_USE_EMULATORS=true`; no `.env.local` is needed. The login page then shows "Sign in as test CA" buttons, App Check is skipped, and stopping the dev server (Ctrl+C) stops the emulators. It exists only in development builds (`web/src/core/config/emulatorMode.ts`); a production build leaves it out.
Remote Config and the AI calls cannot be emulated: the app runs on the bundled config defaults, every cloud read fails and those bills are saved for manual entry. Use it to try sign-in, shops, upload, OCR, redaction, review, export and the rules; it does not replace the checks against the real Firebase project.

**Deploy.** From `firebase/`, log in with the Firebase CLI and deploy rules, indexes and Remote Config:

```
cd firebase
firebase deploy --only firestore:rules,firestore:indexes,storage,remoteconfig --project hisaabcheck-dev
```

Hosting deploys from `web/` with `npm run deploy` (it runs the build, then `firebase deploy --only hosting`). The first Storage rules deploy asks for permission to let Storage rules read Firestore (the rules check shop ownership); answer yes. For a hosted build, register the Hosting domain on the reCAPTCHA key and build with `VITE_APPCHECK_DEBUG=false`.

## Tests

Run from `web/`.

- `npm test` runs the unit and component-logic suites with Vitest: 36 files, 449 tests in the last run. They cover config parsing, GSTIN/Aadhaar checksums, shield test vectors, redaction planning, extraction parsing, the checks and score, the router (`processBill`, with fake adapters), route logs and stats, accuracy comparison and summary, the shield replayed on real Tesseract.js output for 64 generated bills, the Firebase AI adapter guards, the store adapter, the review logic (bill reader, filters, approval rules, the taxable-value check), the CSV and Tally XML export, and the rule that the automatic inference modes are not used. There are no React component tests.
- `npm run test:rules` runs the Firestore rules tests against the Firebase emulator (needs Java; two files in the last run: `firestore.rules.test.ts` with 80 tests and `storage.rules.test.ts` with 8; 88 in all). In the Firestore description below, "owner" means the CA who owns the shop. It covers owner-only reads and writes of shops and bills, the review fields (status values, approval only in the owner's own name and at server time, a note of 1 to 500 characters on every reject, including a long Devanagari note), the lock on reviewed bills (no field edit, no full overwrite, no straight approved/rejected switch; the photo path and a reopen still pass), users not being able to make themselves admin, and route logs being append-only, owner-only, free of extra keys, type-checked, server-timed and tied to a shop the writer owns. Since the Android work the same file also covers the linked shop owner (phone user): the invite and link rules (the code must belong to the shop and be under 7 days old; a CA cannot name an owner, and can only unlink by also replacing or removing the code), what an owner may create or change (unreviewed bills only, no review fields), and Android route logs. The 8 Storage tests cover who may read, add and replace a stored photo, the 3 MB and JPEG limits, and the shop's `storeImages` setting.

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

## Android app

`android/` holds the shop owner's app (Kotlin, Jetpack Compose, package `com.hisaabcheck.app`). The owner signs in with a phone number and an SMS code, accepts a consent statement (its own wording and version string, `2026-11-v2-owner`, separate from the web's), and links to the CA's shop by typing an 8-character invite code. After that the owner photographs a bill or picks one from the gallery. The app reads it on the phone when the phone supports on-device AI, and otherwise (or when the on-device read fails its checks) blacks out private numbers on a copy of the image, shows that copy for the owner to send or keep, and only then sends it to the cloud model. The result screen shows the fields and checks and lets the owner correct them. Bills and counts-only route logs go to the same Firestore shop as the web app, so they show up in the CA's inbox and on the dashboard. Photos are stored only if the CA's shop has "store images" on, and only the redacted copy. The home screen lists the shop's recent bills, and for a bill the CA rejected it shows the CA's rejection note.

**What has and has not been checked.** The Android app compiles and assembles, and its Kotlin core passes its tests on the JVM. It has never been run on a phone, on an emulator, or against a real Firebase project. Everything in this section describes what the code is written to do. The runtime check list is in `docs/superpowers/2026-11-26-subproject-c-followups.md`.

**The Kotlin core.** `android/core` is a port of `web/src/core` (shield, checks, config, extraction parser, redaction planning, and the routing cascade) and imports nothing from Android or Firebase. It passes the shared test vectors the web core passes (the files in `shared/test-vectors`: 114 privacy cases and 10 bill cases), plus Kotlin ports of the web unit tests, plus 5,701 extra comparison cases generated by running the TypeScript core on a wide set of inputs (shield 2,343; parse 1,558; config 600; checks 1,200; about 4.3 MB of JSON; the generator and its output are under `android/core/src/test/`). A committed manifest of SHA-256 hashes of the TypeScript sources and the generator makes the tests fail when the comparison cases are out of date, and changing those sources re-runs the tests. The last run had 329 tests in 17 files, 0 failures, 0 errors, 0 skipped. The comparison data shows that the Kotlin core agrees with the TypeScript core on those generated inputs, on the JVM. It does not show agreement on a device: Android's regex and text engines differ from the JVM's, and the core was written to avoid the constructs that differ, but that has not been tested on Android.

**On-device AI on Android** works only on recent phones: at the time of writing the Galaxy S25 and S26 families and the Pixel 9, 10 and 11. A Galaxy S23 or S23+ is not supported. On any other phone every bill takes the redact-then-cloud path, with the same preview. The app does not use the SDK's automatic modes; as on the web, the device adapter is on-device only and the cloud adapter is cloud only, and a test fails `./gw :core:test` if the automatic mode names appear in any Kotlin source. Masking cannot be turned off on Android in any build (another test in `:core:test` guards this), and each save stores its photo under a new name. Only the newest save attempt for a bill can link its photo to the bill: after "Retry cloud", an earlier attempt's upload that finishes late is not linked, and if the newest upload fails the bill has no photo rather than an earlier one.

**Build requirements.** JDK 21 and the Android SDK platform package `android-37.1` (the Compose version used needs `compileSdk` 37.1). On this Mac:

```
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"
cd android
./gw :core:test
./gw :app:assembleDebug
```

`android/gw` runs `./gradlew` with one build at a time (the lock is `android/.gradle/gw.lock`) and adds `--console=plain` itself. The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. Without `android/app/google-services.json` the project still builds, and the app shows "Firebase is not set up. Add google-services.json and rebuild." and nothing else.

**Firebase setup the owner of the project must do** (none of it has been done or tried here):
1. In the Firebase project, add an Android app with package name `com.hisaabcheck.app`. Give it the SHA-1 and SHA-256 of the debug keystore, which exists only after a first debug build: `"$JAVA_HOME/bin/keytool" -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`
2. Download `google-services.json` into `android/app/`. It is git-ignored; never commit it. (`android/app/google-services.json.example` shows the shape; it has fake values and is only for checking the build.)
3. In Authentication, enable the Phone provider and add a test phone number with a fixed code, so no real SMS is needed.
4. Google's documentation says App Check is enforced for Firebase AI Logic, so the cloud path would fail until the app's token is registered; this has not been confirmed here. Run a debug build, read the App Check debug token from Logcat (according to the Firebase SDK's documentation it prints a line containing "debug secret"; not seen here), and register it under App Check in the Firebase console.
5. Deploy the rules from `firebase/` (the command is in "Deploy" above). The Android app depends on the new Firestore and Storage rules.
6. Enforcing App Check for Firestore and Storage is a console setting, not part of the rules, and has not been turned on.

**Invite codes.** The CA opens the shop list on the web and presses "Invite owner" (or "New code") on a shop; an 8-character code appears. The code works for 7 days and for one owner: once it has been used or has expired, the owner sees "This code has already been used or is more than 7 days old" and the CA makes a new one. The owner opens the app, signs in with their phone number, accepts the consent statement, types the code, and lands on the home screen of that shop. A CA can unlink an owner only by replacing or removing the shop's invite code at the same time, so an old code can never link again. The web app has no unlink button yet.

**What the owner cannot do.** An owner can create bills and edit bills that are still draft or manual entry. Approving, rejecting, reopening and deleting a bill are the CA's, and a bill the CA has reviewed can no longer be changed from the phone.

## Status

**State of the project** (measured 2026-11-27 on head `e09f353`):
- Built: web upload and routing; the CA inbox, review and export (CSV, Tally XML); the Business Health Report (print to PDF from the browser); the Android owner app.
- Verified, and how: web unit tests (36 files, 449 tests); Firestore and Storage rules tests on the emulator (88 tests); Kotlin core tests on the JVM (329 tests); a run of the web app against local emulators in headless Chrome; the shield on 64 computer-generated bill images read by Tesseract.js (see "Privacy design"); the Android debug APK assembling, with and without `google-services.json`, and `:app:compileReleaseKotlin`; the web production build and lint (0 errors, 1 warning).
- Never done: a real Firebase project; a cloud read or an on-device AI read; running the Android app on a phone or an emulator; photographs of real bills through either app; importing the Tally XML into Tally; deployment.


Implemented: Google sign-in and consent screen; client shops; bill upload with the full routing cascade; the on-device and cloud adapters; the privacy shield, redaction and consent preview; result screen with checks, editing and manual entry; saving bills and route logs; the routing dashboard; Remote Config; Firestore and Storage rules with a Firestore rules test suite; the accuracy and leak-check tool; the bill inbox with filters; the review screen (approve, approve after the paper-copy tick, reject with a note, reopen); CSV and Tally XML export of approved bills; the Business Health Report (printed to PDF from the browser); Firestore rules for the review fields; the invite-code flow for linking a shop owner; the Android app (phone sign-in, consent, link, capture, the full routing cascade in Kotlin, preview, result and editing, saving bills and route logs) with its Kotlin core and its Firestore and Storage rules, compiled and tested on the JVM only (see "Android app").

**Not yet verified against a real Firebase project:** nothing has been run against one. The web app has been run only against the local emulators (emulator mode) in headless Chrome; the first such run found a bank-account number that the redaction let through, which was then fixed. That run used the emulators only: the cloud read and the on-device AI have never been exercised. The shield has been tested on test vectors and on 64 computer-generated bill images (see "Privacy design" for the figures and what they do not show). Tesseract OCR and the shield have not been tried on photographs of real bills. There are no component tests; see `docs/superpowers/2026-11-26-subproject-b-followups.md` for the check list. Still unverified: the Tally XML in a real Tally, sign-in with Google, saving to the real Firestore, the on-device read, the cloud read, the dashboard with live data, the Storage rules (including the image upload), App Check, and the Hosting deploy. Also unverified: a live Remote Config fetch, deployment of the Firestore composite index, App Check enforcement for AI Logic, and the persistent offline cache. The unit tests use fake adapters. The rules tests run on the emulator, not on the deployed rules.

**Android, not verified:** running on any phone or emulator; real Firebase (phone sign-in, App Check, Firestore, Storage, AI Logic); the camera and gallery flow; ML Kit text reading (the shield test above used Tesseract.js, not ML Kit) and the on-device model; bill photos of any kind; the Kotlin core on Android's own regex and text engines. The details are in `docs/superpowers/2026-11-26-subproject-c-followups.md`.

**Measured accuracy:** not yet measured. To be filled in from the 40-bill run.

`CLOUD_COST_PER_CALL_USD` in `web/src/core/config/defaults.ts` is an estimate, to be replaced by a measured value. No speed, cost-saving or on-device-share figures have been measured yet.

## Roadmap

Not in this version:
- A cross-shop inbox, an "exported" mark on bills, and editable line items on the review screen.
- Android: running and testing it on real phones; an offline queue beyond what the Firestore SDK's cache gives; a CA-side unlink button; an iOS app.
- A delete-my-data flow.

## License

Apache License 2.0. See `LICENSE`.
