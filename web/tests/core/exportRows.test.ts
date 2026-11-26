import { describe, expect, it } from 'vitest';
import { exportable, fileSlug, notApprovedInRange, paiseToText, toPaise } from '../../src/core/export/rows';
import { makeBill } from '../billFixtures';

const ap = (id: string, invoiceDate: string, invoiceNo = `INV-${id}`) => makeBill(id, { status: 'approved', extraction: { invoiceDate, invoiceNo } });
const bills = [
  ap('c', '2026-11-30'), ap('a', '2026-11-01'), ap('b2', '2026-11-15', 'B-2'), ap('b1', '2026-11-15', 'B-1'),
  ap('early', '2026-10-31'), ap('late', '2026-12-01'), ap('nodate', ''),
  makeBill('draft', { extraction: { invoiceDate: '2026-11-10' } }),
  makeBill('rej', { status: 'rejected', extraction: { invoiceDate: '2026-11-11' } }),
  makeBill('man', { status: 'manual_entry', extraction: { invoiceDate: '2026-12-25' } }),
];

describe('exportable', () => {
  it('keeps approved bills inside the range, both ends included, sorted by date then invoice number', () => {
    expect(exportable(bills, '2026-11-01', '2026-11-30').map((b) => b.id)).toEqual(['a', 'b1', 'b2', 'c']);
  });
  it('leaves out approved bills without a valid date', () => {
    expect(exportable(bills, '0000-01-01', '9999-12-31').map((b) => b.id)).not.toContain('nodate');
  });
  it('is empty when from is after to', () => expect(exportable(bills, '2026-11-30', '2026-11-01')).toEqual([]));
  it('breaks a full tie by bill id', () => {
    const tie = [ap('z', '2026-11-05', 'X'), ap('y', '2026-11-05', 'X')];
    expect(exportable(tie, '2026-11-01', '2026-11-30').map((b) => b.id)).toEqual(['y', 'z']);
  });
});

describe('notApprovedInRange', () => {
  it('counts draft, manual-entry and rejected bills dated inside the range', () => {
    expect(notApprovedInRange(bills, '2026-11-01', '2026-11-30')).toBe(2);
    expect(notApprovedInRange(bills, '2026-12-01', '2026-12-31')).toBe(1);
  });
});

describe('paise', () => {
  it('rounds rupees to whole paise', () => {
    expect(toPaise(118)).toBe(11800);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(1.005)).toBe(100); // float 1.005 is just under; documented, not corrected
    expect(toPaise(99.999)).toBe(10000);
  });
  it('prints paise with two decimals', () => {
    expect(paiseToText(11800)).toBe('118.00');
    expect(paiseToText(5)).toBe('0.05');
    expect(paiseToText(0)).toBe('0.00');
    expect(paiseToText(-1250)).toBe('-12.50');
  });
});

describe('fileSlug', () => {
  it('makes a safe file-name part', () => {
    expect(fileSlug('Ramesh Kirana & Sons')).toBe('ramesh-kirana-sons');
    expect(fileSlug('  ../../etc  ')).toBe('etc');
    expect(fileSlug('दुकान')).toBe('shop');
    expect(fileSlug('')).toBe('shop');
  });
});
