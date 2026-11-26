# Sub-project D: Business Health Report

Date: 2026-11-27 · Requirement: `PRD1.md` FR-19, Journey 3 (US-7) · Scope approved by the product owner on 2026-11-27.

## 1. Scope

A one-page report a CA prints to PDF from the browser for one client shop and one invoice-date range.

- Entry: a "Business Health Report" link in the export panel of the shop's inbox, carrying the panel's From and To dates. Route `/shops/:shopId/report?from=YYYY-MM-DD&to=YYYY-MM-DD`. Without both dates the report uses the default range: six whole calendar months, the last of them being the current IST month.
- Data: the same selection as the export. One server-only read (`fetchBillsByInvoiceDate`), then `exportable` (approved, valid invoice date, both ends included) and `notApprovedInRange`. Amounts in whole paise through `billAmounts`, so a stored taxable value of 0 is derived as total minus tax, as in the exports.
- Page content: header (shop name, GSTIN, period, "Prepared from bills approved by <CA name> on <today, IST>"; never "Verified by CA"); monthly purchases (every month in the range, empty months as zero, value and bill count as text, a CSS bar); top 5 suppliers; GST paid; bill counts; a plain footer note (figures from purchase bills recorded in HisaabCheck for the period; not an audited statement).
- A "Print / Save as PDF" button (`window.print()`) and print rules: A4 portrait, app navigation and the button hidden, black on white, rows not split across pages.

**Out of scope:** storing reports, a `reports` collection, rule changes, an owner-facing download, a "CA approves the report" step, new npm dependencies, chart libraries, Android.

## 2. Pure module: `web/src/core/report/report.ts`

No React or Firebase imports.

- `defaultReportRange(now: Date): { from, to }`: first day of the IST month five months before `now`'s IST month, to the last day of `now`'s IST month.
- `parseReportRange(from: string | null, to: string | null, now: Date)`: both missing gives the default; otherwise both must be real `YYYY-MM-DD` dates with from <= to and at most `MAX_REPORT_MONTHS` (24) calendar months, else `{ ok: false, message }`.
- `buildReport(bills: BillDoc[], from, to): ReportModel`:
  - `months: { month: 'YYYY-MM', label, bills, totalPaise, barPct }[]`, one per calendar month touched by the range, `barPct` 0..100 relative to the largest month.
  - `suppliers` (top 5) and `supplierCount`: `{ key, name, gstin, bills, totalPaise, sharePermille }`. Grouped by GSTIN when `isValidGstin` (after trim and upper-casing), else by the name trimmed, inner spaces collapsed, lower-cased. Shown name and GSTIN come from the first bill in export order. Order: total desc, bills desc, name, key. Share is in tenths of a percent, 0 when the grand total is 0 (never NaN).
  - `tax: { cgstPaise, sgstPaise, igstPaise, gstPaise, taxablePaise, totalPaise }`.
  - `counts: { approved, approvedAfterPaperCheck, notApproved }`; a paper check is a non-empty `approvedWithFailedChecks`.
- Formatting helpers: `formatRupees(paise)` (lakh/crore grouping: the whole-rupee part is an integer passed to `toLocaleString('en-IN')`, paise appended as two digits, so no float is ever formatted), `formatShare(permille)`, `formatLongDate(iso)`, `monthLabel(month)`.

## 3. Screen: `web/src/features/report/ReportPage.tsx`

Inside the signed-in layout. Reads the shop (`useShop`), the CA name (`useAuth().profile.name`, falling back to the account's display name or email), and the bills. States: invalid or reversed dates (alert, link back to the inbox); shop not found (alert); loading (status); load error (alert: the report needs a connection, the read is server-only; "Try again" button); loaded (the report, or "No approved bills in this period." when there are none). Headings in order (h1, then h2 per section), tables with captions and `scope` on headers, bars marked `role="img"` with a text label, the figures also in the table cells.

Print rules live in `web/src/index.css` under `@media print`.

## 4. Tests (written first): `web/tests/core/report.test.ts`

Empty input; empty months shown as zero; range edges (first and last day in, outside out); unapproved bills left out but counted; paise arithmetic (0.1 + 0.2, 1.005); derived taxable; supplier grouping by GSTIN and by name (case, spacing); more than five suppliers; ties; shares summing to about 100% and 0 with no purchases; a range over a year boundary; the default range at IST month boundaries; an approved bill with an invalid date; rupee formatting with lakh and crore grouping.

## 5. Not verified

Viewed only against the local emulators, in headless Chrome. Not checked against the real Firebase project, other browsers' print dialogs, or by a bank.
