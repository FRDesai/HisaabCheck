import { describe, it, expect } from 'vitest';
import { compareFields } from '../../src/core/accuracy/compareFields';

const truth = { supplierGstin: '29AAGCB7383J1Z4', invoiceDate: '2026-11-02', taxableValue: 1500, cgst: 135, sgst: 135, igst: 0, total: 1770 };
describe('compareFields', () => {
  it('matches strings case-insensitively and numbers within ₹1', () => {
    const r = compareFields(truth, { ...truth, supplierGstin: '29aagcb7383j1z4', total: 1770.6, supplierName: '', invoiceNo: '', placeOfSupply: '', confidence: 1 });
    expect(Object.values(r).every(Boolean)).toBe(true);
  });
  it('flags mismatches', () => {
    const r = compareFields(truth, { ...truth, cgst: 150, supplierName: '', invoiceNo: '', placeOfSupply: '', confidence: 1 });
    expect(r.cgst).toBe(false);
  });
  it('marks everything false for a null read', () => {
    expect(Object.values(compareFields(truth, null)).some(Boolean)).toBe(false);
  });
});
