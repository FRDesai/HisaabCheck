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
