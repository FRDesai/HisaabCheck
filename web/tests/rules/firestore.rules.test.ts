import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp } from 'firebase/firestore';

let env: RulesTestEnvironment;
// Matches what store.ts writes: server time, a shop the writer owns.
const log = (caUid: string, shopId = 's1') => ({ billId: 'b', shopId, caUid, platform: 'web', path: 'device', reason: 'passed',
  piiMasked: 0, piiTypes: [], latencyMs: 1, estCostUsd: 0, modelName: 'gemini-nano', promptVersion: 'v1', createdAt: serverTimestamp() });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-hisaabcheck',
    firestore: { rules: readFileSync(join(__dirname, '../../../firebase/firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'shops/s1'), { caUid: 'alice', shopName: 'A', gstin: '', state: '', storeImages: false });
    await setDoc(doc(c.firestore(), 'shops/s1/bills/b1'), { total: 1 });
    await setDoc(doc(c.firestore(), 'shops/bobshop'), { caUid: 'bob', shopName: 'B', gstin: '', state: '', storeImages: false });
    await setDoc(doc(c.firestore(), 'users/admin'), { role: 'admin' });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('firestore rules', () => {
  it('lets a CA read their own shop and bills', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'shops/s1')));
    await assertSucceeds(getDoc(doc(as('alice'), 'shops/s1/bills/b1')));
  });
  it('blocks other CAs', async () => {
    await assertFails(getDoc(doc(as('bob'), 'shops/s1')));
    await assertFails(getDoc(doc(as('bob'), 'shops/s1/bills/b1')));
    await assertFails(setDoc(doc(as('bob'), 'shops/s1/bills/b2'), { total: 1 }));
  });
  it('blocks creating a shop for someone else and changing caUid', async () => {
    await assertFails(setDoc(doc(as('bob'), 'shops/s2'), { caUid: 'alice' }));
    await assertFails(updateDoc(doc(as('alice'), 'shops/s1'), { caUid: 'bob' }));
  });
  it('users can only create themselves as ca', async () => {
    await assertSucceeds(setDoc(doc(as('carol'), 'users/carol'), { role: 'ca', name: 'C' }));
    await assertFails(setDoc(doc(as('dave'), 'users/dave'), { role: 'admin' }));
  });
  it('route logs are append-only, own-only, and PII-key-free', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'routeLogs/l1'), log('alice')));
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/l2'), log('bob')));
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/l3'), { ...log('alice'), pan: 'AAPFU0939F' }));
    await assertFails(updateDoc(doc(as('alice'), 'routeLogs/l1'), { reason: 'x' }));
    await assertFails(deleteDoc(doc(as('alice'), 'routeLogs/l1')));
    await assertSucceeds(getDocs(query(collection(as('alice'), 'routeLogs'), where('caUid', '==', 'alice'))));
    await assertFails(getDocs(collection(as('bob'), 'routeLogs')));
    await assertSucceeds(getDocs(collection(as('admin'), 'routeLogs')));
  });
  it('refuses a client-chosen createdAt', async () => {
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/t1'), { ...log('alice'), createdAt: new Date('2099-01-01') }));
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/t2'), { ...log('alice'), createdAt: new Date() }));
  });
  it('refuses route logs with wrong field types or values', async () => {
    const bad: Array<Record<string, unknown>> = [
      { piiTypes: 5 }, { piiTypes: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] }, { estCostUsd: -1 }, { estCostUsd: 2 },
      { estCostUsd: '0' }, { piiMasked: -1 }, { piiMasked: 1.5 }, { latencyMs: -1 }, { path: 'x' }, { platform: 'ios' },
      { reason: 5 }, { modelName: 1 }, { promptVersion: null }, { billId: 7 },
    ];
    for (const [i, b] of bad.entries()) await assertFails(setDoc(doc(as('alice'), `routeLogs/w${i}`), { ...log('alice'), ...b }));
  });
  it('refuses a route log missing a field', async () => {
    const { reason: _r, ...noReason } = log('alice');
    void _r;
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/m1'), noReason));
  });
  it('refuses a route log for someone else\'s shop or a missing shop', async () => {
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/o1'), log('alice', 'bobshop')));
    await assertFails(setDoc(doc(as('alice'), 'routeLogs/o2'), log('alice', 'nope')));
  });
  it('accepts a cloud route log with PII types and a cost', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'routeLogs/c1'),
      { ...log('alice'), path: 'cloud', reason: 'total_mismatch', piiMasked: 2, piiTypes: ['PAN', 'POSSIBLE_ID'], latencyMs: 1234.5, estCostUsd: 0.0003 }));
  });
  it('a CA creates and updates their own shop', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'shops/s3'), { caUid: 'alice', shopName: 'New', gstin: '', state: '', storeImages: false }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'shops/s3'), { shopName: 'Renamed', storeImages: true }));
  });
  it('a CA writes a bill and then a route log for their own shop', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'shops/s1/bills/b9'), { total: 118, status: 'draft', createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(as('alice'), 'routeLogs/b9log'), { ...log('alice'), billId: 'b9' }));
  });
  it('a user cannot update their own role to admin', async () => {
    await assertSucceeds(setDoc(doc(as('carol'), 'users/carol'), { role: 'ca', name: 'C' }));
    await assertFails(updateDoc(doc(as('carol'), 'users/carol'), { role: 'admin' }));
    await assertSucceeds(updateDoc(doc(as('carol'), 'users/carol'), { consentVersion: 'v', consentAt: serverTimestamp() }));
  });
  it('allows the app\'s CA dashboard query', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'routeLogs/q1'), log('alice')));
    await assertSucceeds(getDocs(query(collection(as('alice'), 'routeLogs'), where('caUid', '==', 'alice'), orderBy('createdAt', 'desc'), limit(1000))));
  });
});

