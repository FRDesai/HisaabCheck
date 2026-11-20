# Sub-project A: runtime checks and follow-ups

State at 2026-11-20, branch `feat/subproject-a`, head `1bf704b`.
Verified here: 211 unit tests, 14 Firestore rules tests (emulator), production build.
Not verified: anything against a real Firebase project or in Chrome. Nothing is deployed.

## Check first against real Firebase and Chrome (in this order)

1. **Redaction on real photos.** In the 40-bill run, look at every redacted image yourself and note each bill's real private numbers separately from what the shield found. Include one rotated and one dim photo. Count how often the "OCR read too little" preview and the "Possible ID number" hiding fire.
2. **On-device read.** Does a cold Gemini Nano read finish inside the 8 s timeout (else every bill shows `device_timeout`)? Is `inferenceSource` set to on-device (else every read becomes `device_error`)? Does Chrome accept the text + image input options?
3. **App Check.** With reCAPTCHA Enterprise and the debug token: AI Logic, Firestore, Storage, Remote Config under enforcement. Watch the first sign-in (user doc create) and consent.
4. **Cloud call.** Does `gemini-3.1-flash-lite` exist on the Gemini Developer API with JSON output? An error shows as `cloud_error`.
5. **Rules deploy.** Firestore rules and the composite index (the CA dashboard query fails until the index is built). Storage rules need the grant that lets them read Firestore. Check a photo upload and the `imagePath` update.
6. **Tesseract.** Loads from the CDN; first-run time; word boxes line up with the painted image.
7. **Remote Config.** Deploy the template, fetch under App Check, flip `routing_mode` live.
8. **Hosting.** `public: ../web/dist` deploys; the auth domain and the reCAPTCHA key cover the hosted URL.

Rules tests need Java on PATH: `PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:rules` (in `web/`).

## Decisions made during the build that differ from the PRD or the plan

- Aadhaar-shaped numbers failing the checksum, near-PAN and look-alike mobile numbers are hidden as "Possible ID number" (the spec required a valid checksum). Over-hiding is harmless; a miss is a leak.
- The preview also opens when OCR reads fewer than 15 words or with low confidence.
- A label is paired only with a value of its own kind that follows it with no digit-bearing word in between; otherwise the preview opens.
- An unusable cloud answer is treated as a cloud failure (manual entry, retry), so "read in cloud" always means a usable read.
- "GSTIN state matches place of supply" is implemented as tax-split consistency.
- Missing amounts in a model answer default to 0 (a zero total fails the check).
- Storage uploads require the shop's opt-in in the rules; route-log rules check types, server time and shop ownership.

## Deferred items (full ledger below)

# SDD ledger — plan: docs/superpowers/plans/2026-11-20-subproject-a-web-core.md
Task 1: minor (deferred): scaffold deps keep ^ ranges (not exact-pinned)
Task 1: minor (deferred): tests/ not in any tsconfig include (not type-checked by tsc -b)
Task 1: minor (deferred): index.html title still "Vite + React + TS"; web/README.md boilerplate
Task 1: complete (commits eb1837f..edf5f5e, review clean)
Task 2: minor (deferred): gstinCheckChar has no input guard (returns undefined on bad input; isValidGstin guards via SHAPE)
Task 2: minor (deferred): no direct test of GSTIN_PATTERN word boundaries (shield vectors in Task 3 cover it indirectly)
Task 2: minor (deferred): no Verhoeff test for empty/non-digit input
Task 2: complete (commits edf5f5e..fc23c30, review clean)
Task 3: fix round 1/5 (3 addressed, 0 open — label/type pairing, label list drift + grouped bank numbers, mobile formats; commits adab12a..b003c8d). NOTE: shield.ts deviates from plan text by design (spec governs).
Task 3: minor (deferred): "low confidence digits" vector passes via label rule, never exercises low_ocr_confidence path
Task 3: minor (deferred): buildLines sparse-array holes / negative line index words never scanned (use Map or Array.from)
Task 3: minor (deferred): hyphenated Aadhaar / split PAN caught only via label or low confidence
Task 3: minor (deferred): ordinary words ("Pan Masala", "Contact us") trigger label rule -> frequent previews; measure on 40 bills
Task 3: minor (deferred): labels "Acc. Number", "ACC#" match no label -> unlabelled grouped account number neither matched nor flagged
Task 3: minor (deferred): BANK regex can swallow adjacent digit runs on labelled line (over-redaction only)
Task 3: complete (commits fc23c30..b003c8d, review clean after 1 fix round)
Task 4: minor (deferred): no tests for right/bottom clamp, custom pad, multi-line match
Task 4: minor (deferred): empty wordIndexes match would yield Infinity box (shield never produces one; no guard)
Task 4: complete (commits b003c8d..58eba07, review clean)
Task 5: fix round 1/5 (3 addressed, 0 open — items non-object throw, "/-" amounts, null itemCount; commits 4a90ac4..5045315)
Task 5: parked — "missing/unparseable numbers silently become 0" (plan-mandated) — ruling: kept; total 0 fails the hard total check (total > 0 required) so it escalates; rejecting whole answer would discard good fields. Residual risk: unreadable tax amount == real zero. User informed, may overrule.
Task 5: minor (deferred): first-{ to last-} slice fails on prose with braces; trailing-comma regex also rewrites inside string values
Task 5: minor (deferred): Number() accepts "0x10"/"1e3"; itemCount "" -> 0
Task 5: minor (deferred): no test for unknown prompt version fallback / cloud "blacked out" text
Task 5: complete (commits 58eba07..5045315, 1 parked)
Task 6: fix round 1/5 (1 addressed, 0 open — date check uses IST calendar date; commits 7b77f01..03af3ab)
Task 6: minor (deferred): NaN confidence -> NaN score -> no escalation (parser clamps confidence, so unreachable today; consider !(score >= threshold))
Task 6: minor (deferred): float edge at exact ₹1 tolerance; round diff to 2 decimals
Task 6: minor (deferred): no vectors for negative amounts (credit notes), empty items [], tolerance boundary
Task 6: minor (deferred): taxSplit accepts all-zero tax on inter-state bills; leap-day lower bound one day tight
Task 6: complete (commits 5045315..03af3ab, review clean after 1 fix round)
Task 7: fix round 1/5 (2 addressed, 0 open — collaborator throws return an outcome (new Reason redact_error); fail-closed raw-blob identity guard; commits 2095f72..596893a). NOTE for Task 12: ResultPanel REASON map needs a redact_error entry.
Task 7: minor (deferred): cloud_error reported as path device but with cloud cost + redactedImage; cloud invalid_json overwrites escalation reason and keeps device extraction under path cloud; no test for cloud invalid_json
Task 7: minor (deferred): device timeout does not cancel the on-device read (no AbortSignal)
Task 7: minor (deferred): maskPii=false sends raw blob (dev-only by parseConfig); no test covers the branch
Task 7: minor (deferred): no-prefer/core-purity guard can pass vacuously (no files>0 assertion), misses side-effect imports and @firebase/*
Task 7: minor (deferred): missing tests — low_confidence path, OCR failure on no_device_model/cloud_only paths
Task 7: complete (commits 03af3ab..596893a, review clean after 1 fix round)
DECISION (user, 2026-11-20): keep building Tasks 8-13 without Java/Firebase login/.env.local; rules tests, deploys and in-browser checks are UNVERIFIED until setup — track them.
Task 8: fix round 1/5 (1 addressed, 0 open — storage writes require shop storeImages opt-in; commits d9b234e..52e2b8d)
Task 8: UNVERIFIED: firestore rules tests never executed (no Java); storage rules untested; nothing deployed (rules, indexes, remote config); cross-service firestore.get needs IAM grant on first deploy; hosting public ../web/dist outside firebase/ dir
Task 8: minor (deferred): routeLog create does not check createdAt == request.time or ownsShop(shopId) (CA can backdate / mis-attribute own logs)
Task 8: minor (deferred): shop delete orphans bills + storage images
Task 8: minor (deferred): rules tests lack positive cases (own shop create/update, bill+log batch, role self-update to admin, orderBy/limit query); afterAll env.cleanup() should be env?.cleanup(); no storage emulator tests
Task 8: complete (commits 596893a..52e2b8d, review clean after 1 fix round; execution unverified)
Task 8: VERIFIED 2026-11-20: firestore rules tests executed on emulator — 5/5 pass (Java = Homebrew openjdk 27, keg-only: run with PATH=/opt/homebrew/opt/openjdk/bin:$PATH). Still unverified: storage rules, deploys.
Task 8: minor (deferred): rules test output noisy (expected PERMISSION_DENIED logged to stderr)
Task 9: fix round 1/5 (3 addressed, 0 open — device adapter fails closed without LanguageModel + inferenceSource backstop + tests; text in expectedInputs; App Check debug flag gated on !PROD; commits 903683a..0b0fd58)
Task 9: UNVERIFIED AT RUNTIME: everything against real Firebase/Chrome — notably whether `inferenceSource` is populated on genuine on-device responses (if undefined, every device read is rejected -> device_error), whether Chrome accepts the DEVICE_OPTS, App Check, downloadprogress fraction, tesseract chunking
Task 9: minor (deferred): extract could also require LanguageModel.availability()==='available' (first review verified SDK throws UNSUPPORTED, no cloud fallback, when adapter exists but model unavailable in only-on-device mode — so preventive check is belt-and-braces)
Task 9: minor (deferred): ImageBitmap never closed (canvasPainter, imageResize); failed tesseract worker init cached forever; PNG transparency -> black in JPEG; App Check init with undefined site key gives late async failures
Task 9: minor (deferred): tesseract loads worker/core/traineddata from jsDelivr CDN (no image data leaves, but third-party dependency + breaks first-run offline demo) — self-host
Task 9: minor (deferred): main bundle ~1 MB (firebase) — code-split
Task 9: complete (commits 52e2b8d..0b0fd58, review clean after 1 fix round; runtime unverified)
Task 10: fix round 1/5 (3 addressed, 0 open — n/a instead of 0% + failed count; per-bill error rows, leak line green only when all checked; skipped/unmatched listing; pure summary.ts with tests; commits 95c85fa..18241bb)
Task 10: UNVERIFIED AT RUNTIME: page never rendered; Step 5 (40 real bills, prompt lock, measured accuracy, PII-left count) still open — needs user's Firebase config + Nano-capable Chrome
Task 10: minor (deferred): error text shown in table/CSV (parseExtraction swallows JSON errors, so bill content unlikely, but prefer fixed categories); device n/a label wrong when model available but all calls failed; piiMasked 0 on error rows; green/amber/red decision lives in page not pure module; unused _selection param in summarize
Task 10: minor (deferred): leak check is circular (same shield) — README must say "no detectable private number survived"; empty reads score zero-truth fields as correct (slight overstatement)
Task 10: complete (commits 0b0fd58..18241bb, review clean after 1 fix round; runtime unverified)
Task 11: fix round 1/5 (4 addressed + extras, 0 open — bill saved before photo (SavedBill {billId, synced, photo}), separate best-effort route log, no consent loop / consentAt preserved, auth error state; commits 410ccef..b56c940). NOTE for Task 12: consume SavedBill; show Will sync/Saved/Not saved + photo status.
Task 11: UNVERIFIED AT RUNTIME: sign-in, consent, shops, all Firestore/Storage writes against real project/rules
Task 11: minor (deferred): orphan image if bill write later rejected; offline "I agree" stays on Saving…; offline Add shop button stays disabled until ack; server-rejected user-doc create not surfaced
Task 11: minor (deferred): consent withdrawal is "sign out and ask us" (spec: easy to withdraw) — in-app withdraw + consentWithdrawnAt in a later sub-project; consent enforced client-side only (rules don't check consentVersion); any Google account becomes role ca (no allow-list)
Task 11: minor (deferred): no error callbacks on watchShops/watchRouteLogs; "Loading…" lacks role=status
Task 11: complete (commits 18241bb..b56c940, review clean after 1 fix round; runtime unverified)
Task 12: fix round 1/5 (3 addressed + extras, 0 open — Retry save reusing billId; string-backed result fields via pure fields.ts; StrictMode-safe object URLs; shop load error state; commits e1bb0ad..8489a88)
Task 12: UNVERIFIED AT RUNTIME: the six manual checks (device pass, cloud_only, consent send/keep, device_only kill switch, offline retry, edit+save), dialog focus/Escape, pointer drawing, sync status texts
Task 12: minor (deferred, FIX CANDIDATE): save retry writes a second routeLogs doc for the same bill -> dashboard double count; fix by using billId as the route-log doc id (rules deny the second write as an update) or skipping the log on retry
Task 12: minor (deferred): save retry re-writes original result (edits made meanwhile overwritten); inputs not disabled while saving; cascade "Retry cloud" creates a second bill doc (plan-accepted for A) and drops edits
Task 12: minor (deferred): leaving the page drops queued bills with no warning; a bill awaiting consent on unmount is saved as user_kept_local though the user never chose
Task 12: minor (deferred): keyboard users can only black out the bottom third (spec asked for adding a box by selecting a detected OCR word); pump keeps the shop it started with (storeImages toggle mid-queue); Save re-checks with default config not live Remote Config; shop snapshot error state needs reload; memory grows with large batches; clampBox unused; "1,2,3" parses as 123
Task 12: complete (commits b56c940..8489a88, review clean after 1 fix round; runtime unverified)
Task 13: fix round 1/5 (5 addressed + extras, 0 open — PII counted only when sent (estCostUsd>0); router: unparsable cloud answer -> device/cloud_error/manual_entry so path cloud == usable cloud read (also resolves Task 7 minor); three reconciling tiles; ROUTE_LOG_LIMIT disclosed; softened "0" caption; loading/error states; commits b6f47bd..f8d0967)
Task 13: UNVERIFIED AT RUNTIME: dashboard never rendered (5-tile grid layout unseen); live updates; mode refresh
Task 13: minor (deferred): "Loading…" forever if profile never gets a role; estCostUsd>0 used as proxy for "sent" (breaks if cost constant set to 0); "0 raw private numbers" tile is a design claim not computed data — README must cite the real leak-check run
Task 13: complete (commits 8489a88..f8d0967, review clean after 1 fix round; runtime unverified)
Task 14: fix round 1/5 (4 addressed, 0 open — README overclaims corrected; commits 035ff1c..449d156)
Task 14: SKIPPED by user decision: Steps 2-4 (production App Check, deploy, hosted smoke test); no remote, nothing pushed
Task 14: minor (deferred): README summary sentence omits cloud_only mode; Node 20+/hardware figures not derived from repo
Task 14: minor (deferred, CODE): if runShield/planRedaction throws, processBill rejects instead of saving redact_error manual entry (UI pump catches it, but the bill is not saved)
Task 14: complete (commits f8d0967..449d156, review clean after 1 fix round)
ALL 14 TASKS COMPLETE. Final whole-branch review dispatched (base eb1837f, head 449d156).
FINAL REVIEW (opus) done on eb1837f..449d156: verdict "With fixes". C1 (OCR sees nothing -> unredacted image to cloud), I1 (shield near-misses), I2 (route-log rules poisoning), I3 (Retry cloud duplicates bill), I4 (accuracy tool sends unsure bills), I5 (maskPii off labels raw as redacted), I6 (vacuous guard tests) + small items. Parked Task 5 ruling upheld.
FINAL FIX WAVE dispatched (single fixer, opus), FIX_BASE=449d156, report -> final-fix-report.md. Next: ONE scoped re-review of 449d156..HEAD, then adjudicate residuals, then finishing-a-development-branch.
FINAL FIX WAVE done: commits 449d156..0415b4f (cd4f8fc, d14a38e, e280857, 0415b4f); 195 unit + 14 rules tests.
SCOPED RE-REVIEW (opus): C1, I1-I6, small items all ADDRESSED. ONE Important residual introduced by the wave: shield decision (b) — any POSSIBLE_ID satisfies PAN/Aadhaar/Phone labels -> missed value + unrelated near-miss = no preview (regression vs base). Load-bearing privacy issue; user asked to continue with fixes -> follow-up fix dispatched to same fixer (FIX_BASE2=0415b4f): near-miss satisfies only own label kind + "nothing suspicious in between"; billJob comment; recordConsent merge fields.
Residual minors (deferred): unlabelled 12-digit runs (e-way bill nos, 4-4-4 numeric rows) hidden as POSSIBLE_ID — may black out fields the cloud should read; measure on 40 bills. GSTIN+phone joined in one OCR word never matched (pre-existing). Photo from first run stays in Storage after retry.
