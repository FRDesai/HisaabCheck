import type { Extraction, LineItem } from '../types';

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') { const n = Number(v.trim().replace(/\/-$/, '').replace(/[₹,\s]|Rs\.?/gi, '')); return Number.isFinite(n) ? n : 0; }
  return 0;
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// Count as a finite non-negative number, or undefined so the key is omitted.
const toCount = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const toStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function parseExtraction(raw: string): Extraction | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = raw.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
  let o: Record<string, unknown>;
  try { o = JSON.parse(body); } catch { return null; }
  if (typeof o !== 'object' || o === null) return null;
  const items = Array.isArray(o.items)
    ? o.items.filter(isObj).map((it): LineItem => ({
        description: toStr(it.description), hsn: toStr(it.hsn), qty: toNum(it.qty), rate: toNum(it.rate), amount: toNum(it.amount),
      }))
    : undefined;
  const itemCount = toCount(o.itemCount);
  return {
    supplierName: toStr(o.supplierName),
    supplierGstin: toStr(o.supplierGstin).toUpperCase().replace(/\s/g, ''),
    invoiceNo: toStr(o.invoiceNo),
    invoiceDate: toStr(o.invoiceDate),
    placeOfSupply: toStr(o.placeOfSupply),
    ...(items ? { items } : {}),
    ...(itemCount !== undefined ? { itemCount } : {}),
    taxableValue: toNum(o.taxableValue), cgst: toNum(o.cgst), sgst: toNum(o.sgst), igst: toNum(o.igst),
    total: toNum(o.total), confidence: Math.min(1, Math.max(0, toNum(o.confidence))),
  };
}
