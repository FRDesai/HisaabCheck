import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';

let env: RulesTestEnvironment;
const log = (caUid: string) => ({ billId: 'b', shopId: 's1', caUid, platform: 'web', path: 'device', reason: 'passed',
  piiMasked: 0, piiTypes: [], latencyMs: 1, estCostUsd: 0, modelName: 'gemini-nano', promptVersion: 'v1', createdAt: new Date() });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-hisaabcheck',
    firestore: { rules: readFileSync(join(__dirname, '../../../firebase/firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'shops/s1'), { caUid: 'alice', shopName: 'A', gstin: '', state: '', storeImages: false });
    await setDoc(doc(c.firestore(), 'shops/s1/bills/b1'), { total: 1 });
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
});
