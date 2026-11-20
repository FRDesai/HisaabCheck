import type { Extraction } from '../types';
export type Truth = Pick<Extraction, 'supplierGstin' | 'invoiceDate' | 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'total'>;
const KEYS: (keyof Truth)[] = ['supplierGstin', 'invoiceDate', 'taxableValue', 'cgst', 'sgst', 'igst', 'total'];

export function compareFields(truth: Truth, got: Extraction | null): Record<keyof Truth, boolean> {
  return Object.fromEntries(KEYS.map((k) => {
    if (!got) return [k, false];
    const a = truth[k], b = got[k];
    return [k, typeof a === 'number' ? Math.abs(a - Number(b)) <= 1 : String(a).trim().toUpperCase() === String(b).trim().toUpperCase()];
  })) as Record<keyof Truth, boolean>;
}
