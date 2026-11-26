import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Checks, Extraction } from '../../src/core/types';

const m = vi.hoisted(() => ({
  updateDoc: vi.fn(), onSnapshot: vi.fn(), getDocsFromServer: vi.fn(), getCountFromServer: vi.fn(), getDownloadURL: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  doc: (_db: unknown, ...p: string[]) => ({ id: p[p.length - 1], path: p.join('/') }),
  query: (base: { path: string }, ...parts: unknown[]) => ({ path: base.path, parts }),
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: string, dir = 'asc') => ({ orderBy: [field, dir] }),
  limit: (n: number) => ({ limit: n }),
  deleteField: () => 'DEL', serverTimestamp: () => 'TS',
  updateDoc: m.updateDoc, onSnapshot: m.onSnapshot, getDocsFromServer: m.getDocsFromServer, getCountFromServer: m.getCountFromServer,
  addDoc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ ref: (_s: unknown, path: string) => ({ path }), uploadBytes: vi.fn(), getDownloadURL: m.getDownloadURL }));

import { BILL_PAGE, approveBill, billImageUrl, countToReview, fetchBillsByInvoiceDate, rejectBill, reopenBill, saveReviewFields,
  watchBill, watchBills, watchShop } from '../../src/adapters/store';

const e: Extraction = { supplierName: 'Acme', supplierGstin: 'G', invoiceNo: '1', invoiceDate: '2026-11-05', placeOfSupply: '29',
  taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9 };
const checks: Checks = { total: true, gstin: false, taxSplit: true, date: true, required: true };
const snapDoc = (id: string, data: Record<string, unknown>) => ({ id, exists: () => true, data: vi.fn(() => data) });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.updateDoc.mockResolvedValue(undefined);
});

describe('review writes', () => {
  it('approveBill writes the fields, checks and review stamp in one update', async () => {
    await approveBill('s1', 'b1', 'alice', e, checks, ['gstin']);
    const [ref, data] = m.updateDoc.mock.calls[0];
    expect(ref.path).toBe('shops/s1/bills/b1');
    expect(data).toEqual({ ...e, items: 'DEL', checks, status: 'approved', reviewedBy: 'alice', reviewedAt: 'TS',
      rejectNote: 'DEL', approvedWithFailedChecks: ['gstin'], editedAt: 'TS' });
  });
  it('approveBill removes approvedWithFailedChecks when nothing failed and keeps line items', async () => {
    const items = [{ description: 'Rice', hsn: '1006', qty: 1, rate: 100, amount: 100 }];
    await approveBill('s1', 'b1', 'alice', { ...e, items, itemCount: 1 }, checks, []);
    const data = m.updateDoc.mock.calls[0][1];
    expect(data.approvedWithFailedChecks).toBe('DEL');
    expect(data.items).toEqual(items);
    expect(data.itemCount).toBe(1);
  });
  it('rejectBill trims the note and clears approval marks', async () => {
    await rejectBill('s1', 'b1', 'alice', '  Photo is blurred  ');
    expect(m.updateDoc.mock.calls[0][1]).toEqual({ status: 'rejected', reviewedBy: 'alice', reviewedAt: 'TS',
      rejectNote: 'Photo is blurred', approvedWithFailedChecks: 'DEL' });
  });
  it('reopenBill returns the bill to draft and removes every review field', async () => {
    await reopenBill('s1', 'b1');
    expect(m.updateDoc.mock.calls[0][1]).toEqual({ status: 'draft', reviewedBy: 'DEL', reviewedAt: 'DEL', rejectNote: 'DEL', approvedWithFailedChecks: 'DEL' });
  });
  it('saveReviewFields writes fields and checks, never a status, and no undefined values', async () => {
    await saveReviewFields('s1', 'b1', { ...e, itemCount: undefined }, checks);
    const data = m.updateDoc.mock.calls[0][1];
    expect(data).toEqual({ ...e, items: 'DEL', checks, editedAt: 'TS' });
    expect('status' in data).toBe(false);
    expect(Object.values(data)).not.toContain(undefined);
  });
  it('passes a server refusal on to the caller', async () => {
    m.updateDoc.mockRejectedValue(new Error('denied'));
    await expect(reopenBill('s1', 'b1')).rejects.toThrow('denied');
  });
});

describe('reads', () => {
  it('watchBills listens to the newest bills and maps them', () => {
    const cb = vi.fn(); const onError = vi.fn();
    m.onSnapshot.mockReturnValue('unsub');
    expect(watchBills('s1', BILL_PAGE, cb, onError)).toBe('unsub');
    const [q, next, err] = m.onSnapshot.mock.calls[0];
    expect(q.path).toBe('shops/s1/bills');
    expect(q.parts).toEqual([{ orderBy: ['createdAt', 'desc'] }, { limit: 300 }]);
    const d = snapDoc('b1', { supplierName: 'Acme', status: 'approved' });
    next({ docs: [d] });
    expect(d.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
    expect(cb.mock.calls[0][0][0]).toMatchObject({ id: 'b1', status: 'approved', extraction: { supplierName: 'Acme' } });
    err(new Error('x'));
    expect(onError).toHaveBeenCalled();
  });
  it('watchBill gives null for a missing bill', () => {
    const cb = vi.fn();
    watchBill('s1', 'b1', cb, vi.fn());
    const [ref, next] = m.onSnapshot.mock.calls[0];
    expect(ref.path).toBe('shops/s1/bills/b1');
    next({ exists: () => false });
    expect(cb).toHaveBeenLastCalledWith(null);
    next(snapDoc('b1', { status: 'draft' }));
    expect(cb.mock.calls[1][0]).toMatchObject({ id: 'b1', status: 'draft' });
  });
  it('watchShop gives the shop with its id, or null', () => {
    const cb = vi.fn();
    watchShop('s1', cb, vi.fn());
    const [ref, next] = m.onSnapshot.mock.calls[0];
    expect(ref.path).toBe('shops/s1');
    next(snapDoc('s1', { shopName: 'A', caUid: 'alice', gstin: '', state: '', storeImages: false }));
    expect(cb).toHaveBeenLastCalledWith({ id: 's1', shopName: 'A', caUid: 'alice', gstin: '', state: '', storeImages: false });
    next({ exists: () => false });
    expect(cb).toHaveBeenLastCalledWith(null);
  });
  it('countToReview counts draft and manual-entry bills', async () => {
    m.getCountFromServer.mockResolvedValue({ data: () => ({ count: 4 }) });
    expect(await countToReview('s1')).toBe(4);
    const q = m.getCountFromServer.mock.calls[0][0];
    expect(q.path).toBe('shops/s1/bills');
    expect(q.parts).toEqual([{ where: ['status', 'in', ['draft', 'manual_entry']] }]);
  });
  it('fetchBillsByInvoiceDate reads the date range from the server, never the offline cache', async () => {
    m.getDocsFromServer.mockResolvedValue({ docs: [snapDoc('b1', { invoiceDate: '2026-11-05', status: 'approved' })] });
    const out = await fetchBillsByInvoiceDate('s1', '2026-11-01', '2026-11-30');
    expect(out[0]).toMatchObject({ id: 'b1', status: 'approved' });
    expect(m.getDocsFromServer.mock.calls[0][0].parts).toEqual([{ where: ['invoiceDate', '>=', '2026-11-01'] }, { where: ['invoiceDate', '<=', '2026-11-30'] }, { orderBy: ['invoiceDate', 'asc'] }]);
  });
  it('fetchBillsByInvoiceDate fails when the server cannot be reached', async () => {
    m.getDocsFromServer.mockRejectedValue(new Error('unavailable'));
    await expect(fetchBillsByInvoiceDate('s1', '2026-11-01', '2026-11-30')).rejects.toThrow('unavailable');
  });
  it('billImageUrl asks Storage for a download URL', async () => {
    m.getDownloadURL.mockResolvedValue('https://x/y.jpg');
    expect(await billImageUrl('shops/s1/bills/b1.jpg')).toBe('https://x/y.jpg');
    expect(m.getDownloadURL.mock.calls[0][0]).toEqual({ path: 'shops/s1/bills/b1.jpg' });
  });
});
