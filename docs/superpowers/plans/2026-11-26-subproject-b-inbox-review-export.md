# Sub-project B (CA Inbox, Review, Export) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CA can open a client shop's bill inbox, filter it, review each bill beside its stored photo, approve / reject / reopen it, and export approved bills for a date range as CSV and Tally XML.

**Architecture:** Every decision (reading a Firestore bill safely, filters, approval rules, export formats) is a pure TypeScript module under `web/src/core/review/` and `web/src/core/export/`, tested first. `web/src/adapters/store.ts` gains thin Firestore/Storage functions that map documents through the pure reader. Three new React features (`inbox`, `review`, `export`) call them. One live query per shop; filters run in the browser.

**Tech Stack:** React 18 + Vite 5 + TypeScript (strict), Tailwind 3, React Router 6, Vitest 2, Firebase JS SDK 12.19.0 (Firestore, Storage), Firebase emulator + `@firebase/rules-unit-testing` for rules tests. No new dependencies.

Spec: `docs/superpowers/specs/2026-11-26-subproject-b-inbox-review-export-design.md`.

## Global Constraints

- `web/src/core/**` must not import `react` or `firebase` (an existing test enforces it).
- Never use `PREFER_ON_DEVICE` / `PREFER_IN_CLOUD`; do not touch the cascade (`core/router`, `core/shield`, `core/redact`, `adapters/firebaseAi.ts`).
- No new npm dependencies. No new Firestore composite index.
- No PII values in Firestore or logs. This plan writes only review fields: `status`, `reviewedBy`, `reviewedAt`, `rejectNote`, `approvedWithFailedChecks`, `editedAt`, and the bill fields that already exist.
- Bill statuses are exactly `draft | approved | rejected | manual_entry`.
- Reject note: 1–500 characters after trimming.
- Approval is blocked while the `required` or `date` check fails; failing `total`, `gstin` or `taxSplit` needs the tick box "I have checked this bill against the paper copy".
- CSV: UTF-8 with BOM, CRLF, RFC 4180 quoting, leading `'` on cells starting with `=`, `+`, `-`, `@`, tab or CR.
- Amounts are computed in whole paise (`Math.round(n * 100)`).
- Accessibility: every input has a label; errors use `role="alert"`, status lines `role="status"`; filter buttons use `aria-pressed`.
- All commands run from `web/`. Unit tests: `npx vitest run`. Rules tests: `PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:rules`. Build: `npm run build`. Lint: `npm run lint`.
- Commit after each task. End every commit message with the line `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- The repo has no React component tests (no jsdom). UI tasks are verified by `npm run build` and `npm run lint`; say plainly in your report that nothing was rendered.

## File structure

```
web/src/core/dates.ts                    isIsoDate, istDate, istMonth, monthRange           (Task 1)
web/src/core/review/billDoc.ts           BillDoc, toBillDoc, readBy                          (Task 1)
web/src/core/review/filters.ts           BillFilter, filterBills, monthsOf, countsByFilter,
                                         nextToReview, billMonth, hasFailedCheck             (Task 1)
web/src/core/review/decision.ts          allowedActions, failedChecks, approvalBlockers,
                                         needsConfirmation, validRejectNote                  (Task 1)
web/src/core/export/rows.ts              exportable, notApprovedInRange, toPaise,
                                         paiseToText, fileSlug                               (Task 2)
web/src/core/export/csv.ts               toCsv                                               (Task 2)
web/src/core/export/tallyXml.ts          DEFAULT_LEDGERS, voucherEntries, tallyReady,
                                         toTallyVouchersXml, toTallyMastersXml, xmlText      (Task 9)
firebase/firestore.rules                 validBill()                                         (Task 3)
web/src/adapters/store.ts                watchShop, watchBills, watchBill, countToReview,
                                         fetchBillsByInvoiceDate, saveReviewFields,
                                         approveBill, rejectBill, reopenBill, billImageUrl   (Task 4)
web/src/features/result/labels.ts        REASON, CHECK_MSG, FIELDS, FIELD_CHECK,
                                         EMPTY_EXTRACTION, badgeText, badgeTone              (Task 5)
web/src/features/result/FieldInputs.tsx  FieldInputs, CheckMessages                          (Task 5)
web/src/features/result/ResultPanel.tsx  uses the two files above                            (Task 5)
web/src/features/shops/useShop.ts        useShop(shopId)                                     (Task 6)
web/src/features/inbox/InboxPage.tsx     inbox table, filters, month                         (Task 6)
web/src/features/shops/ShopsPage.tsx     Bills / Upload links, to-review count               (Task 6)
web/src/features/review/ReviewPage.tsx   loader + next-bill navigation                       (Task 7)
web/src/features/review/ReviewForm.tsx   fields, approve / reject / reopen                   (Task 7)
web/src/features/review/BillPhoto.tsx    stored redacted photo                               (Task 7)
web/src/features/export/download.ts      downloadText                                        (Task 8)
web/src/features/export/ExportPanel.tsx  date range, counts, download buttons                (Task 8, 9)
web/src/App.tsx                          two new routes                                      (Task 6, 7)
tests/billFixtures.ts                    makeBill() used by many tests                       (Task 1)
```

---

### Task 1: Review core — bill reader, filters, decisions

**Files:**
- Create: `web/src/core/dates.ts`, `web/src/core/review/billDoc.ts`, `web/src/core/review/filters.ts`, `web/src/core/review/decision.ts`
- Create: `web/tests/billFixtures.ts`, `web/tests/core/dates.test.ts`, `web/tests/core/billDoc.test.ts`, `web/tests/core/filters.test.ts`, `web/tests/core/decision.test.ts`

**Interfaces:**
- Consumes: `BillStatus`, `Checks`, `Extraction`, `LineItem`, `Reason`, `RouteInfo` from `web/src/core/types.ts`.
- Produces: everything listed under the code blocks below, with exactly these names and signatures.

- [ ] **Step 1: Write the test fixture `web/tests/billFixtures.ts`**

```ts
import type { BillDoc } from '../src/core/review/billDoc';
import type { Extraction } from '../src/core/types';

/** A passing draft bill; override any part. */
export function makeBill(id: string, over: Partial<Omit<BillDoc, 'extraction'>> & { extraction?: Partial<Extraction> } = {}): BillDoc {
  const { extraction, ...rest } = over;
  return {
    id, status: 'draft', checks: { total: true, gstin: true, taxSplit: true, date: true, required: true },
    route: { path: 'device', reason: 'passed', confidence: 0.95, promptVersion: 'v1', modelName: 'gemini-nano' },
    imagePath: null, createdAt: new Date('2026-11-10T06:00:00Z'), reviewedAt: null, reviewedBy: null, rejectNote: '', approvedWithFailedChecks: [],
    ...rest,
    extraction: { supplierName: 'Acme Traders', supplierGstin: '29ABCDE1234F1Z5', invoiceNo: `INV-${id}`, invoiceDate: '2026-11-05', placeOfSupply: '29',
      taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9, ...extraction },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`web/tests/core/dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isIsoDate, istDate, istMonth, monthRange } from '../../src/core/dates';

describe('dates', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isIsoDate('2026-11-05')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('05-11-2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
  it('gives the IST calendar date and month', () => {
    expect(istDate(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11-01'); // 00:30 IST next day
    expect(istMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11');
    expect(istDate(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10-31');
  });
  it('gives the first and last day of a month', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
```

`web/tests/core/billDoc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readBy, toBillDoc } from '../../src/core/review/billDoc';

const ts = (iso: string) => ({ toDate: () => new Date(iso) });
const full = {
  supplierName: 'Acme Traders', supplierGstin: '29ABCDE1234F1Z5', invoiceNo: 'A-1', invoiceDate: '2026-11-05', placeOfSupply: '29',
  items: [{ description: 'Rice', hsn: '1006', qty: 2, rate: 50, amount: 100 }], itemCount: 1,
  taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9,
  checks: { total: true, gstin: true, taxSplit: false, date: true, required: true }, status: 'approved',
  route: { path: 'device', reason: 'passed', confidence: 0.97, promptVersion: 'v1', modelName: 'gemini-nano' },
  imagePath: 'shops/s1/bills/b1.jpg', createdAt: ts('2026-11-06T10:00:00Z'), reviewedAt: ts('2026-11-07T10:00:00Z'), reviewedBy: 'alice',
  approvedWithFailedChecks: ['taxSplit'],
};

describe('toBillDoc', () => {
  it('maps a complete bill', () => {
    const b = toBillDoc('b1', full);
    expect(b.id).toBe('b1');
    expect(b.extraction).toEqual({ supplierName: 'Acme Traders', supplierGstin: '29ABCDE1234F1Z5', invoiceNo: 'A-1', invoiceDate: '2026-11-05',
      placeOfSupply: '29', taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9,
      items: [{ description: 'Rice', hsn: '1006', qty: 2, rate: 50, amount: 100 }], itemCount: 1 });
    expect(b.checks).toEqual({ total: true, gstin: true, taxSplit: false, date: true, required: true });
    expect(b.status).toBe('approved');
    expect(b.route).toEqual(full.route);
    expect(b.imagePath).toBe('shops/s1/bills/b1.jpg');
    expect(b.createdAt).toEqual(new Date('2026-11-06T10:00:00Z'));
    expect(b.reviewedAt).toEqual(new Date('2026-11-07T10:00:00Z'));
    expect(b.reviewedBy).toBe('alice');
    expect(b.approvedWithFailedChecks).toEqual(['taxSplit']);
  });
  it('fills safe defaults for an empty document', () => {
    const b = toBillDoc('x', {});
    expect(b.extraction).toEqual({ supplierName: '', supplierGstin: '', invoiceNo: '', invoiceDate: '', placeOfSupply: '',
      taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0, confidence: 0 });
    expect('items' in b.extraction).toBe(false);
    expect('itemCount' in b.extraction).toBe(false);
    expect(b).toMatchObject({ checks: null, status: 'draft', route: null, imagePath: null, createdAt: null, reviewedAt: null,
      reviewedBy: null, rejectNote: '', approvedWithFailedChecks: [] });
  });
  it('ignores wrong-typed fields', () => {
    const b = toBillDoc('x', { supplierName: 5, total: '118', cgst: NaN, items: 'none', checks: 'yes', status: 'paid', route: { path: 'fax' },
      imagePath: 7, createdAt: 'yesterday', rejectNote: 9, approvedWithFailedChecks: ['total', 3], itemCount: '2' });
    expect(b.extraction.supplierName).toBe('');
    expect(b.extraction.total).toBe(0);
    expect(b.extraction.cgst).toBe(0);
    expect('items' in b.extraction).toBe(false);
    expect('itemCount' in b.extraction).toBe(false);
    expect(b).toMatchObject({ checks: null, status: 'draft', route: null, imagePath: null, createdAt: null, rejectNote: '', approvedWithFailedChecks: ['total'] });
  });
  it('treats a missing check as failed and repairs line items', () => {
    const b = toBillDoc('x', { checks: { total: true }, items: [{ description: 'A', amount: 10 }, 'junk', null] });
    expect(b.checks).toEqual({ total: true, gstin: false, taxSplit: false, date: false, required: false });
    expect(b.extraction.items).toEqual([{ description: 'A', hsn: '', qty: 0, rate: 0, amount: 10 }]);
  });
  it('accepts Date values and rejects invalid ones', () => {
    expect(toBillDoc('x', { createdAt: new Date('2026-11-06T10:00:00Z') }).createdAt).toEqual(new Date('2026-11-06T10:00:00Z'));
    expect(toBillDoc('x', { createdAt: new Date('nope') }).createdAt).toBeNull();
    expect(toBillDoc('x', { createdAt: { toDate: () => 'x' } }).createdAt).toBeNull();
  });
});

describe('readBy', () => {
  it('names who read the bill', () => {
    expect(readBy({ path: 'device', reason: 'passed', confidence: 1, promptVersion: 'v1', modelName: 'm' })).toBe('device');
    expect(readBy({ path: 'cloud', reason: 'total_mismatch', confidence: 1, promptVersion: 'v1', modelName: 'm' })).toBe('cloud');
    expect(readBy({ path: 'device', reason: 'cloud_error', confidence: 0, promptVersion: 'v1', modelName: 'm' })).toBe('manual');
    expect(readBy(null)).toBe('manual');
  });
});
```

`web/tests/core/filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { billMonth, countsByFilter, filterBills, hasFailedCheck, monthsOf, nextToReview } from '../../src/core/review/filters';
import { makeBill } from '../billFixtures';

const failing = { total: false, gstin: true, taxSplit: true, date: true, required: true };
const bills = [
  makeBill('d1'),                                                                 // draft, passing, Nov
  makeBill('d2', { checks: failing }),                                             // draft, failed check, Nov
  makeBill('m1', { status: 'manual_entry', checks: null, extraction: { invoiceDate: '' }, createdAt: new Date('2026-10-31T19:00:00Z') }), // IST 1 Nov
  makeBill('a1', { status: 'approved', extraction: { invoiceDate: '2026-10-20' } }),
  makeBill('a2', { status: 'approved', checks: failing }),
  makeBill('r1', { status: 'rejected', rejectNote: 'blurred', extraction: { invoiceDate: '2026-10-02' } }),
];
const ids = (b: { id: string }[]) => b.map((x) => x.id);

describe('filterBills', () => {
  it('to_review = draft and manual entry', () => expect(ids(filterBills(bills, 'to_review', null))).toEqual(['d1', 'd2', 'm1']));
  it('failed_checks = open bills with a failed or missing check', () => expect(ids(filterBills(bills, 'failed_checks', null))).toEqual(['d2', 'm1']));
  it('manual_entry', () => expect(ids(filterBills(bills, 'manual_entry', null))).toEqual(['m1']));
  it('approved and rejected', () => {
    expect(ids(filterBills(bills, 'approved', null))).toEqual(['a1', 'a2']);
    expect(ids(filterBills(bills, 'rejected', null))).toEqual(['r1']);
  });
  it('all keeps the given order', () => expect(ids(filterBills(bills, 'all', null))).toEqual(['d1', 'd2', 'm1', 'a1', 'a2', 'r1']));
  it('month narrows by invoice month', () => {
    expect(ids(filterBills(bills, 'all', '2026-10'))).toEqual(['a1', 'r1']);
    expect(ids(filterBills(bills, 'approved', '2026-11'))).toEqual(['a2']);
  });
});

describe('billMonth', () => {
  it('uses the invoice date when valid', () => expect(billMonth(makeBill('x'))).toBe('2026-11'));
  it('falls back to the IST month the bill was created', () => expect(billMonth(bills[2])).toBe('2026-11'));
  it('is null with neither', () => expect(billMonth(makeBill('x', { extraction: { invoiceDate: '31/12' }, createdAt: null }))).toBeNull());
});

describe('monthsOf', () => {
  it('lists distinct months, newest first', () => expect(monthsOf(bills)).toEqual(['2026-11', '2026-10']));
  it('is empty for no bills', () => expect(monthsOf([])).toEqual([]));
});

describe('countsByFilter', () => {
  it('counts every filter', () => expect(countsByFilter(bills, null)).toEqual({ to_review: 3, failed_checks: 2, manual_entry: 1, approved: 2, rejected: 1, all: 6 }));
  it('respects the month', () => expect(countsByFilter(bills, '2026-10')).toEqual({ to_review: 0, failed_checks: 0, manual_entry: 0, approved: 1, rejected: 1, all: 2 }));
});

describe('hasFailedCheck', () => {
  it('is true for null checks or any false check', () => {
    expect(hasFailedCheck(makeBill('x'))).toBe(false);
    expect(hasFailedCheck(makeBill('x', { checks: null }))).toBe(true);
    expect(hasFailedCheck(makeBill('x', { checks: failing }))).toBe(true);
  });
});

describe('nextToReview', () => {
  it('picks the next open bill after the current one', () => expect(nextToReview(bills, 'd1')).toBe('d2'));
  it('skips reviewed bills', () => expect(nextToReview(bills, 'd2')).toBe('m1'));
  it('wraps to an earlier open bill', () => expect(nextToReview(bills, 'm1')).toBe('d1'));
  it('never returns the current bill', () => expect(nextToReview([makeBill('only')], 'only')).toBeNull());
  it('starts from the top when the current bill is not in the list', () => expect(nextToReview(bills, 'zzz')).toBe('d1'));
  it('is null when nothing is open', () => expect(nextToReview([bills[3], bills[5]], 'a1')).toBeNull());
});
```

`web/tests/core/decision.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { allowedActions, approvalBlockers, failedChecks, needsConfirmation, validRejectNote } from '../../src/core/review/decision';

const ok = { total: true, gstin: true, taxSplit: true, date: true, required: true };

describe('allowedActions', () => {
  it('open bills can be edited, approved, rejected', () => {
    expect(allowedActions('draft')).toEqual(['edit', 'approve', 'reject']);
    expect(allowedActions('manual_entry')).toEqual(['edit', 'approve', 'reject']);
  });
  it('reviewed bills can only be reopened', () => {
    expect(allowedActions('approved')).toEqual(['reopen']);
    expect(allowedActions('rejected')).toEqual(['reopen']);
  });
});

describe('failedChecks', () => {
  it('lists failed checks in a fixed order', () => expect(failedChecks({ ...ok, date: false, total: false })).toEqual(['total', 'date']));
  it('treats missing checks as all failed', () => expect(failedChecks(null)).toEqual(['total', 'gstin', 'taxSplit', 'date', 'required']));
  it('is empty when all pass', () => expect(failedChecks(ok)).toEqual([]));
});

describe('approvalBlockers', () => {
  it('blocks on required and date only', () => {
    expect(approvalBlockers(ok)).toEqual([]);
    expect(approvalBlockers({ ...ok, total: false, gstin: false, taxSplit: false })).toEqual([]);
    expect(approvalBlockers({ ...ok, required: false })).toEqual(['required']);
    expect(approvalBlockers({ ...ok, date: false, required: false })).toEqual(['date', 'required']);
    expect(approvalBlockers(null)).toEqual(['date', 'required']);
  });
});

describe('needsConfirmation', () => {
  it('lists failed total, gstin, taxSplit', () => {
    expect(needsConfirmation(ok)).toEqual([]);
    expect(needsConfirmation({ ...ok, gstin: false, taxSplit: false, date: false })).toEqual(['gstin', 'taxSplit']);
    expect(needsConfirmation(null)).toEqual(['total', 'gstin', 'taxSplit']);
  });
});

describe('validRejectNote', () => {
  it('needs 1 to 500 characters after trimming', () => {
    expect(validRejectNote('')).toBe(false);
    expect(validRejectNote('   ')).toBe(false);
    expect(validRejectNote('Photo is blurred')).toBe(true);
    expect(validRejectNote('x'.repeat(500))).toBe(true);
    expect(validRejectNote('x'.repeat(501))).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run tests/core/dates.test.ts tests/core/billDoc.test.ts tests/core/filters.test.ts tests/core/decision.test.ts`
Expected: FAIL — the four modules cannot be resolved.

- [ ] **Step 4: Implement**

`web/src/core/dates.ts`:

```ts
const IST_OFFSET_MS = 5.5 * 3600e3;

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/** IST calendar date (YYYY-MM-DD) of an instant. */
export const istDate = (at: Date): string => new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
/** IST calendar month (YYYY-MM) of an instant. */
export const istMonth = (at: Date): string => istDate(at).slice(0, 7);

/** First and last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
```

`web/src/core/review/billDoc.ts`:

```ts
import type { BillStatus, Checks, Extraction, LineItem, PathTaken, Reason, RouteInfo } from '../types';

/** A bill as the review and export screens use it. Built only by toBillDoc, so every field has a safe value. */
export interface BillDoc {
  id: string; extraction: Extraction; checks: Checks | null; status: BillStatus; route: RouteInfo | null;
  imagePath: string | null; createdAt: Date | null; reviewedAt: Date | null; reviewedBy: string | null;
  rejectNote: string; approvedWithFailedChecks: string[];
}

const STATUSES: readonly string[] = ['draft', 'approved', 'rejected', 'manual_entry'];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const validDate = (d: unknown): Date | null => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : null);

/** A Firestore Timestamp (anything with toDate()), or a Date. */
function toDate(v: unknown): Date | null {
  if (v instanceof Date) return validDate(v);
  const o = obj(v);
  return o && typeof o.toDate === 'function' ? validDate((o.toDate as () => unknown)()) : null;
}

function toItems(v: unknown): LineItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map(obj).filter((i): i is Record<string, unknown> => i !== null)
    .map((i) => ({ description: str(i.description), hsn: str(i.hsn), qty: num(i.qty), rate: num(i.rate), amount: num(i.amount) }));
}

function toChecks(v: unknown): Checks | null {
  const o = obj(v);
  if (!o) return null;
  return { total: o.total === true, gstin: o.gstin === true, taxSplit: o.taxSplit === true, date: o.date === true, required: o.required === true };
}

function toRoute(v: unknown): RouteInfo | null {
  const o = obj(v);
  if (!o || (o.path !== 'device' && o.path !== 'cloud') || typeof o.reason !== 'string') return null;
  return { path: o.path as PathTaken, reason: o.reason as Reason, confidence: num(o.confidence), promptVersion: str(o.promptVersion), modelName: str(o.modelName) };
}

/** Tolerant reader: a bill document with missing or wrong-typed fields still becomes a usable BillDoc. */
export function toBillDoc(id: string, data: Record<string, unknown>): BillDoc {
  const extraction: Extraction = {
    supplierName: str(data.supplierName), supplierGstin: str(data.supplierGstin), invoiceNo: str(data.invoiceNo),
    invoiceDate: str(data.invoiceDate), placeOfSupply: str(data.placeOfSupply),
    taxableValue: num(data.taxableValue), cgst: num(data.cgst), sgst: num(data.sgst), igst: num(data.igst), total: num(data.total),
    confidence: num(data.confidence),
  };
  const items = toItems(data.items);
  if (items) extraction.items = items;
  if (typeof data.itemCount === 'number' && Number.isFinite(data.itemCount)) extraction.itemCount = data.itemCount;
  return {
    id, extraction, checks: toChecks(data.checks),
    status: STATUSES.includes(data.status as string) ? (data.status as BillStatus) : 'draft',
    route: toRoute(data.route),
    imagePath: typeof data.imagePath === 'string' && data.imagePath ? data.imagePath : null,
    createdAt: toDate(data.createdAt), reviewedAt: toDate(data.reviewedAt),
    reviewedBy: typeof data.reviewedBy === 'string' ? data.reviewedBy : null,
    rejectNote: str(data.rejectNote),
    approvedWithFailedChecks: Array.isArray(data.approvedWithFailedChecks)
      ? data.approvedWithFailedChecks.filter((s): s is string => typeof s === 'string') : [],
  };
}

/** Who produced the fields: the on-device model, the cloud model, or nobody (manual entry). */
export function readBy(route: RouteInfo | null): 'device' | 'cloud' | 'manual' {
  if (!route) return 'manual';
  if (route.path === 'cloud') return 'cloud';
  return route.reason === 'passed' ? 'device' : 'manual';
}
```

`web/src/core/review/filters.ts`:

```ts
import { isIsoDate, istMonth } from '../dates';
import type { BillDoc } from './billDoc';

export type BillFilter = 'to_review' | 'failed_checks' | 'manual_entry' | 'approved' | 'rejected' | 'all';
export const BILL_FILTERS: readonly BillFilter[] = ['to_review', 'failed_checks', 'manual_entry', 'approved', 'rejected', 'all'];

const isOpen = (b: BillDoc): boolean => b.status === 'draft' || b.status === 'manual_entry';
export const hasFailedCheck = (b: BillDoc): boolean => b.checks === null || Object.values(b.checks).some((ok) => !ok);

function matches(b: BillDoc, f: BillFilter): boolean {
  switch (f) {
    case 'to_review': return isOpen(b);
    case 'failed_checks': return isOpen(b) && hasFailedCheck(b);
    case 'manual_entry': return b.status === 'manual_entry';
    case 'approved': return b.status === 'approved';
    case 'rejected': return b.status === 'rejected';
    case 'all': return true;
  }
}

/** YYYY-MM of the invoice date; a bill without a valid one falls under the IST month it was created. */
export function billMonth(b: BillDoc): string | null {
  if (isIsoDate(b.extraction.invoiceDate)) return b.extraction.invoiceDate.slice(0, 7);
  return b.createdAt ? istMonth(b.createdAt) : null;
}

/** Keeps the given order. month = null means all months. */
export function filterBills(bills: BillDoc[], filter: BillFilter, month: string | null): BillDoc[] {
  return bills.filter((b) => matches(b, filter) && (month === null || billMonth(b) === month));
}

/** Distinct months that have bills, newest first. */
export function monthsOf(bills: BillDoc[]): string[] {
  const set = new Set<string>();
  for (const b of bills) { const m = billMonth(b); if (m) set.add(m); }
  return [...set].sort().reverse();
}

export function countsByFilter(bills: BillDoc[], month: string | null): Record<BillFilter, number> {
  const out = {} as Record<BillFilter, number>;
  for (const f of BILL_FILTERS) out[f] = filterBills(bills, f, month).length;
  return out;
}

/** The next open bill after the current one in the given order, wrapping round; never the current bill. */
export function nextToReview(bills: BillDoc[], currentId: string): string | null {
  const at = bills.findIndex((b) => b.id === currentId);
  const order = at < 0 ? bills : [...bills.slice(at + 1), ...bills.slice(0, at)];
  return order.find(isOpen)?.id ?? null;
}
```

`web/src/core/review/decision.ts`:

```ts
import type { BillStatus, Checks } from '../types';

export type ReviewAction = 'edit' | 'approve' | 'reject' | 'reopen';
const CHECK_ORDER: readonly (keyof Checks)[] = ['total', 'gstin', 'taxSplit', 'date', 'required'];
export const REJECT_NOTE_MAX = 500;

export function allowedActions(status: BillStatus): ReviewAction[] {
  return status === 'draft' || status === 'manual_entry' ? ['edit', 'approve', 'reject'] : ['reopen'];
}

/** Failed checks in a fixed order. Missing checks (null) count as all failed. */
export function failedChecks(checks: Checks | null): (keyof Checks)[] {
  return CHECK_ORDER.filter((k) => !checks || !checks[k]);
}

/** Checks that must pass before a bill can be approved: an approved bill must be exportable by date. */
export function approvalBlockers(checks: Checks | null): Array<'date' | 'required'> {
  return failedChecks(checks).filter((k): k is 'date' | 'required' => k === 'date' || k === 'required');
}

/** Failed checks the CA may override by confirming the bill against the paper copy. */
export function needsConfirmation(checks: Checks | null): Array<'total' | 'gstin' | 'taxSplit'> {
  return failedChecks(checks).filter((k): k is 'total' | 'gstin' | 'taxSplit' => k === 'total' || k === 'gstin' || k === 'taxSplit');
}

export function validRejectNote(note: string): boolean {
  const n = note.trim().length;
  return n >= 1 && n <= REJECT_NOTE_MAX;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run`
Expected: all test files pass, including the existing 211 tests and the core-purity test.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/dates.ts web/src/core/review web/tests/billFixtures.ts web/tests/core/dates.test.ts web/tests/core/billDoc.test.ts web/tests/core/filters.test.ts web/tests/core/decision.test.ts
git commit -m "feat(core): bill reader, inbox filters and review decisions"
```

---

### Task 2: Export core — rows and CSV

**Files:**
- Create: `web/src/core/export/rows.ts`, `web/src/core/export/csv.ts`
- Create: `web/tests/core/exportRows.test.ts`, `web/tests/core/csv.test.ts`

**Interfaces:**
- Consumes: `BillDoc`, `readBy` from `web/src/core/review/billDoc.ts`; `isIsoDate`, `istDate` from `web/src/core/dates.ts`; `makeBill` from `web/tests/billFixtures.ts`.
- Produces: `exportable(bills, from, to): BillDoc[]`, `notApprovedInRange(bills, from, to): number`, `toPaise(n): number`, `paiseToText(p): string`, `fileSlug(s): string`, `toCsv(bills): string`, `CSV_HEADER`.

- [ ] **Step 1: Write the failing tests**

`web/tests/core/exportRows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { exportable, fileSlug, notApprovedInRange, paiseToText, toPaise } from '../../src/core/export/rows';
import { makeBill } from '../billFixtures';

const ap = (id: string, invoiceDate: string, invoiceNo = `INV-${id}`) => makeBill(id, { status: 'approved', extraction: { invoiceDate, invoiceNo } });
const bills = [
  ap('c', '2026-11-30'), ap('a', '2026-11-01'), ap('b2', '2026-11-15', 'B-2'), ap('b1', '2026-11-15', 'B-1'),
  ap('early', '2026-10-31'), ap('late', '2026-12-01'), ap('nodate', ''),
  makeBill('draft', { extraction: { invoiceDate: '2026-11-10' } }),
  makeBill('rej', { status: 'rejected', extraction: { invoiceDate: '2026-11-11' } }),
  makeBill('man', { status: 'manual_entry', extraction: { invoiceDate: '2026-12-25' } }),
];

describe('exportable', () => {
  it('keeps approved bills inside the range, both ends included, sorted by date then invoice number', () => {
    expect(exportable(bills, '2026-11-01', '2026-11-30').map((b) => b.id)).toEqual(['a', 'b1', 'b2', 'c']);
  });
  it('leaves out approved bills without a valid date', () => {
    expect(exportable(bills, '0000-01-01', '9999-12-31').map((b) => b.id)).not.toContain('nodate');
  });
  it('is empty when from is after to', () => expect(exportable(bills, '2026-11-30', '2026-11-01')).toEqual([]));
  it('breaks a full tie by bill id', () => {
    const tie = [ap('z', '2026-11-05', 'X'), ap('y', '2026-11-05', 'X')];
    expect(exportable(tie, '2026-11-01', '2026-11-30').map((b) => b.id)).toEqual(['y', 'z']);
  });
});

describe('notApprovedInRange', () => {
  it('counts draft, manual-entry and rejected bills dated inside the range', () => {
    expect(notApprovedInRange(bills, '2026-11-01', '2026-11-30')).toBe(2);
    expect(notApprovedInRange(bills, '2026-12-01', '2026-12-31')).toBe(1);
  });
});

describe('paise', () => {
  it('rounds rupees to whole paise', () => {
    expect(toPaise(118)).toBe(11800);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(1.005)).toBe(100); // float 1.005 is just under; documented, not corrected
    expect(toPaise(99.999)).toBe(10000);
  });
  it('prints paise with two decimals', () => {
    expect(paiseToText(11800)).toBe('118.00');
    expect(paiseToText(5)).toBe('0.05');
    expect(paiseToText(0)).toBe('0.00');
    expect(paiseToText(-1250)).toBe('-12.50');
  });
});

describe('fileSlug', () => {
  it('makes a safe file-name part', () => {
    expect(fileSlug('Ramesh Kirana & Sons')).toBe('ramesh-kirana-sons');
    expect(fileSlug('  ../../etc  ')).toBe('etc');
    expect(fileSlug('दुकान')).toBe('shop');
    expect(fileSlug('')).toBe('shop');
  });
});
```

`web/tests/core/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CSV_HEADER, toCsv } from '../../src/core/export/csv';
import { makeBill } from '../billFixtures';

const lines = (csv: string) => csv.slice(1).split('\r\n');

describe('toCsv', () => {
  it('starts with a BOM, uses CRLF and ends with a line break', () => {
    const csv = toCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`﻿${CSV_HEADER.join(',')}\r\n`);
  });
  it('writes one row per bill with two-decimal amounts', () => {
    const b = makeBill('b1', { status: 'approved', reviewedAt: new Date('2026-11-07T20:00:00Z') });
    expect(lines(toCsv([b]))[1]).toBe('2026-11-05,INV-b1,Acme Traders,29ABCDE1234F1Z5,29,100.00,9.00,9.00,0.00,118.00,device,2026-11-08,b1');
  });
  it('leaves Approved on empty when unknown and names cloud and manual reads', () => {
    const cloud = makeBill('c', { route: { path: 'cloud', reason: 'total_mismatch', confidence: 1, promptVersion: 'v1', modelName: 'm' } });
    const manual = makeBill('m', { route: null });
    const rows = lines(toCsv([cloud, manual]));
    expect(rows[1].split(',').slice(-3)).toEqual(['cloud', '', 'c']);
    expect(rows[2].split(',').slice(-3)).toEqual(['manual', '', 'm']);
  });
  it('quotes commas, quotes and line breaks', () => {
    const b = makeBill('q', { extraction: { supplierName: 'Shah, "Bros"\nTraders' } });
    expect(toCsv([b])).toContain('"Shah, ""Bros""\nTraders"');
  });
  it('defuses spreadsheet formulas', () => {
    for (const bad of ['=HYPERLINK("http://x")', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      const row = toCsv([makeBill('f', { extraction: { supplierName: bad, invoiceNo: 'N' } })]);
      expect(row).toContain(`'${bad.replace(/"/g, '""')}`);
    }
    // an ordinary name is left alone
    expect(toCsv([makeBill('p', { extraction: { supplierName: 'A-1 Stores' } })])).toContain(',A-1 Stores,');
  });
  it('has thirteen columns in every row', () => {
    const rows = lines(toCsv([makeBill('a'), makeBill('b')])).filter(Boolean);
    expect(CSV_HEADER).toHaveLength(13);
    for (const r of rows) expect(r.split(',')).toHaveLength(13);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/core/exportRows.test.ts tests/core/csv.test.ts`
Expected: FAIL — modules cannot be resolved.

- [ ] **Step 3: Implement**

`web/src/core/export/rows.ts`:

```ts
import { isIsoDate } from '../dates';
import type { BillDoc } from '../review/billDoc';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const inRange = (b: BillDoc, from: string, to: string): boolean =>
  isIsoDate(b.extraction.invoiceDate) && b.extraction.invoiceDate >= from && b.extraction.invoiceDate <= to;

/** Approved bills dated from..to (both included), sorted by invoice date, then invoice number, then bill id. */
export function exportable(bills: BillDoc[], from: string, to: string): BillDoc[] {
  return bills.filter((b) => b.status === 'approved' && inRange(b, from, to))
    .sort((a, b) => cmp(a.extraction.invoiceDate, b.extraction.invoiceDate) || cmp(a.extraction.invoiceNo, b.extraction.invoiceNo) || cmp(a.id, b.id));
}

/** Bills dated in the range that are left out of an export because they are not approved. */
export function notApprovedInRange(bills: BillDoc[], from: string, to: string): number {
  return bills.filter((b) => b.status !== 'approved' && inRange(b, from, to)).length;
}

/** Rupees to whole paise. All export arithmetic is done in paise. */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);

export function paiseToText(paise: number): string {
  const abs = Math.abs(paise);
  return `${paise < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** A shop name as a safe part of a file name. */
export function fileSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'shop';
}
```

`web/src/core/export/csv.ts`:

```ts
import { istDate } from '../dates';
import { readBy, type BillDoc } from '../review/billDoc';
import { paiseToText, toPaise } from './rows';

export const CSV_HEADER = ['Invoice date', 'Invoice no.', 'Supplier', 'Supplier GSTIN', 'Place of supply', 'Taxable value',
  'CGST', 'SGST', 'IGST', 'Total', 'Read by', 'Approved on', 'Bill id'] as const;

/** RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would run as a formula. */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const money = (n: number): string => paiseToText(toPaise(n));

/** One row per bill, in the order given. UTF-8 BOM so Excel reads ₹ and Indian names correctly. */
export function toCsv(bills: BillDoc[]): string {
  const rows = bills.map((b) => {
    const e = b.extraction;
    return [e.invoiceDate, e.invoiceNo, e.supplierName, e.supplierGstin, e.placeOfSupply,
      money(e.taxableValue), money(e.cgst), money(e.sgst), money(e.igst), money(e.total),
      readBy(b.route), b.reviewedAt ? istDate(b.reviewedAt) : '', b.id];
  });
  return `﻿${[[...CSV_HEADER], ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run`
Expected: PASS. If the `toPaise(1.005)` expectation fails on this machine, read the actual value and keep the test honest: the point of that line is to document float behaviour, not to hide it.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/export web/tests/core/exportRows.test.ts web/tests/core/csv.test.ts
git commit -m "feat(core): export row selection and CSV with formula guard"
```

---

### Task 3: Firestore rules for review fields

**Files:**
- Modify: `firebase/firestore.rules` (the `match /bills/{billId}` block inside `match /shops/{shopId}`)
- Modify: `web/tests/rules/firestore.rules.test.ts` (seed one more bill; add one `describe` block)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: rules that Task 4's writes satisfy. Approve/reject writes carry `status`, `reviewedBy` (the signed-in uid) and `reviewedAt` (server timestamp); reject also carries `rejectNote` (1–500 chars); reopen sets `status: 'draft'` and deletes the three review fields.

- [ ] **Step 1: Write the failing tests**

In `web/tests/rules/firestore.rules.test.ts`, add `deleteField` to the `firebase/firestore` import. In `beforeEach`, inside `withSecurityRulesDisabled`, add:

```ts
    await setDoc(doc(c.firestore(), 'shops/s1/bills/d1'), { status: 'draft', total: 118 });
```

Append this block at the end of the file:

```ts
describe('bill review rules', () => {
  const d1 = (uid: string) => doc(as(uid), 'shops/s1/bills/d1');
  const approve = (uid: string) => ({ status: 'approved', reviewedBy: uid, reviewedAt: serverTimestamp() });

  it('the owner approves a bill', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
  });
  it('another CA cannot approve it', async () => {
    await assertFails(updateDoc(d1('bob'), approve('bob')));
  });
  it('refuses approval in someone else\'s name, without a time, or with a client-chosen time', async () => {
    await assertFails(updateDoc(d1('alice'), { ...approve('alice'), reviewedBy: 'bob' }));
    await assertFails(updateDoc(d1('alice'), { status: 'approved', reviewedBy: 'alice' }));
    await assertFails(updateDoc(d1('alice'), { status: 'approved', reviewedBy: 'alice', reviewedAt: new Date('2020-01-01') }));
  });
  it('a reject needs a note of 1 to 500 characters', async () => {
    const reject = { status: 'rejected', reviewedBy: 'alice', reviewedAt: serverTimestamp() };
    await assertFails(updateDoc(d1('alice'), reject));
    await assertFails(updateDoc(d1('alice'), { ...reject, rejectNote: '' }));
    await assertFails(updateDoc(d1('alice'), { ...reject, rejectNote: 'x'.repeat(501) }));
    await assertFails(updateDoc(d1('alice'), { ...reject, rejectNote: 5 }));
    await assertSucceeds(updateDoc(d1('alice'), { ...reject, rejectNote: 'Photo is blurred, please send again' }));
  });
  it('refuses an unknown or missing status', async () => {
    await assertFails(updateDoc(d1('alice'), { status: 'paid' }));
    await assertFails(setDoc(doc(as('alice'), 'shops/s1/bills/n1'), { total: 1 }));
  });
  it('a reviewed bill accepts a later update that leaves the review time alone', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertSucceeds(updateDoc(d1('alice'), { imagePath: 'shops/s1/bills/d1.jpg' }));
    await assertFails(updateDoc(d1('alice'), { reviewedAt: new Date('2020-01-01') }));
  });
  it('the owner reopens a reviewed bill', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertSucceeds(updateDoc(d1('alice'), { status: 'draft', reviewedBy: deleteField(), reviewedAt: deleteField(), rejectNote: deleteField(), approvedWithFailedChecks: deleteField() }));
  });
  it('sub-project A writes still pass: create, field edit, photo path', async () => {
    const b = doc(as('alice'), 'shops/s1/bills/a1');
    await assertSucceeds(setDoc(b, { total: 118, status: 'manual_entry', checks: null, createdAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(b, { total: 120, checks: { total: true }, editedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(b, { imagePath: 'shops/s1/bills/a1.jpg' }));
  });
});
```

- [ ] **Step 2: Run the rules tests and confirm the new ones fail**

Run: `PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:rules`
Expected: the old 14 pass; several new ones FAIL (for example "refuses approval in someone else's name" and "a reject needs a note", because today's rule allows any write by the owner).

- [ ] **Step 3: Change the rules**

In `firebase/firestore.rules`, add this function next to `ownsShop` (top level of the `documents` match):

```
    // Review fields: a fixed status set; approve/reject only in the reviewer's own name and at server time
    // (or with the stored review time left untouched); a reject always carries a note.
    function validBill(d) {
      return d.status in ['draft', 'approved', 'rejected', 'manual_entry']
        && (!(d.status in ['approved', 'rejected'])
            || (d.reviewedBy == uid()
                && (d.reviewedAt == request.time
                    || (resource != null && 'reviewedAt' in resource.data && d.reviewedAt == resource.data.reviewedAt))))
        && (d.status != 'rejected'
            || (d.rejectNote is string && d.rejectNote.size() >= 1 && d.rejectNote.size() <= 500));
    }
```

Replace the bills block:

```
      match /bills/{billId} {
        allow read, delete: if ownsShop(shopId);
        allow create, update: if ownsShop(shopId) && validBill(request.resource.data);
      }
```

- [ ] **Step 4: Run the rules tests and confirm they all pass**

Run: `PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:rules`
Expected: 22 tests pass (14 old + 8 new). If the emulator cannot start (no Java, port 8080 busy), stop and report it as BLOCKED with the exact error; do not mark the task done on unexecuted tests.

- [ ] **Step 5: Commit**

```bash
git add firebase/firestore.rules web/tests/rules/firestore.rules.test.ts
git commit -m "feat(rules): validate bill status and review fields"
```

---

### Task 4: Store adapter — bills, review writes, photo URL

**Files:**
- Modify: `web/src/adapters/store.ts` (imports; append new functions at the end)
- Create: `web/tests/adapters/storeReview.test.ts`

**Interfaces:**
- Consumes: `toBillDoc`, `BillDoc` from `web/src/core/review/billDoc.ts`; existing `Shop` type and `db`, `storage`.
- Produces (all exported from `web/src/adapters/store.ts`):
  - `BILL_PAGE = 300`
  - `watchShop(shopId: string, cb: (shop: Shop | null) => void, onError: (e: Error) => void): () => void`
  - `watchBills(shopId: string, max: number, cb: (bills: BillDoc[]) => void, onError: (e: Error) => void): () => void`
  - `watchBill(shopId: string, billId: string, cb: (bill: BillDoc | null) => void, onError: (e: Error) => void): () => void`
  - `countToReview(shopId: string): Promise<number>`
  - `fetchBillsByInvoiceDate(shopId: string, from: string, to: string): Promise<BillDoc[]>`
  - `saveReviewFields(shopId: string, billId: string, e: Extraction, checks: Checks): Promise<void>`
  - `approveBill(shopId: string, billId: string, uid: string, e: Extraction, checks: Checks, failed: string[]): Promise<void>`
  - `rejectBill(shopId: string, billId: string, uid: string, note: string): Promise<void>`
  - `reopenBill(shopId: string, billId: string): Promise<void>`
  - `billImageUrl(imagePath: string): Promise<string>`

- [ ] **Step 1: Write the failing test `web/tests/adapters/storeReview.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Checks, Extraction } from '../../src/core/types';

const m = vi.hoisted(() => ({
  updateDoc: vi.fn(), onSnapshot: vi.fn(), getDocs: vi.fn(), getCountFromServer: vi.fn(), getDownloadURL: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  doc: (_db: unknown, ...p: string[]) => ({ id: p[p.length - 1], path: p.join('/') }),
  query: (base: { path: string }, ...parts: unknown[]) => ({ path: base.path, parts }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: string, dir = 'asc') => ({ orderBy: [field, dir] }),
  limit: (n: number) => ({ limit: n }),
  deleteField: () => 'DEL', serverTimestamp: () => 'TS',
  updateDoc: m.updateDoc, onSnapshot: m.onSnapshot, getDocs: m.getDocs, getCountFromServer: m.getCountFromServer,
  addDoc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ ref: (_s: unknown, path: string) => ({ path }), uploadBytes: vi.fn(), getDownloadURL: m.getDownloadURL }));

import { BILL_PAGE, approveBill, billImageUrl, countToReview, fetchBillsByInvoiceDate, rejectBill, reopenBill, saveReviewFields,
  watchBill, watchBills, watchShop } from '../../src/adapters/store';

const e: Extraction = { supplierName: 'Acme', supplierGstin: 'G', invoiceNo: '1', invoiceDate: '2026-11-05', placeOfSupply: '29',
  taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9 };
const checks: Checks = { total: true, gstin: false, taxSplit: true, date: true, required: true };
const snapDoc = (id: string, data: Record<string, unknown>) => ({ id, exists: () => true, data: vi.fn(() => data) });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.updateDoc.mockResolvedValue(undefined);
});

describe('review writes', () => {
  it('approveBill writes the fields, checks and review stamp in one update', async () => {
    await approveBill('s1', 'b1', 'alice', e, checks, ['gstin']);
    const [ref, data] = m.updateDoc.mock.calls[0];
    expect(ref.path).toBe('shops/s1/bills/b1');
    expect(data).toEqual({ ...e, items: 'DEL', checks, status: 'approved', reviewedBy: 'alice', reviewedAt: 'TS',
      rejectNote: 'DEL', approvedWithFailedChecks: ['gstin'], editedAt: 'TS' });
  });
  it('approveBill removes approvedWithFailedChecks when nothing failed and keeps line items', async () => {
    const items = [{ description: 'Rice', hsn: '1006', qty: 1, rate: 100, amount: 100 }];
    await approveBill('s1', 'b1', 'alice', { ...e, items, itemCount: 1 }, checks, []);
    const data = m.updateDoc.mock.calls[0][1];
    expect(data.approvedWithFailedChecks).toBe('DEL');
    expect(data.items).toEqual(items);
    expect(data.itemCount).toBe(1);
  });
  it('rejectBill trims the note and clears approval marks', async () => {
    await rejectBill('s1', 'b1', 'alice', '  Photo is blurred  ');
    expect(m.updateDoc.mock.calls[0][1]).toEqual({ status: 'rejected', reviewedBy: 'alice', reviewedAt: 'TS',
      rejectNote: 'Photo is blurred', approvedWithFailedChecks: 'DEL' });
  });
  it('reopenBill returns the bill to draft and removes every review field', async () => {
    await reopenBill('s1', 'b1');
    expect(m.updateDoc.mock.calls[0][1]).toEqual({ status: 'draft', reviewedBy: 'DEL', reviewedAt: 'DEL', rejectNote: 'DEL', approvedWithFailedChecks: 'DEL' });
  });
  it('saveReviewFields writes fields and checks, never a status, and no undefined values', async () => {
    await saveReviewFields('s1', 'b1', { ...e, itemCount: undefined }, checks);
    const data = m.updateDoc.mock.calls[0][1];
    expect(data).toEqual({ ...e, items: 'DEL', checks, editedAt: 'TS' });
    expect('status' in data).toBe(false);
    expect(Object.values(data)).not.toContain(undefined);
  });
  it('passes a server refusal on to the caller', async () => {
    m.updateDoc.mockRejectedValue(new Error('denied'));
    await expect(reopenBill('s1', 'b1')).rejects.toThrow('denied');
  });
});

describe('reads', () => {
  it('watchBills listens to the newest bills and maps them', () => {
    const cb = vi.fn(); const onError = vi.fn();
    m.onSnapshot.mockReturnValue('unsub');
    expect(watchBills('s1', BILL_PAGE, cb, onError)).toBe('unsub');
    const [q, next, err] = m.onSnapshot.mock.calls[0];
    expect(q.path).toBe('shops/s1/bills');
    expect(q.parts).toEqual([{ orderBy: ['createdAt', 'desc'] }, { limit: 300 }]);
    const d = snapDoc('b1', { supplierName: 'Acme', status: 'approved' });
    next({ docs: [d] });
    expect(d.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
    expect(cb.mock.calls[0][0][0]).toMatchObject({ id: 'b1', status: 'approved', extraction: { supplierName: 'Acme' } });
    err(new Error('x'));
    expect(onError).toHaveBeenCalled();
  });
  it('watchBill gives null for a missing bill', () => {
    const cb = vi.fn();
    watchBill('s1', 'b1', cb, vi.fn());
    const [ref, next] = m.onSnapshot.mock.calls[0];
    expect(ref.path).toBe('shops/s1/bills/b1');
    next({ exists: () => false });
    expect(cb).toHaveBeenLastCalledWith(null);
    next(snapDoc('b1', { status: 'draft' }));
    expect(cb.mock.calls[1][0]).toMatchObject({ id: 'b1', status: 'draft' });
  });
  it('watchShop gives the shop with its id, or null', () => {
    const cb = vi.fn();
    watchShop('s1', cb, vi.fn());
    const [ref, next] = m.onSnapshot.mock.calls[0];
    expect(ref.path).toBe('shops/s1');
    next(snapDoc('s1', { shopName: 'A', caUid: 'alice', gstin: '', state: '', storeImages: false }));
    expect(cb).toHaveBeenLastCalledWith({ id: 's1', shopName: 'A', caUid: 'alice', gstin: '', state: '', storeImages: false });
    next({ exists: () => false });
    expect(cb).toHaveBeenLastCalledWith(null);
  });
  it('countToReview counts draft and manual-entry bills', async () => {
    m.getCountFromServer.mockResolvedValue({ data: () => ({ count: 4 }) });
    expect(await countToReview('s1')).toBe(4);
    const q = m.getCountFromServer.mock.calls[0][0];
    expect(q.path).toBe('shops/s1/bills');
    expect(q.parts).toEqual([{ where: ['status', 'in', ['draft', 'manual_entry']] }]);
  });
  it('fetchBillsByInvoiceDate queries the date range only', async () => {
    m.getDocs.mockResolvedValue({ docs: [snapDoc('b1', { invoiceDate: '2026-11-05', status: 'approved' })] });
    const out = await fetchBillsByInvoiceDate('s1', '2026-11-01', '2026-11-30');
    expect(out[0]).toMatchObject({ id: 'b1', status: 'approved' });
    expect(m.getDocs.mock.calls[0][0].parts).toEqual([{ where: ['invoiceDate', '>=', '2026-11-01'] }, { where: ['invoiceDate', '<=', '2026-11-30'] }, { orderBy: ['invoiceDate', 'asc'] }]);
  });
  it('billImageUrl asks Storage for a download URL', async () => {
    m.getDownloadURL.mockResolvedValue('https://x/y.jpg');
    expect(await billImageUrl('shops/s1/bills/b1.jpg')).toBe('https://x/y.jpg');
    expect(m.getDownloadURL.mock.calls[0][0]).toEqual({ path: 'shops/s1/bills/b1.jpg' });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/adapters/storeReview.test.ts`
Expected: FAIL — `approveBill` etc. are not exported.

- [ ] **Step 3: Implement in `web/src/adapters/store.ts`**

Change the two import lines at the top and add one:

```ts
import { addDoc, collection, deleteField, doc, getCountFromServer, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, limit } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { toBillDoc, type BillDoc } from '../core/review/billDoc';
```

Append at the end of the file:

```ts
// ---- Sub-project B: inbox, review, export ----

export const BILL_PAGE = 300;
// A bill written offline has no server time yet; 'estimate' gives the local time so it still sorts and shows.
const SNAP = { serverTimestamps: 'estimate' } as const;
const billsCol = (shopId: string) => collection(db, 'shops', shopId, 'bills');
const billRef = (shopId: string, billId: string) => doc(db, 'shops', shopId, 'bills', billId);

export function watchShop(shopId: string, cb: (shop: Shop | null) => void, onError: (e: Error) => void) {
  return onSnapshot(doc(db, 'shops', shopId),
    (s) => cb(s.exists() ? ({ id: s.id, ...(s.data() as Omit<Shop, 'id'>) }) : null), onError);
}

/** Newest bills of a shop, live. Filters run in the browser (core/review/filters). */
export function watchBills(shopId: string, max: number, cb: (bills: BillDoc[]) => void, onError: (e: Error) => void) {
  return onSnapshot(query(billsCol(shopId), orderBy('createdAt', 'desc'), limit(max)),
    (s) => cb(s.docs.map((d) => toBillDoc(d.id, d.data(SNAP)))), onError);
}

export function watchBill(shopId: string, billId: string, cb: (bill: BillDoc | null) => void, onError: (e: Error) => void) {
  return onSnapshot(billRef(shopId, billId), (s) => cb(s.exists() ? toBillDoc(s.id, s.data(SNAP)) : null), onError);
}

export async function countToReview(shopId: string): Promise<number> {
  const s = await getCountFromServer(query(billsCol(shopId), where('status', 'in', ['draft', 'manual_entry'])));
  return s.data().count;
}

/** One-off read for export: every bill dated from..to, any status. Not capped by the inbox page size. */
export async function fetchBillsByInvoiceDate(shopId: string, from: string, to: string): Promise<BillDoc[]> {
  const s = await getDocs(query(billsCol(shopId), where('invoiceDate', '>=', from), where('invoiceDate', '<=', to), orderBy('invoiceDate')));
  return s.docs.map((d) => toBillDoc(d.id, d.data(SNAP)));
}

/** Bill fields for an update: no undefined values; absent line items are removed from the stored bill. */
function billFields(e: Extraction) {
  const { items, itemCount, ...rest } = e;
  return { ...rest, items: items ?? deleteField(), ...(itemCount === undefined ? {} : { itemCount }) };
}

export const saveReviewFields = (shopId: string, billId: string, e: Extraction, checks: Checks) =>
  updateDoc(billRef(shopId, billId), { ...billFields(e), checks, editedAt: serverTimestamp() });

/** Fields and approval in one write, so what is approved is exactly what was on screen. */
export const approveBill = (shopId: string, billId: string, uid: string, e: Extraction, checks: Checks, failed: string[]) =>
  updateDoc(billRef(shopId, billId), {
    ...billFields(e), checks, status: 'approved', reviewedBy: uid, reviewedAt: serverTimestamp(), rejectNote: deleteField(),
    approvedWithFailedChecks: failed.length > 0 ? failed : deleteField(), editedAt: serverTimestamp(),
  });

export const rejectBill = (shopId: string, billId: string, uid: string, note: string) =>
  updateDoc(billRef(shopId, billId), {
    status: 'rejected', reviewedBy: uid, reviewedAt: serverTimestamp(), rejectNote: note.trim(), approvedWithFailedChecks: deleteField(),
  });

export const reopenBill = (shopId: string, billId: string) =>
  updateDoc(billRef(shopId, billId), {
    status: 'draft', reviewedBy: deleteField(), reviewedAt: deleteField(), rejectNote: deleteField(), approvedWithFailedChecks: deleteField(),
  });

/** Download URL of the stored (redacted) bill photo. Storage rules allow it only for the shop's CA. */
export const billImageUrl = (imagePath: string) => getDownloadURL(ref(storage, imagePath));
```

The existing mock in `web/tests/adapters/store.test.ts` does not define `deleteField`, `getDocs`, `getCountFromServer` or `getDownloadURL`. Add them to that file's two `vi.mock` factories so the old tests keep loading the module: in the `firebase/firestore` factory add `deleteField: vi.fn(), getDocs: vi.fn(), getCountFromServer: vi.fn(),` and in the `firebase/storage` factory add `getDownloadURL: vi.fn(),`.

- [ ] **Step 4: Run all unit tests**

Run: `npx vitest run`
Expected: PASS (old and new).

- [ ] **Step 5: Type-check and commit**

Run: `npm run build`
Expected: build succeeds.

```bash
git add web/src/adapters/store.ts web/tests/adapters/storeReview.test.ts web/tests/adapters/store.test.ts
git commit -m "feat(store): bill listeners, review writes, export read, photo URL"
```

---

### Task 5: Shared field labels and inputs

**Files:**
- Create: `web/src/features/result/labels.ts`, `web/src/features/result/FieldInputs.tsx`, `web/tests/features/labels.test.ts`
- Modify: `web/src/features/result/ResultPanel.tsx`

**Interfaces:**
- Consumes: `FieldKey` from `web/src/features/result/fields.ts`; `Checks`, `Extraction`, `Reason`, `RouteInfo` from core types.
- Produces:
  - `labels.ts`: `REASON: Record<Reason, string>`, `CHECK_MSG: Record<keyof Checks, string>`, `EMPTY_EXTRACTION: Extraction`, `FIELDS: Array<[FieldKey, string, 'text' | 'number']>`, `FIELD_CHECK: Partial<Record<FieldKey, keyof Checks>>`, `badgeText(route: Pick<RouteInfo, 'path' | 'reason'> | null): string`, `badgeTone(route: Pick<RouteInfo, 'path' | 'reason'> | null): string`
  - `FieldInputs.tsx`: default export `FieldInputs({ text, invalid, checks, disabled, onChange })`, named export `CheckMessages({ checks })`

This task moves code; the upload result screen must look and behave exactly as before.

- [ ] **Step 1: Write the failing test `web/tests/features/labels.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { badgeText, badgeTone, CHECK_MSG, FIELD_CHECK, FIELDS, REASON } from '../../src/features/result/labels';

describe('labels', () => {
  it('badge text follows the route', () => {
    expect(badgeText({ path: 'device', reason: 'passed' })).toBe('Read on device');
    expect(badgeText({ path: 'cloud', reason: 'total_mismatch' })).toBe('Checked in cloud: total mismatch');
    expect(badgeText({ path: 'device', reason: 'cloud_error' })).toBe('Manual entry: cloud unavailable');
    expect(badgeText(null)).toBe('Manual entry');
  });
  it('badge tone is green for device, blue for cloud, amber otherwise', () => {
    expect(badgeTone({ path: 'device', reason: 'passed' })).toBe('bg-emerald-100 text-emerald-900');
    expect(badgeTone({ path: 'cloud', reason: 'low_confidence' })).toBe('bg-sky-100 text-sky-900');
    expect(badgeTone({ path: 'device', reason: 'ocr_error' })).toBe('bg-amber-100 text-amber-900');
    expect(badgeTone(null)).toBe('bg-amber-100 text-amber-900');
  });
  it('covers the ten fields and five checks', () => {
    expect(FIELDS.map(([k]) => k)).toEqual(['supplierName', 'supplierGstin', 'invoiceNo', 'invoiceDate', 'placeOfSupply', 'taxableValue', 'cgst', 'sgst', 'igst', 'total']);
    expect(Object.keys(CHECK_MSG).sort()).toEqual(['date', 'gstin', 'required', 'taxSplit', 'total']);
    expect(FIELD_CHECK.supplierGstin).toBe('gstin');
    expect(REASON.redact_error).toBe('could not hide private numbers safely');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/features/labels.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `web/src/features/result/labels.ts`**

Move `REASON`, `CHECK_MSG`, `EMPTY_EXTRACTION`, `FIELDS`, `FIELD_CHECK` out of `ResultPanel.tsx` unchanged (same strings, same order) and export them. Add:

```ts
import type { Checks, Extraction, Reason, RouteInfo } from '../../core/types';
import type { FieldKey } from './fields';

export const REASON: Record<Reason, string> = {
  passed: '', total_mismatch: 'total mismatch', invalid_gstin: 'invalid GSTIN', low_confidence: 'low confidence',
  device_timeout: 'on-device read too slow', device_error: 'on-device error', invalid_json: 'unreadable answer',
  no_device_model: 'no on-device AI', cloud_only_mode: 'cloud-only mode', cloud_error: 'cloud unavailable',
  ocr_error: 'could not check for private numbers', user_kept_local: 'kept on device',
  redact_error: 'could not hide private numbers safely',
};
export const CHECK_MSG: Record<keyof Checks, string> = { total: 'Items + tax ≠ total', gstin: 'GSTIN invalid', taxSplit: 'Tax split does not match states', date: 'Date invalid or in the future', required: 'Required field missing' };
export const EMPTY_EXTRACTION: Extraction = { supplierName: '', supplierGstin: '', invoiceNo: '', invoiceDate: '', placeOfSupply: '', taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0, confidence: 0 };
export const FIELDS: Array<[FieldKey, string, 'text' | 'number']> = [
  ['supplierName', 'Supplier', 'text'], ['supplierGstin', 'Supplier GSTIN', 'text'], ['invoiceNo', 'Invoice no.', 'text'],
  ['invoiceDate', 'Invoice date', 'text'], ['placeOfSupply', 'Place of supply', 'text'], ['taxableValue', 'Taxable value', 'number'],
  ['cgst', 'CGST', 'number'], ['sgst', 'SGST', 'number'], ['igst', 'IGST', 'number'], ['total', 'Total', 'number'],
];
export const FIELD_CHECK: Partial<Record<FieldKey, keyof Checks>> = { supplierGstin: 'gstin', invoiceDate: 'date', total: 'total', cgst: 'taxSplit', sgst: 'taxSplit', igst: 'taxSplit' };

type Route = Pick<RouteInfo, 'path' | 'reason'> | null;
const onDevice = (r: Route) => r !== null && r.path === 'device' && r.reason === 'passed';

export function badgeText(route: Route): string {
  if (!route) return 'Manual entry';
  if (onDevice(route)) return 'Read on device';
  return route.path === 'cloud' ? `Checked in cloud: ${REASON[route.reason]}` : `Manual entry: ${REASON[route.reason]}`;
}
export function badgeTone(route: Route): string {
  if (onDevice(route)) return 'bg-emerald-100 text-emerald-900';
  return route?.path === 'cloud' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900';
}
```

- [ ] **Step 4: Create `web/src/features/result/FieldInputs.tsx`**

```tsx
import type { Checks } from '../../core/types';
import type { FieldKey } from './fields';
import { CHECK_MSG, FIELD_CHECK, FIELDS } from './labels';

/** One red line per failed check. */
export function CheckMessages({ checks }: { checks: Checks | null }) {
  if (!checks) return null;
  return <>{(Object.keys(CHECK_MSG) as (keyof Checks)[]).filter((k) => !checks[k]).map((k) => <p key={k} className="text-red-700 text-sm">⚠ {CHECK_MSG[k]}</p>)}</>;
}

/** The ten bill fields. A field is red when its input is invalid or the check it feeds has failed. */
export default function FieldInputs({ text, invalid, checks, disabled = false, onChange }: {
  text: Record<FieldKey, string>; invalid: FieldKey[]; checks: Checks | null; disabled?: boolean; onChange(key: FieldKey, value: string): void;
}) {
  return (
    <>
      {FIELDS.map(([k, label, type]) => {
        const badInput = invalid.includes(k);
        const bad = badInput || (checks && FIELD_CHECK[k] && !checks[FIELD_CHECK[k]!]);
        return (
          <label key={k} className="block text-sm">{label}
            <input type="text" inputMode={type === 'number' ? 'decimal' : undefined} disabled={disabled}
              className={`mt-1 w-full border rounded p-2 disabled:bg-slate-100 disabled:text-slate-600 ${bad ? 'border-red-600 bg-red-50' : ''}`} aria-invalid={!!bad}
              value={text[k]} onChange={(ev) => onChange(k, ev.target.value)} />
            {badInput && <span role="alert" className="block text-red-700 text-xs">{type === 'number' ? 'Enter a number, 0 or more' : 'Invalid value'}</span>}
          </label>
        );
      })}
    </>
  );
}
```

- [ ] **Step 5: Use them in `ResultPanel.tsx`**

Delete the five moved constants and the now-unused `Reason` import. Import `{ EMPTY_EXTRACTION, badgeText, badgeTone }` from `./labels` and `FieldInputs, { CheckMessages }` from `./FieldInputs`. Replace:

- the `badge` constant with `const badge = badgeText(result.route);`
- the badge `<span>` class expression with `` className={`inline-block px-3 py-1 rounded-full text-sm ${badgeTone(result.route)}`} ``
- the inline failed-check `map` with `<CheckMessages checks={checks} />`
- the inline `FIELDS.map(...)` block with `<FieldInputs text={text} invalid={invalid} checks={checks} onChange={(k, v) => { setSaved(false); setText({ ...text, [k]: v }); }} />`

Keep `const { path, reason } = result.route;` only if something still uses it; otherwise delete it (`noUnusedLocals` is on).

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: tests pass; build succeeds; lint reports no errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/result web/tests/features/labels.test.ts
git commit -m "refactor(web): share bill field labels and inputs between result and review"
```

---

### Task 6: Bill inbox and client-list links

**Files:**
- Create: `web/src/features/shops/useShop.ts`, `web/src/features/inbox/InboxPage.tsx`
- Modify: `web/src/App.tsx` (one route), `web/src/features/shops/ShopsPage.tsx` (links + count), `web/src/features/upload/UploadPage.tsx` (one link)

**Interfaces:**
- Consumes: `watchShop`, `watchBills`, `countToReview`, `BILL_PAGE`, `Shop` from `web/src/adapters/store.ts`; `BILL_FILTERS`, `BillFilter`, `filterBills`, `monthsOf`, `countsByFilter`, `hasFailedCheck` from `web/src/core/review/filters.ts`; `BillDoc` from `web/src/core/review/billDoc.ts`; `failedChecks` from `web/src/core/review/decision.ts`; `badgeText`, `badgeTone`, `CHECK_MSG` from `web/src/features/result/labels.ts`.
- Produces: route `/shops/:shopId/bills` rendering `InboxPage`; `useShop(shopId: string | undefined): { shop: Shop | null; failed: boolean }`. The inbox reads an optional notice from router state: `navigate(path, { state: { notice: string } })`. Task 8 adds the export panel at the marked spot.

- [ ] **Step 1: Create `web/src/features/shops/useShop.ts`**

```ts
import { useEffect, useState } from 'react';
import { watchShop, type Shop } from '../../adapters/store';

/** Live shop document. failed = the shop does not exist or could not be read. */
export function useShop(shopId: string | undefined): { shop: Shop | null; failed: boolean } {
  const [shop, setShop] = useState<Shop | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setShop(null);
    if (!shopId) { setFailed(true); return; }
    setFailed(false);
    return watchShop(shopId, (s) => { setShop(s); setFailed(s === null); }, () => { setShop(null); setFailed(true); });
  }, [shopId]);
  return { shop, failed };
}
```

- [ ] **Step 2: Create `web/src/features/inbox/InboxPage.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { BILL_PAGE, watchBills } from '../../adapters/store';
import type { BillDoc } from '../../core/review/billDoc';
import { failedChecks } from '../../core/review/decision';
import { BILL_FILTERS, countsByFilter, filterBills, monthsOf, type BillFilter } from '../../core/review/filters';
import type { BillStatus } from '../../core/types';
import { badgeText, badgeTone, CHECK_MSG } from '../result/labels';
import { useShop } from '../shops/useShop';

const FILTER_LABEL: Record<BillFilter, string> = { to_review: 'To review', failed_checks: 'Failed checks', manual_entry: 'Manual entry', approved: 'Approved', rejected: 'Rejected', all: 'All' };
const STATUS_LABEL: Record<BillStatus, string> = { draft: 'To review', manual_entry: 'Manual entry', approved: 'Approved', rejected: 'Rejected' };
const STATUS_TONE: Record<BillStatus, string> = { draft: 'bg-slate-200 text-slate-900', manual_entry: 'bg-amber-100 text-amber-900', approved: 'bg-emerald-100 text-emerald-900', rejected: 'bg-red-100 text-red-900' };
const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function InboxPage() {
  const { shopId } = useParams();
  const location = useLocation();
  const { shop, failed: shopFailed } = useShop(shopId);
  const [max, setMax] = useState(BILL_PAGE);
  const [bills, setBills] = useState<BillDoc[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<BillFilter>('to_review');
  const [month, setMonth] = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;
    setError(false);
    return watchBills(shopId, max, (b) => { setBills(b); setError(false); }, () => setError(true));
  }, [shopId, max, attempt]);

  const all = useMemo(() => bills ?? [], [bills]);
  const months = useMemo(() => monthsOf(all), [all]);
  const counts = useMemo(() => countsByFilter(all, month), [all, month]);
  const shown = useMemo(() => filterBills(all, filter, month), [all, filter, month]);
  const notice = (location.state as { notice?: string } | null)?.notice;

  if (shopFailed) {
    return <p role="alert" className="text-red-700">This shop could not be loaded. <Link to="/shops" className="underline">Back to shops</Link></p>;
  }

  return (
    <div className="space-y-4">
      <Link to="/shops" className="text-sm underline">← Shops</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{shop?.shopName ?? '…'} — bills</h1>
        <Link to={`/shops/${shopId}/upload`} className="px-4 py-2 rounded-lg bg-emerald-700 text-white">Upload bills</Link>
      </div>
      {notice && <p role="status" className="p-3 rounded bg-emerald-50 text-emerald-900">{notice}</p>}

      {/* EXPORT PANEL (Task 8) */}

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter bills" className="flex flex-wrap gap-2">
          {BILL_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-sm border ${filter === f ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white'}`}>
              {FILTER_LABEL[f]} <span className="tabular-nums">({counts[f]})</span>
            </button>
          ))}
        </div>
        <label className="ml-auto text-sm">Month{' '}
          <select className="border rounded p-1.5 bg-white" value={month ?? ''} onChange={(e) => setMonth(e.target.value || null)}>
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-red-700">The bills could not be loaded. Check your connection.{' '}
          <button type="button" className="underline" onClick={() => setAttempt(attempt + 1)}>Try again</button></p>
      )}
      {!error && bills === null && <p role="status" className="text-slate-600">Loading bills…</p>}
      {!error && bills !== null && shown.length === 0 && (
        <p role="status" className="text-slate-600">{all.length === 0 ? 'No bills yet for this shop. Upload the first one.' : 'No bills match this filter.'}</p>
      )}
      {shown.length > 0 && (
        <div className="overflow-x-auto bg-white rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Bills for {shop?.shopName ?? 'this shop'}</caption>
            <thead className="text-left text-slate-600 border-b">
              <tr>
                <th scope="col" className="p-3">Invoice date</th><th scope="col" className="p-3">Supplier</th><th scope="col" className="p-3">Invoice no.</th>
                <th scope="col" className="p-3 text-right">Total</th><th scope="col" className="p-3">Read</th><th scope="col" className="p-3">Checks</th><th scope="col" className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => {
                const failed = failedChecks(b.checks);
                return (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="p-3 whitespace-nowrap">{b.extraction.invoiceDate || '—'}</td>
                    <td className="p-3"><Link className="underline font-medium" to={`/shops/${shopId}/bills/${b.id}`}>{b.extraction.supplierName || 'Unnamed supplier'}</Link></td>
                    <td className="p-3">{b.extraction.invoiceNo || '—'}</td>
                    <td className="p-3 text-right tabular-nums">{rupees(b.extraction.total)}</td>
                    <td className="p-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs ${badgeTone(b.route)}`}>{badgeText(b.route)}</span></td>
                    <td className="p-3">{failed.length === 0 ? <span className="text-emerald-800">All passed</span>
                      : <span className="text-red-700" title={failed.map((k) => CHECK_MSG[k]).join('; ')}>⚠ {failed.length} failed<span className="sr-only">: {failed.map((k) => CHECK_MSG[k]).join('; ')}</span></span>}</td>
                    <td className="p-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs ${STATUS_TONE[b.status]}`}>{STATUS_LABEL[b.status]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {bills !== null && bills.length >= max && (
        <p className="text-sm text-slate-600">Showing the newest {max} bills.{' '}
          <button type="button" className="underline" onClick={() => setMax(max + BILL_PAGE)}>Load older bills</button></p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the route in `web/src/App.tsx`**

Import `InboxPage from './features/inbox/InboxPage'` and add inside the `Layout` route group, after the upload route:

```tsx
        <Route path="/shops/:shopId/bills" element={<InboxPage />} />
```

- [ ] **Step 4: Update the client list in `web/src/features/shops/ShopsPage.tsx`**

Import `countToReview` from the store. Add state and an effect after the existing `watchShops` effect:

```tsx
  const [toReview, setToReview] = useState<Record<string, number>>({});
  const shopIds = shops.map((s) => s.id).join(',');
  useEffect(() => {
    let alive = true;
    for (const id of shopIds ? shopIds.split(',') : []) {
      // A failed count (offline, rules) just shows no number.
      countToReview(id).then((n) => { if (alive) setToReview((t) => ({ ...t, [id]: n })); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [shopIds]);
```

Replace the shop `<li>` with a card holding two links (a link inside a link is invalid HTML, so the whole card is no longer one link):

```tsx
            <li key={s.id} className="p-4 bg-white rounded-lg border flex flex-wrap items-center gap-3">
              <div className="mr-auto"><span className="font-semibold">{s.shopName}</span> <span className="text-slate-500 text-sm">{s.gstin}</span></div>
              <Link className="px-3 py-1.5 rounded border hover:border-emerald-600" to={`/shops/${s.id}/bills`}>
                Bills{toReview[s.id] !== undefined && <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${toReview[s.id] > 0 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{toReview[s.id]} to review</span>}
              </Link>
              <Link className="px-3 py-1.5 rounded border hover:border-emerald-600" to={`/shops/${s.id}/upload`}>Upload</Link>
            </li>
```

- [ ] **Step 5: Link the upload page to the inbox**

In `web/src/features/upload/UploadPage.tsx`, next to the `← Shops` link, add:

```tsx
      <Link to={`/shops/${shopId}/bills`} className="text-sm underline ml-4">Review bills →</Link>
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: tests pass; build succeeds; no lint errors (a `react-hooks/exhaustive-deps` warning must be fixed, not silenced, unless you can state why the dependency list is right).

- [ ] **Step 7: Commit**

```bash
git add web/src/features/inbox web/src/features/shops web/src/features/upload/UploadPage.tsx web/src/App.tsx
git commit -m "feat(web): bill inbox with filters and to-review counts on the client list"
```

---

### Task 7: Review screen

**Files:**
- Create: `web/src/features/review/BillPhoto.tsx`, `web/src/features/review/ReviewForm.tsx`, `web/src/features/review/ReviewPage.tsx`
- Modify: `web/src/App.tsx` (one route)

**Interfaces:**
- Consumes: `watchBill`, `watchBills`, `BILL_PAGE`, `saveReviewFields`, `approveBill`, `rejectBill`, `reopenBill`, `billImageUrl` from the store; `allowedActions`, `approvalBlockers`, `needsConfirmation`, `validRejectNote`, `REJECT_NOTE_MAX` from `core/review/decision.ts`; `nextToReview` from `core/review/filters.ts`; `runChecks` from `core/checks/checks.ts`; `parseConfig` from `core/config/parseConfig.ts`; `toFormText`, `parseForm`, `FieldKey` from `features/result/fields.ts`; `FieldInputs`, `CheckMessages`; `badgeText`, `badgeTone`, `CHECK_MSG`; `useAuth` from `features/auth/AuthProvider.tsx`.
- Produces: route `/shops/:shopId/bills/:billId`.

- [ ] **Step 1: Create `web/src/features/review/BillPhoto.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { billImageUrl } from '../../adapters/store';

/** The stored bill photo. Only the redacted copy is ever stored, and only for shops that opted in. */
export default function BillPhoto({ imagePath }: { imagePath: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setUrl(null); setFailed(false);
    if (!imagePath) return;
    let alive = true;
    billImageUrl(imagePath).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [imagePath]);

  if (!imagePath) {
    return <p className="p-6 bg-white rounded border text-slate-600">No photo stored. This shop keeps bill data only — check against the paper bill.</p>;
  }
  if (failed) return <p role="alert" className="p-6 bg-white rounded border text-red-700">The stored photo could not be loaded. Check against the paper bill.</p>;
  if (!url) return <p role="status" className="p-6 bg-white rounded border text-slate-600">Loading photo…</p>;
  return (
    <figure>
      <img src={url} alt="Stored bill photo with private numbers blacked out" className="w-full rounded border" onError={() => setFailed(true)} />
      <figcaption className="text-xs text-slate-600 mt-1">Stored copy. Private numbers were blacked out before it left the device.</figcaption>
    </figure>
  );
}
```

- [ ] **Step 2: Create `web/src/features/review/ReviewForm.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { approveBill, rejectBill, reopenBill, saveReviewFields } from '../../adapters/store';
import { runChecks } from '../../core/checks/checks';
import { parseConfig } from '../../core/config/parseConfig';
import type { BillDoc } from '../../core/review/billDoc';
import { allowedActions, approvalBlockers, needsConfirmation, REJECT_NOTE_MAX, validRejectNote } from '../../core/review/decision';
import type { BillStatus, Extraction } from '../../core/types';
import FieldInputs, { CheckMessages } from '../result/FieldInputs';
import { parseForm, toFormText, type FieldKey } from '../result/fields';
import { badgeText, badgeTone, CHECK_MSG } from '../result/labels';

const STATUS_LABEL: Record<BillStatus, string> = { draft: 'To review', manual_entry: 'Manual entry — fill in the fields', approved: 'Approved', rejected: 'Rejected' };
type Busy = 'save' | 'approve' | 'reject' | 'reopen' | null;

/** Mounted once per bill id (the page passes key={bill.id}); `bill` keeps updating from the live listener. */
export default function ReviewForm({ shopId, bill, uid, onReviewed }: { shopId: string; bill: BillDoc; uid: string; onReviewed(): void }) {
  const [base, setBase] = useState<Extraction>(bill.extraction);
  const [text, setText] = useState(() => toFormText(bill.extraction));
  const [dirty, setDirty] = useState(false);
  const [dropItems, setDropItems] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);

  // The listener also fires for our own writes; ownWrite tells those apart from a change made elsewhere.
  const ownWrite = useRef(false);
  const incoming = JSON.stringify(bill.extraction);
  const seen = useRef(incoming);
  useEffect(() => {
    if (incoming === seen.current) return;
    seen.current = incoming;
    if (ownWrite.current) return;
    if (dirty) { setChangedElsewhere(true); return; }
    setBase(bill.extraction); setText(toFormText(bill.extraction));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the stored fields change; dirty is read, not watched
  }, [incoming]);

  const can = allowedActions(bill.status);
  const editable = can.includes('edit');
  const items = dropItems ? undefined : base.items;

  // Checks follow the form live, so red marks clear as the CA fixes a field.
  const parsed = useMemo(() => {
    const p = parseForm(text, base);
    if (!p.ok) return p;
    const value: Extraction = { ...p.value };
    if (dropItems) { delete value.items; delete value.itemCount; }
    return { ok: true as const, value, checks: runChecks(value, parseConfig({}, true), new Date()).checks };
  }, [text, base, dropItems]);
  const invalid: FieldKey[] = parsed.ok ? [] : parsed.invalid;
  const checks = !editable ? bill.checks : parsed.ok ? parsed.checks : null;
  const blockers = parsed.ok ? approvalBlockers(parsed.checks) : [];
  const soft = parsed.ok ? needsConfirmation(parsed.checks) : [];
  const canApprove = parsed.ok && blockers.length === 0 && (soft.length === 0 || confirmed) && busy === null;

  async function run(kind: Exclude<Busy, null>, write: () => Promise<void>, after: () => void) {
    if (busy) return;
    setBusy(kind); setError(null); setSaved(false);
    ownWrite.current = true;
    try { await write(); after(); }
    catch { setError('Could not save. Check your connection and try again. Your changes are still here.'); }
    finally { ownWrite.current = false; setBusy(null); }
  }

  const save = () => { if (!parsed.ok) return; const p = parsed;
    void run('save', () => saveReviewFields(shopId, bill.id, p.value, p.checks), () => {
      setBase(p.value); setText(toFormText(p.value)); setDirty(false); setDropItems(false); setChangedElsewhere(false); setSaved(true);
    }); };
  const approve = () => { if (!parsed.ok || !canApprove) return; const p = parsed;
    void run('approve', () => approveBill(shopId, bill.id, uid, p.value, p.checks, soft), onReviewed); };
  const reject = () => { if (!validRejectNote(note)) return;
    void run('reject', () => rejectBill(shopId, bill.id, uid, note), onReviewed); };
  const reopen = () => { void run('reopen', () => reopenBill(shopId, bill.id), () => { setRejecting(false); setNote(''); setConfirmed(false); }); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-block px-3 py-1 rounded-full text-sm ${badgeTone(bill.route)}`}>{badgeText(bill.route)}</span>
        <span className="inline-block px-3 py-1 rounded-full text-sm bg-slate-200">{STATUS_LABEL[bill.status]}</span>
      </div>
      {bill.status === 'rejected' && bill.rejectNote && <p className="p-3 rounded bg-red-50 text-red-900 text-sm">Note to the client: {bill.rejectNote}</p>}
      {bill.status === 'approved' && bill.approvedWithFailedChecks.length > 0 && (
        <p className="p-3 rounded bg-amber-50 text-amber-900 text-sm">Approved after checking against the paper copy, with: {bill.approvedWithFailedChecks.map((k) => CHECK_MSG[k as keyof typeof CHECK_MSG] ?? k).join('; ')}</p>
      )}
      {changedElsewhere && <p role="status" className="p-3 rounded bg-amber-50 text-amber-900 text-sm">This bill was changed somewhere else. Your unsaved edits are still here; saving will replace the other changes.</p>}

      <CheckMessages checks={checks} />
      <FieldInputs text={text} invalid={invalid} checks={checks} disabled={!editable || busy !== null}
        onChange={(k, v) => { setSaved(false); setDirty(true); setText({ ...text, [k]: v }); }} />

      {base.items && base.items.length > 0 && (
        <div className="text-sm">
          <table className="w-full bg-white border rounded">
            <caption className="text-left font-medium p-2">Line items read from the bill ({base.items.length})</caption>
            <thead className="text-left text-slate-600 border-b"><tr>
              <th scope="col" className="p-2">Description</th><th scope="col" className="p-2">HSN</th><th scope="col" className="p-2 text-right">Qty</th>
              <th scope="col" className="p-2 text-right">Rate</th><th scope="col" className="p-2 text-right">Amount</th></tr></thead>
            <tbody className={dropItems ? 'line-through text-slate-400' : ''}>
              {base.items.map((it, i) => <tr key={i} className="border-b last:border-0"><td className="p-2">{it.description}</td><td className="p-2">{it.hsn}</td>
                <td className="p-2 text-right tabular-nums">{it.qty}</td><td className="p-2 text-right tabular-nums">{it.rate}</td><td className="p-2 text-right tabular-nums">{it.amount}</td></tr>)}
            </tbody>
          </table>
          {editable && (
            <label className="flex items-center gap-2 mt-2">
              <input type="checkbox" checked={dropItems} disabled={busy !== null} onChange={(e) => { setDropItems(e.target.checked); setDirty(true); setSaved(false); }} />
              Ignore line items (check taxable value + tax = total instead)
            </label>
          )}
        </div>
      )}
      {items === undefined && base.items && <p className="text-xs text-slate-600">Line items will be removed from this bill when you save or approve.</p>}

      {editable && (
        <div className="space-y-3 pt-2">
          {blockers.length > 0 && <p role="alert" className="text-sm text-red-700">Cannot approve yet: {blockers.map((k) => CHECK_MSG[k]).join('; ')}.</p>}
          {!parsed.ok && <p role="alert" className="text-sm text-red-700">Fix the fields marked in red before saving or approving.</p>}
          {soft.length > 0 && blockers.length === 0 && (
            <label className="flex items-start gap-2 text-sm p-3 rounded bg-amber-50">
              <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>I have checked this bill against the paper copy. ({soft.map((k) => CHECK_MSG[k]).join('; ')})</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="px-5 py-3 rounded-lg bg-emerald-700 text-white disabled:opacity-50" disabled={!canApprove} onClick={approve}>{busy === 'approve' ? 'Approving…' : 'Approve'}</button>
            <button type="button" className="px-5 py-3 rounded-lg border border-red-700 text-red-800 disabled:opacity-50" disabled={busy !== null} aria-expanded={rejecting} onClick={() => setRejecting(!rejecting)}>Reject…</button>
            <button type="button" className="px-5 py-3 rounded-lg border disabled:opacity-50" disabled={!parsed.ok || busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
          </div>
          {rejecting && (
            <div className="p-3 rounded border border-red-200 bg-red-50 space-y-2">
              <label className="block text-sm">Note to the client (why is this bill rejected?)
                <textarea className="mt-1 w-full border rounded p-2" rows={3} maxLength={REJECT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <p className="text-xs text-slate-600">{note.trim().length}/{REJECT_NOTE_MAX}</p>
              <button type="button" className="px-5 py-3 rounded-lg bg-red-700 text-white disabled:opacity-50" disabled={!validRejectNote(note) || busy !== null} onClick={reject}>{busy === 'reject' ? 'Rejecting…' : 'Reject bill'}</button>
            </div>
          )}
        </div>
      )}
      {can.includes('reopen') && (
        <button type="button" className="px-5 py-3 rounded-lg border disabled:opacity-50" disabled={busy !== null} onClick={reopen}>{busy === 'reopen' ? 'Reopening…' : 'Reopen for changes'}</button>
      )}
      {saved && <p role="status" className="text-sm text-emerald-800">Saved ✓</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create `web/src/features/review/ReviewPage.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BILL_PAGE, watchBill, watchBills } from '../../adapters/store';
import type { BillDoc } from '../../core/review/billDoc';
import { nextToReview } from '../../core/review/filters';
import { useAuth } from '../auth/AuthProvider';
import BillPhoto from './BillPhoto';
import ReviewForm from './ReviewForm';

export default function ReviewPage() {
  const { shopId, billId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  // undefined = still loading, null = no such bill
  const [bill, setBill] = useState<BillDoc | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const queue = useRef<BillDoc[]>([]);

  useEffect(() => {
    setBill(undefined); setFailed(false);
    if (!shopId || !billId) { setFailed(true); return; }
    return watchBill(shopId, billId, (b) => { setBill(b); setFailed(false); }, () => setFailed(true));
  }, [shopId, billId]);

  // The shop's bill list, only to know which bill comes next. A failure here just ends the run at the inbox.
  useEffect(() => {
    if (!shopId) return;
    return watchBills(shopId, BILL_PAGE, (b) => { queue.current = b; }, () => { queue.current = []; });
  }, [shopId]);

  const inbox = `/shops/${shopId}/bills`;
  function onReviewed() {
    const next = billId ? nextToReview(queue.current, billId) : null;
    if (next) navigate(`${inbox}/${next}`);
    else navigate(inbox, { state: { notice: 'All bills reviewed.' } });
  }

  return (
    <div className="space-y-4">
      <Link to={inbox} className="text-sm underline">← Bills</Link>
      <h1 className="text-2xl font-bold">Review bill</h1>
      {failed && <p role="alert" className="text-red-700">This bill could not be loaded. <Link to={inbox} className="underline">Back to bills</Link></p>}
      {!failed && bill === undefined && <p role="status" className="text-slate-600">Loading bill…</p>}
      {!failed && bill === null && <p role="alert" className="text-red-700">This bill does not exist. <Link to={inbox} className="underline">Back to bills</Link></p>}
      {!failed && bill && user && (
        <div className="grid gap-6 md:grid-cols-2">
          <BillPhoto imagePath={bill.imagePath} />
          <ReviewForm key={bill.id} shopId={shopId!} bill={bill} uid={user.uid} onReviewed={onReviewed} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the route in `web/src/App.tsx`**

Import `ReviewPage from './features/review/ReviewPage'` and add after the inbox route:

```tsx
        <Route path="/shops/:shopId/bills/:billId" element={<ReviewPage />} />
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: tests pass; build succeeds; lint has no errors. The one `eslint-disable-next-line` in `ReviewForm.tsx` is intended and explained in its comment.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/review web/src/App.tsx
git commit -m "feat(web): bill review screen with approve, reject and reopen"
```

---

### Task 8: Export panel with CSV download

**Files:**
- Create: `web/src/features/export/download.ts`, `web/src/features/export/ExportPanel.tsx`
- Modify: `web/src/features/inbox/InboxPage.tsx` (render the panel at the `EXPORT PANEL (Task 8)` comment)

**Interfaces:**
- Consumes: `fetchBillsByInvoiceDate`, `Shop` from the store; `exportable`, `notApprovedInRange`, `fileSlug` from `core/export/rows.ts`; `toCsv` from `core/export/csv.ts`; `isIsoDate`, `istMonth`, `monthRange` from `core/dates.ts`; `BillDoc`.
- Produces: `downloadText(filename: string, mime: string, text: string): void`; `<ExportPanel shop={shop} month={month} refreshKey={n} />`. Task 9 adds the Tally buttons at the marked spot.

- [ ] **Step 1: Create `web/src/features/export/download.ts`**

```ts
/** Saves text as a file from the browser. Nothing is uploaded anywhere. */
export function downloadText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 2: Create `web/src/features/export/ExportPanel.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { fetchBillsByInvoiceDate, type Shop } from '../../adapters/store';
import { isIsoDate, istMonth, monthRange } from '../../core/dates';
import { toCsv } from '../../core/export/csv';
import { exportable, fileSlug, notApprovedInRange } from '../../core/export/rows';
import type { BillDoc } from '../../core/review/billDoc';
import { downloadText } from './download';

type Found = { ready: BillDoc[]; leftOut: number };

/** Export of approved bills for a date range. refreshKey changes when the inbox sees an approval, so the count stays right. */
export default function ExportPanel({ shop, month, refreshKey }: { shop: Shop; month: string | null; refreshKey: number }) {
  const [range, setRange] = useState(() => monthRange(month ?? istMonth(new Date())));
  useEffect(() => { setRange(monthRange(month ?? istMonth(new Date()))); }, [month]);
  const { from, to } = range;
  const rangeOk = isIsoDate(from) && isIsoDate(to) && from <= to;

  const [found, setFound] = useState<Found | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  useEffect(() => {
    setFound(null);
    if (!rangeOk) { setState('idle'); return; }
    let alive = true;
    setState('loading');
    fetchBillsByInvoiceDate(shop.id, from, to)
      .then((b) => { if (alive) { setFound({ ready: exportable(b, from, to), leftOut: notApprovedInRange(b, from, to) }); setState('idle'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [shop.id, from, to, rangeOk, refreshKey]);

  const name = `hisaabcheck-${fileSlug(shop.shopName)}-${from}-to-${to}`;
  const none = !found || found.ready.length === 0;

  return (
    <section aria-labelledby="export-heading" className="bg-white rounded-lg border p-4 space-y-3">
      <h2 id="export-heading" className="font-semibold">Export approved bills</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">From (invoice date)
          <input type="date" className="block mt-1 border rounded p-2" value={from} max={to} onChange={(e) => setRange({ from: e.target.value, to })} />
        </label>
        <label className="text-sm">To
          <input type="date" className="block mt-1 border rounded p-2" value={to} min={from} onChange={(e) => setRange({ from, to: e.target.value })} />
        </label>
        <button type="button" className="px-4 py-2 rounded-lg bg-emerald-700 text-white disabled:opacity-50" disabled={none}
          onClick={() => found && downloadText(`${name}.csv`, 'text/csv;charset=utf-8', toCsv(found.ready))}>Download CSV</button>
        {/* TALLY BUTTONS (Task 9) */}
      </div>
      {!rangeOk && <p role="alert" className="text-sm text-red-700">Choose a From date that is on or before the To date.</p>}
      {state === 'loading' && <p role="status" className="text-sm text-slate-600">Counting bills…</p>}
      {state === 'error' && <p role="alert" className="text-sm text-red-700">The bills for this range could not be loaded. Check your connection and change a date to try again.</p>}
      {found && (
        <p role="status" className="text-sm text-slate-700">
          {found.ready.length} approved bill{found.ready.length === 1 ? '' : 's'} in this range.
          {found.leftOut > 0 && ` ${found.leftOut} more ${found.leftOut === 1 ? 'is' : 'are'} not approved and will be left out.`}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Render it in the inbox**

In `InboxPage.tsx`, import `ExportPanel from '../export/ExportPanel'`, add

```tsx
  const approvedCount = useMemo(() => all.filter((b) => b.status === 'approved').length, [all]);
```

and replace the `{/* EXPORT PANEL (Task 8) */}` comment with:

```tsx
      {shop && <ExportPanel shop={shop} month={month} refreshKey={approvedCount} />}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: tests pass; build succeeds; no lint errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/export web/src/features/inbox/InboxPage.tsx
git commit -m "feat(web): export approved bills as CSV for a date range"
```

---

### Task 9: Tally XML export

**Files:**
- Create: `web/src/core/export/tallyXml.ts`, `web/tests/core/tallyXml.test.ts`
- Modify: `web/src/features/export/ExportPanel.tsx` (buttons at the `TALLY BUTTONS (Task 9)` comment, one note)

**Interfaces:**
- Consumes: `BillDoc`; `toPaise`, `paiseToText` from `core/export/rows.ts`; `isValidGstin`, `gstinCheckChar` from `core/shield/gstin.ts`; `makeBill`; `downloadText`.
- Produces: `TallyLedgers`, `DEFAULT_LEDGERS`, `xmlText(s)`, `voucherEntries(bill, ledgers)`, `tallyReady(bills)`, `toTallyVouchersXml(bills, ledgers?)`, `toTallyMastersXml(bills, ledgers?)`.

Background for the implementer: Tally imports an XML "envelope". Masters (ledgers) and vouchers (transactions) are imported as separate files, masters first. A purchase voucher in accounting mode is a list of ledger entries that must sum to zero: the supplier is credited (`ISDEEMEDPOSITIVE` = `No`, positive amount) and the purchase and input-tax ledgers are debited (`ISDEEMEDPOSITIVE` = `Yes`, negative amount). This cannot be tested against a real Tally here; the tests below pin the structure and the arithmetic.

- [ ] **Step 1: Write the failing test `web/tests/core/tallyXml.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_LEDGERS, tallyReady, toTallyMastersXml, toTallyVouchersXml, voucherEntries, xmlText } from '../../src/core/export/tallyXml';
import { gstinCheckChar } from '../../src/core/shield/gstin';
import { makeBill } from '../billFixtures';

const VALID_GSTIN = `29ABCDE1234F1Z${gstinCheckChar('29ABCDE1234F1Z')}`;
const signed = (b: ReturnType<typeof makeBill>) => voucherEntries(b, DEFAULT_LEDGERS).reduce((s, e) => s + (e.debit ? -e.paise : e.paise), 0);
const count = (xml: string, tag: string) => xml.split(tag).length - 1;

describe('xmlText', () => {
  it('escapes the five XML characters', () => expect(xmlText(`A&B <"x"> 'y'`)).toBe('A&amp;B &lt;&quot;x&quot;&gt; &apos;y&apos;'));
  it('drops characters XML 1.0 forbids and keeps tabs, new lines and non-Latin text', () => {
    expect(xmlText('a\u0000b\u0008c\u001Fd')).toBe('abcd');
    expect(xmlText('a\tb\nc')).toBe('a\tb\nc');
    expect(xmlText('श्री ट्रेडर्स 😀')).toBe('श्री ट्रेडर्स 😀');
    expect(xmlText('x\uD800y')).toBe('xy');
  });
});

describe('voucherEntries', () => {
  it('credits the supplier and debits purchase and CGST/SGST; sums to zero', () => {
    const b = makeBill('b1');
    expect(voucherEntries(b, DEFAULT_LEDGERS)).toEqual([
      { ledger: 'Acme Traders', debit: false, paise: 11800 },
      { ledger: 'Purchases', debit: true, paise: 10000 },
      { ledger: 'Input CGST', debit: true, paise: 900 },
      { ledger: 'Input SGST', debit: true, paise: 900 },
    ]);
    expect(signed(b)).toBe(0);
  });
  it('uses IGST only for an inter-state bill', () => {
    const b = makeBill('b2', { extraction: { cgst: 0, sgst: 0, igst: 18 } });
    expect(voucherEntries(b, DEFAULT_LEDGERS).map((e) => e.ledger)).toEqual(['Acme Traders', 'Purchases', 'Input IGST']);
    expect(signed(b)).toBe(0);
  });
  it('books a small gap to Round Off, on the side that balances', () => {
    const up = makeBill('r1', { extraction: { taxableValue: 99.6, total: 118 } });   // 0.40 more debit needed
    expect(voucherEntries(up, DEFAULT_LEDGERS).at(-1)).toEqual({ ledger: 'Round Off', debit: true, paise: 40 });
    expect(signed(up)).toBe(0);
    const down = makeBill('r2', { extraction: { taxableValue: 100.45, total: 118 } }); // 0.45 too much debit
    expect(voucherEntries(down, DEFAULT_LEDGERS).at(-1)).toEqual({ ledger: 'Round Off', debit: false, paise: 45 });
    expect(signed(down)).toBe(0);
  });
  it('derives the taxable value from total minus tax when it is missing', () => {
    const b = makeBill('t', { extraction: { taxableValue: 0 } });
    expect(voucherEntries(b, DEFAULT_LEDGERS)[1]).toEqual({ ledger: 'Purchases', debit: true, paise: 10000 });
    expect(signed(b)).toBe(0);
  });
  it('avoids float drift', () => {
    const b = makeBill('f', { extraction: { taxableValue: 0.1 + 0.2, cgst: 0.027, sgst: 0.027, igst: 0, total: 0.35 } });
    expect(signed(b)).toBe(0);
  });
  it('names a supplier with no name', () => {
    expect(voucherEntries(makeBill('n', { extraction: { supplierName: '  ' } }), DEFAULT_LEDGERS)[0].ledger).toBe('Unknown supplier');
  });
});

describe('tallyReady', () => {
  it('leaves out bills whose amounts are more than ₹1 apart', () => {
    const good = makeBill('g'); const edge = makeBill('e', { extraction: { taxableValue: 99, total: 118 } });
    const bad = makeBill('x', { extraction: { taxableValue: 90, total: 118 } });
    const neg = makeBill('n', { extraction: { taxableValue: 0, cgst: 80, sgst: 80, total: 118 } });
    const r = tallyReady([good, edge, bad, neg]);
    expect(r.ok.map((b) => b.id)).toEqual(['g', 'e']);
    expect(r.unbalanced.map((b) => b.id)).toEqual(['x', 'n']);
  });
});

describe('toTallyVouchersXml', () => {
  const xml = toTallyVouchersXml([makeBill('b1', { extraction: { invoiceNo: 'A&1' } }), makeBill('b2', { extraction: { invoiceDate: '2026-11-09' } })]);
  it('is one import envelope for vouchers', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<TALLYREQUEST>Import Data</TALLYREQUEST>');
    expect(xml).toContain('<REPORTNAME>Vouchers</REPORTNAME>');
    expect(count(xml, '<ENVELOPE>')).toBe(1);
    expect(count(xml, '</ENVELOPE>')).toBe(1);
  });
  it('has one Purchase voucher per bill with date, reference and narration', () => {
    expect(count(xml, '<VOUCHER VCHTYPE="Purchase" ACTION="Create"')).toBe(2);
    expect(xml).toContain('<DATE>20261105</DATE>');
    expect(xml).toContain('<DATE>20261109</DATE>');
    expect(xml).toContain('<REFERENCE>A&amp;1</REFERENCE>');
    expect(xml).toContain('<PARTYLEDGERNAME>Acme Traders</PARTYLEDGERNAME>');
    expect(xml).toContain('<NARRATION>HisaabCheck bill b1</NARRATION>');
  });
  it('writes credits positive and debits negative', () => {
    expect(xml).toContain('<LEDGERNAME>Acme Traders</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>118.00</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>Purchases</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100.00</AMOUNT>');
    expect(xml).toContain('<LEDGERNAME>Input CGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-9.00</AMOUNT>');
  });
  it('every voucher in the file sums to zero', () => {
    for (const v of xml.split('<VOUCHER ').slice(1)) {
      const amounts = [...v.matchAll(/<AMOUNT>(-?\d+)\.(\d{2})<\/AMOUNT>/g)].map((m) => (m[1].startsWith('-') ? -1 : 1) * (Math.abs(Number(m[1])) * 100 + Number(m[2])));
      expect(amounts.reduce((s, a) => s + a, 0)).toBe(0);
    }
  });
});

describe('toTallyMastersXml', () => {
  const bills = [
    makeBill('a', { extraction: { supplierName: 'Acme Traders', supplierGstin: VALID_GSTIN } }),
    makeBill('b', { extraction: { supplierName: 'ACME TRADERS ', supplierGstin: '' } }),
    makeBill('c', { extraction: { supplierName: 'Shah & Sons', supplierGstin: 'NOT-A-GSTIN' } }),
  ];
  const xml = toTallyMastersXml(bills);
  it('is one import envelope for masters', () => expect(xml).toContain('<REPORTNAME>All Masters</REPORTNAME>'));
  it('creates each supplier once, ignoring case and spaces, under Sundry Creditors', () => {
    expect(count(xml, '<PARENT>Sundry Creditors</PARENT>')).toBe(2);
    expect(xml).toContain('<LEDGER NAME="Acme Traders" ACTION="Create">');
    expect(xml).toContain('<LEDGER NAME="Shah &amp; Sons" ACTION="Create">');
  });
  it('adds the GSTIN only when it is valid', () => {
    expect(xml).toContain(`<PARTYGSTIN>${VALID_GSTIN}</PARTYGSTIN>`);
    expect(count(xml, '<PARTYGSTIN>')).toBe(1);
  });
  it('creates the purchase, tax and round-off ledgers', () => {
    for (const n of ['Purchases', 'Input CGST', 'Input SGST', 'Input IGST', 'Round Off']) expect(xml).toContain(`<LEDGER NAME="${n}" ACTION="Create">`);
    expect(xml).toContain('<PARENT>Purchase Accounts</PARENT>');
    expect(count(xml, '<PARENT>Duties &amp; Taxes</PARENT>')).toBe(3);
    expect(xml).toContain('<PARENT>Indirect Expenses</PARENT>');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/core/tallyXml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/core/export/tallyXml.ts`**

```ts
import { isValidGstin } from '../shield/gstin';
import type { BillDoc } from '../review/billDoc';
import { paiseToText, toPaise } from './rows';

export interface TallyLedgers { purchase: string; cgst: string; sgst: string; igst: string; roundOff: string }
/** Ledger names used in the export. The masters file creates them, so they need not exist in the company. */
export const DEFAULT_LEDGERS: TallyLedgers = { purchase: 'Purchases', cgst: 'Input CGST', sgst: 'Input SGST', igst: 'Input IGST', roundOff: 'Round Off' };
const PARENT = { supplier: 'Sundry Creditors', purchase: 'Purchase Accounts', tax: 'Duties & Taxes', roundOff: 'Indirect Expenses' } as const;
/** A gap up to ₹1 is rounding; anything larger means the bill's amounts do not add up. */
const MAX_ROUND_OFF_PAISE = 100;

export interface VoucherEntry { ledger: string; debit: boolean; paise: number }

/** Escapes text for XML and drops characters XML 1.0 does not allow. */
export function xmlText(s: string): string {
  return s.replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const supplierLedger = (b: BillDoc): string => b.extraction.supplierName.trim() || 'Unknown supplier';

function amounts(b: BillDoc) {
  const e = b.extraction;
  const total = toPaise(e.total), cgst = toPaise(e.cgst), sgst = toPaise(e.sgst), igst = toPaise(e.igst);
  const tax = cgst + sgst + igst;
  const taxable = e.taxableValue > 0 ? toPaise(e.taxableValue) : total - tax;
  return { total, cgst, sgst, igst, taxable, roundOff: total - taxable - tax };
}

/** Ledger entries of one purchase voucher, in whole paise. Credits minus debits is always zero. */
export function voucherEntries(b: BillDoc, l: TallyLedgers): VoucherEntry[] {
  const a = amounts(b);
  const out: VoucherEntry[] = [{ ledger: supplierLedger(b), debit: false, paise: a.total }, { ledger: l.purchase, debit: true, paise: a.taxable }];
  if (a.cgst > 0) out.push({ ledger: l.cgst, debit: true, paise: a.cgst });
  if (a.sgst > 0) out.push({ ledger: l.sgst, debit: true, paise: a.sgst });
  if (a.igst > 0) out.push({ ledger: l.igst, debit: true, paise: a.igst });
  if (a.roundOff !== 0) out.push({ ledger: l.roundOff, debit: a.roundOff > 0, paise: Math.abs(a.roundOff) });
  return out;
}

/** Splits bills into those that make a sound voucher and those whose amounts are more than ₹1 apart. */
export function tallyReady(bills: BillDoc[]): { ok: BillDoc[]; unbalanced: BillDoc[] } {
  const ok: BillDoc[] = [], unbalanced: BillDoc[] = [];
  for (const b of bills) {
    const a = amounts(b);
    (a.total > 0 && a.taxable >= 0 && Math.abs(a.roundOff) <= MAX_ROUND_OFF_PAISE ? ok : unbalanced).push(b);
  }
  return { ok, unbalanced };
}

const envelope = (report: string, messages: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>`
  + `<REQUESTDESC><REPORTNAME>${report}</REPORTNAME></REQUESTDESC><REQUESTDATA>\n${messages.join('\n')}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;

const message = (inner: string): string => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${inner}</TALLYMESSAGE>`;

function entryXml(e: VoucherEntry): string {
  const amount = e.debit ? `-${paiseToText(e.paise)}` : paiseToText(e.paise);
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlText(e.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${e.debit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
}

/** One Purchase voucher per bill (accounting mode). Pass only bills from tallyReady().ok. */
export function toTallyVouchersXml(bills: BillDoc[], ledgers: TallyLedgers = DEFAULT_LEDGERS): string {
  return envelope('Vouchers', bills.map((b) => {
    const date = b.extraction.invoiceDate.replace(/-/g, '');
    return message(`<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${date}</DATE>`
      + `<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><REFERENCE>${xmlText(b.extraction.invoiceNo)}</REFERENCE><REFERENCEDATE>${date}</REFERENCEDATE>`
      + `<PARTYLEDGERNAME>${xmlText(supplierLedger(b))}</PARTYLEDGERNAME><ISINVOICE>No</ISINVOICE><NARRATION>${xmlText(`HisaabCheck bill ${b.id}`)}</NARRATION>`
      + `${voucherEntries(b, ledgers).map(entryXml).join('')}</VOUCHER>`);
  }));
}

const ledgerXml = (name: string, parent: string, extra = ''): string =>
  message(`<LEDGER NAME="${xmlText(name)}" ACTION="Create"><NAME.LIST><NAME>${xmlText(name)}</NAME></NAME.LIST><PARENT>${xmlText(parent)}</PARENT>${extra}</LEDGER>`);

/** Ledgers the vouchers need: one per supplier (Tally names ignore case), plus purchase, tax and round-off. Import this file first. */
export function toTallyMastersXml(bills: BillDoc[], ledgers: TallyLedgers = DEFAULT_LEDGERS): string {
  const suppliers = new Map<string, { name: string; gstin: string }>();
  for (const b of bills) {
    const name = supplierLedger(b), key = name.toLowerCase();
    const gstin = isValidGstin(b.extraction.supplierGstin) ? b.extraction.supplierGstin : '';
    const seen = suppliers.get(key);
    if (!seen) suppliers.set(key, { name, gstin }); else if (!seen.gstin && gstin) seen.gstin = gstin;
  }
  return envelope('All Masters', [
    ledgerXml(ledgers.purchase, PARENT.purchase),
    ledgerXml(ledgers.cgst, PARENT.tax), ledgerXml(ledgers.sgst, PARENT.tax), ledgerXml(ledgers.igst, PARENT.tax),
    ledgerXml(ledgers.roundOff, PARENT.roundOff),
    ...[...suppliers.values()].map((s) => ledgerXml(s.name, PARENT.supplier, s.gstin ? `<PARTYGSTIN>${xmlText(s.gstin)}</PARTYGSTIN>` : '')),
  ]);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run`
Expected: PASS. If `isValidGstin` rejects `VALID_GSTIN` (read `web/src/core/shield/gstin.ts` to see why), fix the test's GSTIN, not the validator.

- [ ] **Step 5: Add the buttons to `ExportPanel.tsx`**

Import `tallyReady, toTallyMastersXml, toTallyVouchersXml` from `../../core/export/tallyXml`. After `const none = ...` add:

```tsx
  const tally = found ? tallyReady(found.ready) : { ok: [], unbalanced: [] };
```

Replace the `{/* TALLY BUTTONS (Task 9) */}` comment with:

```tsx
        <button type="button" className="px-4 py-2 rounded-lg border disabled:opacity-50" disabled={tally.ok.length === 0}
          onClick={() => downloadText(`${name}-tally-1-masters.xml`, 'application/xml;charset=utf-8', toTallyMastersXml(tally.ok))}>Tally XML: 1. ledgers</button>
        <button type="button" className="px-4 py-2 rounded-lg border disabled:opacity-50" disabled={tally.ok.length === 0}
          onClick={() => downloadText(`${name}-tally-2-vouchers.xml`, 'application/xml;charset=utf-8', toTallyVouchersXml(tally.ok))}>Tally XML: 2. vouchers</button>
```

and after the `{found && (...)}` status paragraph add:

```tsx
      {tally.ok.length > 0 && <p className="text-xs text-slate-600">For Tally, import the ledgers file first, then the vouchers file. Try it on a test company first: this format has not been checked against every Tally version.</p>}
      {tally.unbalanced.length > 0 && (
        <p role="status" className="text-sm text-amber-900">{tally.unbalanced.length} approved bill{tally.unbalanced.length === 1 ? ' is' : 's are'} left out of the Tally files because taxable value + tax differs from the total by more than ₹1: {tally.unbalanced.map((b) => b.extraction.invoiceNo || b.id).join(', ')}. They are in the CSV.</p>
      )}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run && npm run build && npm run lint`
Expected: tests pass; build succeeds; no lint errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/core/export/tallyXml.ts web/tests/core/tallyXml.test.ts web/src/features/export/ExportPanel.tsx
git commit -m "feat: Tally XML export (masters and purchase vouchers)"
```

---

### Task 10: README, runtime check list, full verification

**Files:**
- Modify: `README.md` (sections describing what the app does, tests, and "Implemented")
- Create: `docs/superpowers/2026-11-26-subproject-b-followups.md`

**Interfaces:**
- Consumes: the finished Tasks 1–9.
- Produces: documentation only.

- [ ] **Step 1: Run the whole verification and record the real numbers**

Run, from `web/`:

```bash
npx vitest run
PATH=/opt/homebrew/opt/openjdk/bin:$PATH npm run test:rules
npm run build
npm run lint
```

Write down the test-file and test counts each command prints. Use those numbers in the README; do not copy numbers from this plan.

- [ ] **Step 2: Update `README.md`**

Read the README first and keep its plain, measured tone (it never claims more than was verified). Make these changes:

- In the opening description, add that the CA can review each bill in an inbox, approve or reject it, and export approved bills as CSV or Tally XML.
- Add a section "Review and export" covering, in short paragraphs or a short list: the inbox filters; what blocks approval (`required`, `date`) and what needs the tick box (`total`, `gstin`, `taxSplit`); that a reject needs a note; that the review photo is the stored redacted copy and exists only for shops that opted in to storing photos; CSV columns and the formula guard; the two Tally files, the order to import them, the ledger names they create, and that bills more than ₹1 out of balance are left out of the Tally files.
- State plainly that the Tally XML has not been imported into a real Tally and must be tried on a test company first.
- Update the test counts in the tests section with the numbers from Step 1, and say the rules tests now cover the review fields.
- Update the "Implemented" paragraph.

- [ ] **Step 3: Write `docs/superpowers/2026-11-26-subproject-b-followups.md`**

Contents: the state (branch, head commit, the counts from Step 1); "Verified here" vs "Not verified"; the runtime checks to do against real Firebase and Chrome, in this order:

1. Inbox loads for a shop with bills; filters and counts match; "Load older bills" at 300.
2. The to-review count on the client list (aggregate query under the real rules).
3. Review screen: stored photo loads through a Storage download URL under App Check; a shop without stored photos shows the "No photo stored" message.
4. Approve, approve with the tick box, reject with a note, reopen; a second browser tab shows the change live.
5. The deployed rules refuse an approval in another name (try from the console).
6. CSV opens in Excel and Google Sheets with ₹ amounts and Indian names intact; a supplier name starting with `=` shows as text.
7. Tally: import the masters file, then the vouchers file, into a test company; check one voucher by hand.
8. Review time per bill against the PRD target (< 20 s).

Then list known gaps: approve/reject wait for the server, so they hang offline; line items are read-only; no cross-shop inbox; no "exported" mark, so a range exported twice imports twice; export loads every bill in the range in one query.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/2026-11-26-subproject-b-followups.md
git commit -m "docs: review and export in the README, runtime check list for sub-project B"
```
