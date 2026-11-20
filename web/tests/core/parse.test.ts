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
  it('skips null and non-object items without throwing', () => {
    expect(() => parseExtraction('{"total":5,"items":[null]}')).not.toThrow();
    expect(parseExtraction('{"total":5,"items":[null]}')?.items).toEqual([]);
  });
  it('skips string items and keeps valid object items', () => {
    expect(() => parseExtraction('{"total":5,"items":["Rice"]}')).not.toThrow();
    const e = parseExtraction('{"total":5,"items":["Rice", {"description":"Dal","amount":"10"}]}')!;
    expect(e.items).toHaveLength(1);
    expect(e.items![0]).toEqual({ description: 'Dal', hsn: '', qty: 0, rate: 0, amount: 10 });
  });
  it('parses amounts with a trailing /-', () => {
    expect(parseExtraction('{"total":"1770/-"}')?.total).toBe(1770);
    expect(parseExtraction('{"total":"₹1,770/-"}')?.total).toBe(1770);
  });
  it('omits itemCount when it is null', () => {
    expect(parseExtraction('{"total":5,"itemCount":null}')).not.toHaveProperty('itemCount');
  });
  it('parses numeric-string itemCount', () => {
    expect(parseExtraction('{"total":5,"itemCount":"14"}')?.itemCount).toBe(14);
  });
  it('omits itemCount when it is not a number', () => {
    expect(parseExtraction('{"total":5,"itemCount":"many"}')).not.toHaveProperty('itemCount');
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
