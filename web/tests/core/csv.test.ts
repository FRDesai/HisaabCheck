import { describe, expect, it } from 'vitest';
import { CSV_HEADER, toCsv } from '../../src/core/export/csv';
import { makeBill } from '../billFixtures';

const lines = (csv: string) => csv.slice(1).split('\r\n');

describe('toCsv', () => {
  it('starts with a BOM, uses CRLF and ends with a line break', () => {
    const csv = toCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`﻿${CSV_HEADER.join(',')}\r\n`);
  });
  it('writes one row per bill with two-decimal amounts', () => {
    const b = makeBill('b1', { status: 'approved', reviewedAt: new Date('2026-11-07T20:00:00Z') });
    expect(lines(toCsv([b]))[1]).toBe('2026-11-05,INV-b1,Acme Traders,29ABCDE1234F1Z5,29,100.00,9.00,9.00,0.00,118.00,device,2026-11-08,b1');
  });
  it('leaves Approved on empty when unknown and names cloud and manual reads', () => {
    const cloud = makeBill('c', { route: { path: 'cloud', reason: 'total_mismatch', confidence: 1, promptVersion: 'v1', modelName: 'm' } });
    const manual = makeBill('m', { route: null });
    const rows = lines(toCsv([cloud, manual]));
    expect(rows[1].split(',').slice(-3)).toEqual(['cloud', '', 'c']);
    expect(rows[2].split(',').slice(-3)).toEqual(['manual', '', 'm']);
  });
  it('quotes commas, quotes and line breaks', () => {
    const b = makeBill('q', { extraction: { supplierName: 'Shah, "Bros"\nTraders' } });
    expect(toCsv([b])).toContain('"Shah, ""Bros""\nTraders"');
  });
  it('defuses spreadsheet formulas', () => {
    for (const bad of ['=HYPERLINK("http://x")', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      const row = toCsv([makeBill('f', { extraction: { supplierName: bad, invoiceNo: 'N' } })]);
      expect(row).toContain(`'${bad.replace(/"/g, '""')}`);
    }
    // an ordinary name is left alone
    expect(toCsv([makeBill('p', { extraction: { supplierName: 'A-1 Stores' } })])).toContain(',A-1 Stores,');
  });
  it('has thirteen columns in every row', () => {
    const rows = lines(toCsv([makeBill('a'), makeBill('b')])).filter(Boolean);
    expect(CSV_HEADER).toHaveLength(13);
    for (const r of rows) expect(r.split(',')).toHaveLength(13);
  });
});
