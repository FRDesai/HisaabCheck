import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROUTE_LOG_KEYS } from '../../src/core/router/routeLog';
import type { ProcessedBill } from '../../src/core/types';
import type { Shop } from '../../src/adapters/store';

const calls: string[] = [];
const m = vi.hoisted(() => ({
  setDoc: vi.fn(), updateDoc: vi.fn(), uploadBytes: vi.fn(), getDoc: vi.fn(), n: 0,
}));
vi.mock('../../src/firebase', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...p: string[]) => ({ path: p.join('/') }),
  doc: (c: { path: string } | unknown, ...p: string[]) => {
    const base = (c as { path?: string }).path;
    if (base && p.length === 0) return { id: `id${++m.n}`, path: `${base}/id${m.n}` };
    return { id: p[p.length - 1], path: [base, ...p].join('/') };
  },
  setDoc: m.setDoc, updateDoc: m.updateDoc, serverTimestamp: () => 'TS',
  addDoc: vi.fn(), getDoc: m.getDoc, onSnapshot: vi.fn(), orderBy: vi.fn(), query: vi.fn(), where: vi.fn(), limit: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ ref: (_s: unknown, path: string) => ({ path }), uploadBytes: m.uploadBytes }));

import { CONSENT_VERSION, recordConsent, saveProcessedBill } from '../../src/adapters/store';

const shop = (storeImages: boolean): Shop => ({ id: 's1', caUid: 'u1', shopName: 'A', gstin: '', state: '', storeImages });
const img = new Blob(['x'], { type: 'image/jpeg' });
const bill = (): ProcessedBill => ({
  status: 'draft', extraction: { supplierName: 'S', supplierGstin: '', invoiceNo: '1', invoiceDate: '2026-01-01', placeOfSupply: '29',
    taxableValue: 100, cgst: 9, sgst: 9, igst: 0, total: 118, confidence: 0.9 },
  checks: { total: true, gstin: true, taxSplit: true, date: true, required: true },
  route: { path: 'device', reason: 'passed', modelName: 'm', promptVersion: 'v1' } as ProcessedBill['route'],
  piiTypes: ['PAN'], piiMasked: 1, latencyMs: 5, estCostUsd: 0, redactedImage: img,
});

beforeEach(() => {
  calls.length = 0; m.n = 0;
  m.setDoc.mockReset().mockImplementation(async (r: { path: string }) => { calls.push(`set:${r.path}`); });
  m.updateDoc.mockReset().mockResolvedValue(undefined);
  m.uploadBytes.mockReset().mockImplementation(async () => { calls.push('upload'); });
  m.getDoc.mockReset();
});

describe('saveProcessedBill', () => {
  it('with billId given, writes to that id and generates no new id', async () => {
    const r = saveProcessedBill(shop(false), 'u1', bill(), 'existing1');
    expect(r.billId).toBe('existing1');
    expect(m.setDoc.mock.calls[0][0].path).toContain('shops/s1/bills/existing1');
    expect(m.n).toBe(1); // only the route-log doc consumed an auto-id; none for the bill
    await r.synced;
  });
  it('returns billId synchronously and issues the bill write before any upload', async () => {
    const r = saveProcessedBill(shop(true), 'u1', bill());
    expect(typeof r.billId).toBe('string');
    expect(m.setDoc.mock.calls[0][0].path).toContain('shops/s1/bills/');
    expect(calls.indexOf(`set:shops/s1/bills/${r.billId}`)).toBeLessThan(calls.indexOf('upload'));
    await r.synced; await r.photo;
  });
  it('upload failure -> photo failed, bill still written, no imagePath update', async () => {
    m.uploadBytes.mockRejectedValue(new Error('x'));
    const r = saveProcessedBill(shop(true), 'u1', bill());
    expect(await r.photo).toBe('failed');
    await r.synced;
    expect(m.setDoc).toHaveBeenCalled();
    expect(m.updateDoc).not.toHaveBeenCalled();
  });
  it('storeImages false -> skipped, no upload', async () => {
    const r = saveProcessedBill(shop(false), 'u1', bill());
    expect(await r.photo).toBe('skipped');
    expect(m.uploadBytes).not.toHaveBeenCalled();
  });
  it('route log failure does not reject synced; bill write happened', async () => {
    m.setDoc.mockImplementation(async (r: { path: string }) => { if (r.path.startsWith('routeLogs')) throw new Error('denied'); });
    const r = saveProcessedBill(shop(false), 'u1', bill());
    await expect(r.synced).resolves.toBeUndefined();
    await new Promise((res) => setTimeout(res, 0));
    expect(m.setDoc.mock.calls.some((c) => c[0].path.startsWith('shops/s1/bills/'))).toBe(true);
  });
  it('uploads only p.redactedImage; bill doc has no imagePath before success, then updated', async () => {
    const r = saveProcessedBill(shop(true), 'u1', bill());
    const billDoc = m.setDoc.mock.calls.find((c) => c[0].path.startsWith('shops/'))![1];
    expect(billDoc).not.toHaveProperty('imagePath');
    expect(await r.photo).toBe('stored');
    expect(m.uploadBytes.mock.calls[0][1]).toBe(img);
    expect(m.uploadBytes.mock.calls[0][2]).toEqual({ contentType: 'image/jpeg' });
    expect(m.uploadBytes.mock.calls[0][0].path).toBe(`shops/s1/bills/${r.billId}.jpg`);
    expect(m.updateDoc.mock.calls[0][1]).toEqual({ imagePath: `shops/s1/bills/${r.billId}.jpg` });
  });
  it('route log doc has exactly the toRouteLog keys', () => {
    saveProcessedBill(shop(false), 'u1', bill());
    const log = m.setDoc.mock.calls.find((c) => c[0].path.startsWith('routeLogs'))![1];
    expect(Object.keys(log).sort()).toEqual([...ROUTE_LOG_KEYS].sort());
  });
});

describe('route log time', () => {
  it('uses the server timestamp, not the client clock', () => {
    saveProcessedBill(shop(false), 'u1', bill());
    const log = m.setDoc.mock.calls.find((c) => c[0].path.startsWith('routeLogs'))![1];
    expect(log.createdAt).toBe('TS');
  });
});

describe('recordConsent', () => {
  const user = { uid: 'u1', displayName: 'Asha', email: 'a@example.com' };
  const snap = (data?: Record<string, unknown>) => ({ exists: () => !!data, data: () => data });
  it('creates the user doc as a CA with consent when it does not exist', async () => {
    m.getDoc.mockResolvedValue(snap());
    await recordConsent(user);
    expect(m.updateDoc).not.toHaveBeenCalled();
    expect(m.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = m.setDoc.mock.calls[0];
    expect(ref.path).toMatch(/(^|\/)users\/u1$/);
    expect(data).toEqual({ role: 'ca', consentVersion: CONSENT_VERSION, consentAt: 'TS' });
    expect(m.setDoc.mock.calls[0][2]).toEqual({ merge: true });
  });
  it('adds consent to an existing doc without touching the role', async () => {
    m.getDoc.mockResolvedValue(snap({ role: 'admin', name: 'X' }));
    await recordConsent(user);
    expect(m.setDoc).not.toHaveBeenCalled();
    expect(m.updateDoc.mock.calls[0][1]).toEqual({ consentVersion: CONSENT_VERSION, consentAt: 'TS' });
  });
  it('never overwrites an existing consent for the same version', async () => {
    m.getDoc.mockResolvedValue(snap({ role: 'ca', consentVersion: CONSENT_VERSION }));
    await recordConsent(user);
    expect(m.setDoc).not.toHaveBeenCalled();
    expect(m.updateDoc).not.toHaveBeenCalled();
  });
});
