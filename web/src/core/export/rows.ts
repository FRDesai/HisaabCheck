import { isIsoDate } from '../dates';
import type { BillDoc } from '../review/billDoc';
import type { Extraction } from '../types';

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

/**
 * A bill's amounts in whole paise, as both exports use them. A stored taxable value of 0 means "not read",
 * so it is derived as total - tax. roundOff is whatever is left: total - taxable - tax.
 */
export function billAmounts(e: Extraction) {
  const total = toPaise(e.total), cgst = toPaise(e.cgst), sgst = toPaise(e.sgst), igst = toPaise(e.igst);
  const tax = cgst + sgst + igst;
  const taxable = e.taxableValue > 0 ? toPaise(e.taxableValue) : total - tax;
  return { total, cgst, sgst, igst, tax, taxable, roundOff: total - taxable - tax };
}

export function paiseToText(paise: number): string {
  const abs = Math.abs(paise);
  return `${paise < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** A shop name as a safe part of a file name. */
export function fileSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'shop';
}
