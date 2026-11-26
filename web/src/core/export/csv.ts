import { istDate } from '../dates';
import { readBy, type BillDoc } from '../review/billDoc';
import { billAmounts, paiseToText } from './rows';

export const CSV_HEADER = ['Invoice date', 'Invoice no.', 'Supplier', 'Supplier GSTIN', 'Place of supply', 'Taxable value',
  'CGST', 'SGST', 'IGST', 'Total', 'Read by', 'Approved on', 'Bill id'] as const;

/** RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would run as a formula. */
function cell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * One row per bill, in the order given. UTF-8 BOM so Excel reads ₹ and Indian names correctly.
 * Taxable value is the one the Tally file books: a stored 0 is written as total - tax.
 */
export function toCsv(bills: BillDoc[]): string {
  const rows = bills.map((b) => {
    const e = b.extraction, a = billAmounts(e);
    return [e.invoiceDate, e.invoiceNo, e.supplierName, e.supplierGstin, e.placeOfSupply,
      paiseToText(a.taxable), paiseToText(a.cgst), paiseToText(a.sgst), paiseToText(a.igst), paiseToText(a.total),
      readBy(b.route), b.reviewedAt ? istDate(b.reviewedAt) : '', b.id];
  });
  return `\uFEFF${[[...CSV_HEADER], ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
