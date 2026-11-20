import type { Extraction } from '../../core/types';

export const TEXT_KEYS = ['supplierName', 'supplierGstin', 'invoiceNo', 'invoiceDate', 'placeOfSupply'] as const;
export const NUMBER_KEYS = ['taxableValue', 'cgst', 'sgst', 'igst', 'total'] as const;
export type FieldKey = (typeof TEXT_KEYS)[number] | (typeof NUMBER_KEYS)[number];

export function toFormText(e: Extraction): Record<FieldKey, string> {
  const out = {} as Record<FieldKey, string>;
  for (const k of TEXT_KEYS) out[k] = e[k] ?? '';
  for (const k of NUMBER_KEYS) out[k] = String(e[k] ?? 0);
  return out;
}

function parseAmount(s: string): number | null {
  const t = s.replace(/[,₹\s]/g, '');
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseForm(text: Record<FieldKey, string>, base: Extraction):
  { ok: true; value: Extraction } | { ok: false; invalid: FieldKey[] } {
  const invalid: FieldKey[] = [];
  const value: Extraction = { ...base };
  for (const k of TEXT_KEYS) value[k] = text[k].trim();
  value.supplierGstin = value.supplierGstin.toUpperCase();
  for (const k of NUMBER_KEYS) {
    const n = parseAmount(text[k]);
    if (n === null) invalid.push(k); else value[k] = n;
  }
  return invalid.length ? { ok: false, invalid } : { ok: true, value };
}
