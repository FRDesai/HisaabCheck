import { describe, it, expect } from 'vitest';
import { parseExtraction } from '../../src/core/extract/parse';
import { devicePrompt, cloudPrompt } from '../../src/core/extract/prompts';
import { parseConfig } from '../../src/core/config/parseConfig';

const base = { supplierName: 'Ravi Traders', supplierGstin: '29AAGCB7383J1Z4', invoiceNo: '4521', invoiceDate: '2026-11-02',
  placeOfSupply: '29-Karnataka', taxableValue: 1500, cgst: 135, sgst: 135, igst: 0, total: 1770, confidence: 0.9 };

describe('parseExtraction', () => {
  it('parses plain JSON', () => expect(parseExtraction(JSON.stringify(base))?.total).toBe(1770));
  it('strips code fences and prose', () => {
    expect(parseExtraction('Here you go:\n```json\n' + JSON.stringify(base) + '\n```')?.invoiceNo).toBe('4521');
  });
  it('removes trailing commas', () => {
    expect(parseExtraction('{"supplierName":"A","total":5,}')?.total).toBe(5);
  });
  it('coerces numeric strings with commas and ₹', () => {
    expect(parseExtraction(JSON.stringify({ ...base, total: '₹1,770.00' }))?.total).toBe(1770);
  });
  it('defaults missing fields', () => {
    const e = parseExtraction('{"total": 10}')!;
    expect(e.supplierGstin).toBe('');
    expect(e.cgst).toBe(0);
    expect(e.items).toBeUndefined();
  });
  it('upper-cases and trims the GSTIN', () => {
    expect(parseExtraction(JSON.stringify({ ...base, supplierGstin: ' 29aagcb7383j1z4 ' }))?.supplierGstin).toBe('29AAGCB7383J1Z4');
  });
  it('returns null for garbage', () => expect(parseExtraction('sorry, cannot read')).toBeNull());
  it('parses items', () => {
    const e = parseExtraction(JSON.stringify({ ...base, items: [{ description: 'Rice', hsn: '1006', qty: '2', rate: 50, amount: '100' }] }))!;
    expect(e.items).toEqual([{ description: 'Rice', hsn: '1006', qty: 2, rate: 50, amount: 100 }]);
  });
});

describe('prompts', () => {
  it('device prompt mentions the item limit', () => {
    expect(devicePrompt({ ...parseConfig({}, false), maxDeviceLineItems: 7 })).toContain('7 or fewer');
  });
  it('cloud prompt always asks for items', () => expect(cloudPrompt(parseConfig({}, false))).toContain('"items"'));
});
