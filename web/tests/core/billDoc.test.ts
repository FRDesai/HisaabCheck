import { describe, expect, it } from 'vitest';
import { readBy, toBillDoc } from '../../src/core/review/billDoc';

const ts = (iso: string) => ({ toDate: () => new Date(iso) });
const full = {
  supplierName: 'Acme Traders', supplierGstin: '29ABCDE1234F1Z5', invoiceNo: 'A-1', invoiceDate: '2026-11-05', placeOfSupply: '29',
  items: [{ description: 'Rice', hsn: '1006', qty: 2, rate: 50, amount: 100 }], itemCount: 1,
  taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9,
  checks: { total: true, gstin: true, taxSplit: false, date: true, required: true }, status: 'approved',
  route: { path: 'device', reason: 'passed', confidence: 0.97, promptVersion: 'v1', modelName: 'gemini-nano' },
  imagePath: 'shops/s1/bills/b1.jpg', createdAt: ts('2026-11-06T10:00:00Z'), reviewedAt: ts('2026-11-07T10:00:00Z'), reviewedBy: 'alice',
  approvedWithFailedChecks: ['taxSplit'],
};

describe('toBillDoc', () => {
  it('maps a complete bill', () => {
    const b = toBillDoc('b1', full);
    expect(b.id).toBe('b1');
    expect(b.extraction).toEqual({ supplierName: 'Acme Traders', supplierGstin: '29ABCDE1234F1Z5', invoiceNo: 'A-1', invoiceDate: '2026-11-05',
      placeOfSupply: '29', taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9,
      items: [{ description: 'Rice', hsn: '1006', qty: 2, rate: 50, amount: 100 }], itemCount: 1 });
    expect(b.checks).toEqual({ total: true, gstin: true, taxSplit: false, date: true, required: true });
    expect(b.status).toBe('approved');
    expect(b.route).toEqual(full.route);
    expect(b.imagePath).toBe('shops/s1/bills/b1.jpg');
    expect(b.createdAt).toEqual(new Date('2026-11-06T10:00:00Z'));
    expect(b.reviewedAt).toEqual(new Date('2026-11-07T10:00:00Z'));
    expect(b.reviewedBy).toBe('alice');
    expect(b.approvedWithFailedChecks).toEqual(['taxSplit']);
  });
  it('fills safe defaults for an empty document', () => {
    const b = toBillDoc('x', {});
    expect(b.extraction).toEqual({ supplierName: '', supplierGstin: '', invoiceNo: '', invoiceDate: '', placeOfSupply: '',
      taxableValue: 0, cgst: 0, sgst: 0, igst: 0, total: 0, confidence: 0 });
    expect('items' in b.extraction).toBe(false);
    expect('itemCount' in b.extraction).toBe(false);
    expect(b).toMatchObject({ checks: null, status: 'draft', route: null, imagePath: null, createdAt: null, reviewedAt: null,
      reviewedBy: null, rejectNote: '', approvedWithFailedChecks: [] });
  });
  it('ignores wrong-typed fields', () => {
    const b = toBillDoc('x', { supplierName: 5, total: '118', cgst: NaN, items: 'none', checks: 'yes', status: 'paid', route: { path: 'fax' },
      imagePath: 7, createdAt: 'yesterday', rejectNote: 9, approvedWithFailedChecks: ['total', 3], itemCount: '2' });
    expect(b.extraction.supplierName).toBe('');
    expect(b.extraction.total).toBe(0);
    expect(b.extraction.cgst).toBe(0);
    expect('items' in b.extraction).toBe(false);
    expect('itemCount' in b.extraction).toBe(false);
    expect(b).toMatchObject({ checks: null, status: 'draft', route: null, imagePath: null, createdAt: null, rejectNote: '', approvedWithFailedChecks: ['total'] });
  });
  it('treats a missing check as failed and repairs line items', () => {
    const b = toBillDoc('x', { checks: { total: true }, items: [{ description: 'A', amount: 10 }, 'junk', null] });
    expect(b.checks).toEqual({ total: true, gstin: false, taxSplit: false, date: false, required: false });
    expect(b.extraction.items).toEqual([{ description: 'A', hsn: '', qty: 0, rate: 0, amount: 10 }]);
  });
  it('accepts Date values and rejects invalid ones', () => {
    expect(toBillDoc('x', { createdAt: new Date('2026-11-06T10:00:00Z') }).createdAt).toEqual(new Date('2026-11-06T10:00:00Z'));
    expect(toBillDoc('x', { createdAt: new Date('nope') }).createdAt).toBeNull();
    expect(toBillDoc('x', { createdAt: { toDate: () => 'x' } }).createdAt).toBeNull();
  });
});

describe('readBy', () => {
  it('names who read the bill', () => {
    expect(readBy({ path: 'device', reason: 'passed', confidence: 1, promptVersion: 'v1', modelName: 'm' })).toBe('device');
    expect(readBy({ path: 'cloud', reason: 'total_mismatch', confidence: 1, promptVersion: 'v1', modelName: 'm' })).toBe('cloud');
    expect(readBy({ path: 'device', reason: 'cloud_error', confidence: 0, promptVersion: 'v1', modelName: 'm' })).toBe('manual');
    expect(readBy(null)).toBe('manual');
  });
});
