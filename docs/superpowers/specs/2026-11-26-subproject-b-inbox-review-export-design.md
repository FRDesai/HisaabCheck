# Sub-project B: CA bill inbox, review and export

Date: 2026-11-26 · Requirements: `PRD1.md` FR-16, FR-17, FR-18 (US-4, US-5, US-6) · Builds on sub-project A (`2026-11-19-subproject-a-web-core-design.md`).
Target: built and unit-tested by 27 Nov 2026, so 28–30 Nov stay free for the runtime checks, the loan report and the submission.

## 1. Scope

**In scope**

- Bill inbox per client shop, with filters: to review, failed checks, manual entry, approved, rejected, and month (FR-16).
- "To review" count beside each shop in the client list (FR-16).
- Review screen: stored photo beside editable fields, failed checks in red, approve, reject with a note, reopen, complete a manual-entry bill (FR-17).
- Export of approved bills for a date range as CSV (P0) and as Tally import XML (P1, built last) (FR-18).
- Firestore rules for the review fields, with emulator tests.

**Out of scope**

- One inbox across all shops (needs `caUid` on every bill and a collection-group index). The per-shop count covers "see where new bills are".
- Editing line items one by one. The review screen shows them read-only and can drop them (section 5).
- Marking bills as exported, Vyapar-specific format (Vyapar imports the CSV), notifications (FR-22).
- Android (C), loan report (D).

## 2. Approach

Chosen: **one live query per shop, filters applied in the browser.** The inbox listens to the newest 300 bills of the shop (ordered by `createdAt`, single-field index, nothing new to deploy) and filters them with a pure function. "Load older bills" raises the limit by 300. Export runs its own one-off query by invoice date, so it is never cut off by the inbox limit.

Rejected:

- *A server query per filter.* Scales further, but every filter + sort pair needs a composite index, and index deploys are still unverified on the real project.
- *A cross-shop collection-group inbox.* Needs a data migration and new rules; not needed for the demo.

All decisions live in pure modules under `web/src/core/` (no React, no Firebase), tested first, as in A.

## 3. Data model changes

`shops/{shopId}/bills/{billId}` gains optional fields. Existing bills stay valid.

| Field | Type | Set when |
| --- | --- | --- |
| `status` | `draft \| approved \| rejected \| manual_entry` (unchanged) | every write |
| `reviewedBy` | uid string | approve or reject |
| `reviewedAt` | server timestamp | approve or reject |
| `rejectNote` | string, 1–500 chars | reject (removed on approve and reopen) |
| `approvedWithFailedChecks` | string[] of check names | approve while checks fail (else removed) |
| `editedAt` | server timestamp (exists in A) | any field edit |

Status moves allowed in the UI: `draft` or `manual_entry` → `approved` or `rejected`; `approved` or `rejected` → `draft` (Reopen). Fields are editable only in `draft` and `manual_entry`.

**Rules** (`firebase/firestore.rules`, bills block): read and delete stay "owner of the shop". Create and update also require:

- `status` is one of the four values;
- if `status` is `approved` or `rejected`: `reviewedBy == request.auth.uid`, and `reviewedAt` is either `request.time` or unchanged from the stored bill (so a late `imagePath` update on a reviewed bill still passes);
- if `status` is `rejected`: `rejectNote` is a string of 1–500 characters.

No new composite index.

## 4. Pure core modules

```
web/src/core/review/
  billDoc.ts      toBillDoc(id, data): BillDoc — tolerant reader for a Firestore bill
                  (missing fields → '' / 0, checks may be null, timestamps → Date | null)
  filters.ts      BillFilter, filterBills(bills, filter, month), monthsOf(bills),
                  countsByFilter(bills), nextToReview(bills, currentId)
  decision.ts     allowedActions(status): which actions are allowed
                  approvalBlockers(checks), needsConfirmation(checks), failedChecks(checks)
                  validRejectNote(note)
web/src/core/export/
  rows.ts         exportable(bills, from, to): approved bills in range, sorted by date then invoice no
  csv.ts          toCsv(bills): string
  tallyXml.ts     tallyReady(bills), toTallyVouchersXml(bills, ledgers), toTallyMastersXml(bills, ledgers)
```

`BillDoc` = `{ id, extraction: Extraction, checks: Checks | null, status, route: RouteInfo | null, imagePath: string | null, createdAt: Date | null, reviewedAt: Date | null, reviewedBy: string | null, rejectNote: string, approvedWithFailedChecks: string[] }`.

**Filters**

| Filter | A bill matches when |
| --- | --- |
| `to_review` (default) | status is `draft` or `manual_entry` |
| `failed_checks` | status is `draft` or `manual_entry` and any check is false, or `checks` is null |
| `manual_entry` | status is `manual_entry` |
| `approved` / `rejected` | status equals it |
| `all` | always |

Month filter: `YYYY-MM` of `invoiceDate`. A bill with no valid invoice date falls under the month of `createdAt` (IST). "All months" is the default.

**Approval rule**

- Blocked (button disabled, reasons listed) while any input is invalid, the `required` check fails, or the `date` check fails. An approved bill must be exportable by date.
- If `total`, `gstin` or `taxSplit` still fails, the CA must tick "I have checked this bill against the paper copy". The failed check names are saved in `approvedWithFailedChecks`.
- Reject needs a note of 1–500 characters.

## 5. Screens

**Client list (`/shops`, existing).** Each shop row gets two links: "Bills" with a "N to review" count, and "Upload". The count is a Firestore count query (`status in [draft, manual_entry]`) run when the page loads; if it fails the row shows no count.

**Inbox (`/shops/:shopId/bills`, new).** Header: shop name, "Upload bills" link, export panel. Filter buttons with counts, month select. A table: invoice date, supplier, invoice no., total, read badge (on device / cloud / manual entry with reason), failed-check marks, status. A row links to the review screen. States: loading, empty ("No bills match this filter"), load error with a retry, and "Showing the newest N bills — Load older bills" when the limit is hit.

**Review (`/shops/:shopId/bills/:billId`, new).** Two columns:

- Left: the stored photo if the bill has `imagePath` (redacted copy, fetched with a Storage download URL). Otherwise: "No photo stored. This shop keeps bill data only — check against the paper bill." Photo load failure shows a short message, not a broken image.
- Right: read badge with reason, status, failed checks in red, the ten fields from A's result screen, line items as a read-only table when present, with "Ignore line items (check totals only)" which removes `items` so the total check uses taxable value + tax. Buttons: Save changes, Approve, Reject (opens the note box), Reopen (for approved and rejected bills).
- After approve or reject, the screen moves to the next bill to review in the shop (newest first); when none is left it returns to the inbox with "All bills reviewed".
- A bill that does not exist or cannot be loaded shows an error and a link back to the inbox.

The field inputs, labels and check messages now used inline in `ResultPanel.tsx` move to shared files (`features/result/labels.ts`, `features/result/FieldInputs.tsx`) and are used by both the upload result and the review screen. Behaviour of the upload result does not change.

**Export panel (in the inbox).** From and To dates (default: the selected month, else the current month), a line "N approved bills in range", buttons "Download CSV" and "Download Tally XML". Unapproved bills in the range are counted in a note ("M bills in this range are not approved and are left out"). No approved bills → buttons disabled.

Accessibility (NFR-10): labelled inputs, filter buttons with `aria-pressed`, table headers with scope, status messages with `role="status"`, errors with `role="alert"`, all actions reachable by keyboard.

## 6. Export formats

**CSV.** UTF-8 with BOM, CRLF line ends, RFC 4180 quoting. One row per bill. Columns: Invoice date, Invoice no., Supplier, Supplier GSTIN, Place of supply, Taxable value, CGST, SGST, IGST, Total, Read by (device / cloud / manual), Approved on, Bill id. Amounts with two decimals. A cell that starts with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'`, so a supplier name read from a bill cannot run as a spreadsheet formula. File name: `hisaabcheck-<shop>-<from>-to-<to>.csv`.

**Tally XML.** Two files, because Tally imports masters and vouchers separately:

- *Masters*: one ledger per distinct supplier (parent "Sundry Creditors", with GSTIN when valid), plus the purchase, tax and round-off ledgers.
- *Vouchers*: one Purchase voucher per bill, accounting mode: supplier ledger credited with the total; "Purchases" (group Purchase Accounts) debited with the taxable value; "Input CGST", "Input SGST", "Input IGST" debited when above zero; a "Round Off" entry for a gap of up to ₹1 so every voucher balances. Supplier invoice number goes in `REFERENCE`, the bill id in the narration. Dates as `YYYYMMDD`.
- A bill whose taxable value + tax differs from its total by more than ₹1 (possible when it was approved with the tick box) is left out of both Tally files and listed by invoice number in the export panel. Booking a large gap as rounding would put a wrong entry in the CA's books. Such bills are still in the CSV.

Amounts are computed in whole paise to avoid float drift. Taxable value is `taxableValue` when above zero, otherwise `total − tax`. All text is XML-escaped; characters XML 1.0 forbids are dropped. Ledger names are constants in one place (`DEFAULT_LEDGERS`).

The XML cannot be tried against a real Tally here. The README will say so, and the CA must import one test file before relying on it (PRD open question: exact Tally format).

## 7. Store adapter additions (`web/src/adapters/store.ts`)

`watchBills(shopId, max, cb, onError)`, `watchBill(shopId, billId, cb, onError)`, `countToReview(shopId)`, `fetchBillsByInvoiceDate(shopId, from, to)`, `approveBill(...)`, `rejectBill(...)`, `reopenBill(...)`, `saveReviewFields(...)` (fields + checks + optional removal of `items`), `billImageUrl(imagePath)`. Snapshots are read with `serverTimestamps: 'estimate'` so a bill written offline still sorts and shows. Each maps documents through `toBillDoc`.

## 8. Error handling

| Failure | Behaviour |
| --- | --- |
| Inbox or bill listener fails (rules, offline with empty cache) | error message with Retry; never a blank page |
| Approve, reject, reopen or save fails | message beside the buttons; the form keeps the CA's edits; buttons re-enabled |
| Bill changed elsewhere while open | live listener updates status; unsaved edits in the form are kept and a note says the bill changed |
| Count query fails | no count shown |
| Export query fails | message in the export panel; nothing downloaded |
| Bill document with missing or wrong-typed fields | `toBillDoc` fills safe defaults; the bill shows as failed checks |

## 9. Testing

- **Unit, test-first (Vitest):** `toBillDoc` (missing fields, null checks, timestamps), every filter, month fallback, counts, `nextToReview`, approval blockers, `exportable` range edges, CSV quoting and formula guard, Tally XML (balanced vouchers in paise, round-off, IGST-only, escaping, masters de-duplicated), and store functions with the mocked Firestore used in `tests/adapters/store.test.ts`.
- **Rules (emulator):** approve and reject by the owner pass; wrong `reviewedBy`, client-chosen `reviewedAt`, missing or over-long `rejectNote`, unknown status, and another CA all fail; A's existing writes (create draft, field edit, `imagePath` update) still pass.
- **Build:** `tsc -b` + `vite build`; lint.
- **Not verifiable here:** rendering in Chrome, Storage download URLs under App Check, the count query against real rules, a Tally import. They are added to the runtime check list.
