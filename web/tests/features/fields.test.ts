import { describe, expect, it } from 'vitest';
import { toFormText, parseForm } from '../../src/features/result/fields';
import type { Extraction } from '../../src/core/types';

const base: Extraction = { supplierName: 'Acme', supplierGstin: '29ABCDE1234F1Z5', invoiceNo: 'A1', invoiceDate: '2026-01-01', placeOfSupply: '29',
  items: [{ description: 'x', hsn: '1', qty: 1, rate: 1, amount: 1 }], itemCount: 1, taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9 };

describe('fields', () => {
  it('untouched form round-trips', () => {
    const r = parseForm(toFormText(base), base);
    expect(r).toEqual({ ok: true, value: base });
  });
  it('preserves items/itemCount/confidence', () => {
    const r = parseForm({ ...toFormText(base), total: '200' }, base);
    expect(r.ok && r.value.items).toEqual(base.items);
    expect(r.ok && r.value.confidence).toBe(0.9);
    expect(r.ok && r.value.total).toBe(200);
  });
  it('empty number is invalid', () => {
    expect(parseForm({ ...toFormText(base), cgst: '  ' }, base)).toEqual({ ok: false, invalid: ['cgst'] });
  });
  it('parses commas and rupee sign', () => {
    const r = parseForm({ ...toFormText(base), total: '₹1,770.50' }, base);
    expect(r.ok && r.value.total).toBe(1770.5);
  });
  it('rejects "1.", "abc" and negatives', () => {
    for (const v of ['1.', 'abc', '-5']) {
      expect(parseForm({ ...toFormText(base), igst: v }, base)).toEqual({ ok: false, invalid: ['igst'] });
    }
  });
  it('trims text and upper-cases GSTIN', () => {
    const r = parseForm({ ...toFormText(base), supplierName: ' Bob ', supplierGstin: ' 29abcde1234f1z5 ' }, base);
    expect(r.ok && r.value.supplierName).toBe('Bob');
    expect(r.ok && r.value.supplierGstin).toBe('29ABCDE1234F1Z5');
  });
});
