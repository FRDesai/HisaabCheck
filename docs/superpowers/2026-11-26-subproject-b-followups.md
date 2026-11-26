# Sub-project B: runtime checks and follow-ups

State at 2026-11-26, branch `feat/subproject-b`, head `925cd02` (later fix commits may follow it).
Verified here: 294 unit tests in 29 files, 22 Firestore rules tests (emulator, 1 file), production build, lint (0 errors, 1 old warning in `adapters/firebaseAi.ts`).
Not verified: anything against a real Firebase project or in Chrome. Nothing in sub-project B has been rendered in a browser, and the repo has no React component tests. The Tally XML has never been imported into a real Tally. Nothing is deployed.

## Check first against real Firebase and Chrome (in this order)

1. **Inbox.** Open a shop with bills. Do the filters and counts match what you expect? Does "Load older bills" appear at 300 bills and add more?
2. **To-review count on the client list.** It uses an aggregate query; check it works under the real rules and shows the right number.
3. **Review screen photo.** The stored photo loads through a Storage download URL under App Check. A shop without stored photos shows "No photo stored".
4. **Decisions.** Approve; approve with the tick box; reject with a note; reopen. Open a second browser tab on the same bill and check it shows the change live. Check the "Still saving" notice by going offline.
5. **Deployed rules.** Try to approve a bill in another user's name from the console. It must be refused.
6. **CSV.** Open it in Excel and Google Sheets. Check ₹ amounts and Indian names. A supplier name starting with `=` must show as text.
7. **Tally.** Import the ledgers file, then the vouchers file, into a test company. Check one voucher by hand (ledgers, amounts, date, round-off).
8. **Speed.** Time the review of one bill against the PRD target (under 20 seconds).

Rules tests need Java on PATH: `PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:rules` (in `web/`).

## Decisions made during the build

- Approval is blocked only by `required` and `date`. A failed `total`, `gstin` or `taxSplit` can be approved after the paper-copy tick, and the failures are saved on the bill.
- Approve, reject, reopen and save wait for the server's answer, so the saved state is never guessed. Offline they hang; after 4 seconds a notice says so.
- Bills more than ₹1 out of balance are left out of the Tally files but kept in the CSV.

## Known gaps (small, deferred)

- Approve, reject and save wait for the server, so they hang offline.
- Line items are read-only on the review screen.
- No cross-shop inbox.
- No "exported" mark, so exporting a range twice imports twice.
- The export loads every bill in the range in one query.
- The export panel has no retry button after a failed load (changing a date retries).
- The to-review count on the client list is loaded once per page load and can be stale.
- The Firestore rule lets an owner flip a rejected bill to approved while keeping the old review time.
- Review fields on draft bills are not validated by the rules.
- The bill reader accepts an unknown route reason string.
- A negative amount in the CSV would be written as text.
- A bill with tax equal to its total produces a zero-amount purchase line in the Tally file.
- `updateBillFields` (upload result screen) and `saveReviewFields` (review screen) are near-duplicates.
