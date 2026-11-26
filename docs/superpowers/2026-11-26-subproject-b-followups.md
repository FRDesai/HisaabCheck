# Sub-project B: runtime checks and follow-ups

State at 2026-11-26, branch `feat/subproject-b`, after the final review fixes (head `743a781` plus this docs commit).
Verified here: 310 unit tests in 29 files, 32 Firestore rules tests (emulator, 1 file), production build, lint (0 errors, 1 old warning in `adapters/firebaseAi.ts`).
Not verified: anything against a real Firebase project or in Chrome. Nothing in sub-project B has been rendered in a browser, and the repo has no React component tests. The Tally XML has never been imported into a real Tally. Nothing is deployed.

## Check first against real Firebase and Chrome (in this order)

1. **Inbox.** Open a shop with bills. Do the filters and counts match what you expect? Does "Load older bills" appear at 300 bills and add more?
2. **To-review count on the client list.** It uses an aggregate query; check it works under the real rules and shows the right number.
3. **Review screen photo.** The stored photo loads through a Storage download URL under App Check. A shop without stored photos shows "No photo stored".
4. **Decisions.** Approve; approve with the tick box; reject with a note; reopen. Open a second browser tab on the same bill and check it shows the change live. Check the "Still saving" notice by going offline. While a decision is still saving offline, go back to the bills list and open another bill; when the connection returns the app must stay where you are.
5. **Locked reviewed bill.** Upload a bill whose cloud read fails (manual entry, "Retry cloud" shown). Approve it in another tab, then click "Retry cloud" on the upload page. The save must be refused and the bill must stay approved.
6. **Taxable value.** On a bill with line items, set the taxable value so it does not add up with tax to the total. The red line "Taxable value + tax ≠ total" and the tick box must appear; approve with the tick and check the approved banner shows the same text.
7. **Deployed rules.** Try to approve a bill in another user's name from the console. It must be refused.
8. **CSV.** Open it in Excel and Google Sheets. Check ₹ amounts and Indian names. A supplier name starting with `=` must show as text. Offline, the export panel must say it needs a connection and offer no download.
9. **Tally.** Import the ledgers file, then the vouchers file, into a test company. Check one voucher by hand (ledgers, amounts, date, round-off).
10. **Speed.** Time the review of one bill against the PRD target (under 20 seconds).

Rules tests need Java on PATH: `PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:rules` (in `web/`).

## Decisions made during the build

- Approval is blocked only by `required` and `date`. A failed `total`, `gstin` or `taxSplit` can be approved after the paper-copy tick, and the failures are saved on the bill.
- Approve, reject, reopen and save wait for the server's answer, so the saved state is never guessed. Offline they hang; after 4 seconds a notice says so.
- Bills more than ₹1 out of balance, with a negative tax component, or without a valid invoice date are left out of the Tally files but kept in the CSV.
- A reviewed bill is locked by the rules: only the photo path or a reopen may change it.
- A taxable value that does not add up needs the paper-copy tick, because the `total` check uses line items when a bill has them. `core/checks/checks.ts` is unchanged (its meaning is shared with the later Android port).
- The CSV taxable value is the one Tally books: a stored 0 is written as total minus tax.
- Export reads from the server only, so it needs a connection.

## Known gaps (small, deferred)

- Approve, reject and save wait for the server, so they hang offline.
- Line items are read-only on the review screen.
- No cross-shop inbox.
- No "exported" mark, so exporting a range twice imports twice.
- The export loads every bill in the range in one query.
- The export panel has no retry button after a failed load (changing a date retries).
- The to-review count on the client list is loaded once per page load and can be stale.
- Review fields on draft bills are not validated by the rules.
- The bill reader accepts an unknown route reason string.
- A negative amount in the CSV would be written as text.
- A bill with tax equal to its total produces a zero-amount purchase line in the Tally file.
- `updateBillFields` (upload result screen) and `saveReviewFields` (review screen) are near-duplicates.
- On a bill without line items, a taxable value that does not add up is listed twice for the tick ("Items + tax ≠ total" and "Taxable value + tax ≠ total").
- File names collide for non-Latin shop names (`fileSlug` gives `shop`).
- No rules tests for the three new queries (inbox list, to-review count, export range).
- Reject discards unsaved field edits without a word.
- A listener error while editing unmounts the review form with no Retry.
- The inbox notice ("All bills reviewed.") survives a page reload.
- An unknown route reason would show "undefined" in the badge.
- A new line in a supplier name is kept in XML element text but normalised in the XML attribute.
- Hand-seeded bills need `status` and `createdAt` to show in the inbox.
- No stable voucher id, so importing the same Tally file twice books the bills twice.
- Photo download URLs are bearer URLs: anyone holding one can open the photo.
