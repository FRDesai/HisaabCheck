import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, documentId, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp, deleteField } from 'firebase/firestore';

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
    await setDoc(doc(c.firestore(), 'shops/s1/bills/d1'), { status: 'draft', total: 118 });
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


describe('bill review rules', () => {
  const d1 = (uid: string) => doc(as(uid), 'shops/s1/bills/d1');
  const approve = (uid: string) => ({ status: 'approved', reviewedBy: uid, reviewedAt: serverTimestamp() });

  it('the owner approves a bill', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
  });
  it('another CA cannot approve it', async () => {
    await assertFails(updateDoc(d1('bob'), approve('bob')));
  });
  it('refuses approval in someone else\'s name, without a time, or with a client-chosen time', async () => {
    await assertFails(updateDoc(d1('alice'), { ...approve('alice'), reviewedBy: 'bob' }));
    await assertFails(updateDoc(d1('alice'), { status: 'approved', reviewedBy: 'alice' }));
    await assertFails(updateDoc(d1('alice'), { status: 'approved', reviewedBy: 'alice', reviewedAt: new Date('2020-01-01') }));
  });
  it('a reject needs a note of 1 to 500 characters', async () => {
    const reject = { status: 'rejected', reviewedBy: 'alice', reviewedAt: serverTimestamp() };
    await assertFails(updateDoc(d1('alice'), reject));
    await assertFails(updateDoc(d1('alice'), { ...reject, rejectNote: '' }));
    await assertFails(updateDoc(d1('alice'), { ...reject, rejectNote: 'x'.repeat(501) }));
    await assertFails(updateDoc(d1('alice'), { ...reject, rejectNote: 5 }));
    await assertSucceeds(updateDoc(d1('alice'), { ...reject, rejectNote: 'Photo is blurred, please send again' }));
  });
  it('refuses an unknown or missing status', async () => {
    await assertFails(updateDoc(d1('alice'), { status: 'paid' }));
    await assertFails(setDoc(doc(as('alice'), 'shops/s1/bills/n1'), { total: 1 }));
  });
  it('a reviewed bill accepts a later update that leaves the review time alone', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertSucceeds(updateDoc(d1('alice'), { imagePath: 'shops/s1/bills/d1.jpg' }));
    await assertFails(updateDoc(d1('alice'), { reviewedAt: new Date('2020-01-01') }));
  });
  it('the owner reopens a reviewed bill', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertSucceeds(updateDoc(d1('alice'), { status: 'draft', reviewedBy: deleteField(), reviewedAt: deleteField(), rejectNote: deleteField(), approvedWithFailedChecks: deleteField() }));
  });
  it('sub-project A writes still pass: create, field edit, photo path', async () => {
    const b = doc(as('alice'), 'shops/s1/bills/a1');
    await assertSucceeds(setDoc(b, { total: 118, status: 'manual_entry', checks: null, createdAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(b, { total: 120, checks: { total: true }, editedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(b, { imagePath: 'shops/s1/bills/a1.jpg' }));
  });
});

describe('a reviewed bill is locked', () => {
  const d1 = (uid: string) => doc(as(uid), 'shops/s1/bills/d1');
  const approve = (uid: string) => ({ status: 'approved', reviewedBy: uid, reviewedAt: serverTimestamp() });
  const reject = (uid: string, rejectNote = 'Photo is blurred') => ({ status: 'rejected', reviewedBy: uid, reviewedAt: serverTimestamp(), rejectNote });
  const reopen = { status: 'draft', reviewedBy: deleteField(), reviewedAt: deleteField(), rejectNote: deleteField(), approvedWithFailedChecks: deleteField() };

  it('approving a draft still passes', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
  });
  it('a full overwrite of an approved bill (Retry cloud) is refused', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertFails(setDoc(d1('alice'), { total: 118, status: 'draft', checks: null, createdAt: serverTimestamp() }));
  });
  it('a field edit of an approved bill is refused, with or without the review fields', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertFails(updateDoc(d1('alice'), { total: 200, checks: { total: true }, editedAt: serverTimestamp() }));
    await assertFails(updateDoc(d1('alice'), { ...approve('alice'), total: 200 }));
  });
  it('a field edit of a rejected bill is refused', async () => {
    await assertSucceeds(updateDoc(d1('alice'), reject('alice')));
    await assertFails(updateDoc(d1('alice'), { total: 200 }));
  });
  it('a rejected bill cannot be flipped straight to approved', async () => {
    await assertSucceeds(updateDoc(d1('alice'), reject('alice')));
    await assertFails(updateDoc(d1('alice'), { ...approve('alice'), rejectNote: deleteField() }));
    await assertFails(updateDoc(d1('alice'), { status: 'approved', rejectNote: deleteField() }));
  });
  it('an approved bill cannot be flipped straight to rejected', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertFails(updateDoc(d1('alice'), reject('alice')));
  });
  it('the late photo path still passes on an approved bill and on a draft', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'shops/s1/bills/d1'), { imagePath: 'shops/s1/bills/d1.jpg' }));
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertSucceeds(updateDoc(d1('alice'), { imagePath: 'shops/s1/bills/d1-2.jpg' }));
  });
  it('a reopen still passes from approved and from rejected, and only with review fields', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertFails(updateDoc(d1('alice'), { ...reopen, total: 200 }));
    await assertSucceeds(updateDoc(d1('alice'), reopen));
    await assertSucceeds(updateDoc(d1('alice'), reject('alice')));
    await assertSucceeds(updateDoc(d1('alice'), reopen));
  });
  it('after a reopen the fields can be edited again', async () => {
    await assertSucceeds(updateDoc(d1('alice'), approve('alice')));
    await assertSucceeds(updateDoc(d1('alice'), reopen));
    await assertSucceeds(updateDoc(d1('alice'), { total: 200, editedAt: serverTimestamp() }));
  });
  it('a long Devanagari reject note passes; 501 characters fail', async () => {
    await assertFails(updateDoc(d1('alice'), reject('alice', 'क'.repeat(501))));
    await assertSucceeds(updateDoc(d1('alice'), reject('alice', 'का'.repeat(200))));
  });
});

describe('shop owners and invites', () => {
  const CODE = 'ABCD2345';
  const alog = (uid: string, shopId: string, caUid: string) => ({ ...log(uid, shopId), caUid, platform: 'android' });
  const draftBill = (status: string) => ({ total: 118, status, createdAt: serverTimestamp() });
  const approveBy = (uid: string) => ({ status: 'approved', reviewedBy: uid, reviewedAt: serverTimestamp() });
  const reopen = { status: 'draft', reviewedBy: deleteField(), reviewedAt: deleteField(), rejectNote: deleteField(), approvedWithFailedChecks: deleteField() };

  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const f = c.firestore();
      await setDoc(doc(f, 'shops/s1'), { caUid: 'alice', shopName: 'A', gstin: '', state: '', storeImages: false, inviteCode: CODE });
      await setDoc(doc(f, `invites/${CODE}`), { shopId: 's1', caUid: 'alice', createdAt: new Date() });
      await setDoc(doc(f, 'shops/linked'), { caUid: 'alice', shopName: 'L', gstin: '', state: '', storeImages: true, ownerUid: 'ravi', inviteCode: 'WXYZ6789' });
      await setDoc(doc(f, 'shops/linked/bills/draft1'), { status: 'draft', total: 118 });
      await setDoc(doc(f, 'shops/linked/bills/appr1'), { status: 'approved', total: 118, reviewedBy: 'alice', reviewedAt: new Date('2026-11-01') });
      await setDoc(doc(f, 'shops/noinvite'), { caUid: 'alice', shopName: 'N', gstin: '', state: '', storeImages: false });
    });
  });

  it('a user creates themselves as owner but never as admin', async () => {
    await assertSucceeds(setDoc(doc(as('ravi2'), 'users/ravi2'), { role: 'owner' }));
    await assertFails(setDoc(doc(as('x'), 'users/x'), { role: 'admin' }));
    await assertFails(setDoc(doc(as('y'), 'users/y'), { role: 'superuser' }));
    await assertSucceeds(setDoc(doc(as('carol'), 'users/carol'), { role: 'ca' }));
  });
  it('an owner cannot promote themselves to admin or switch role', async () => {
    await assertSucceeds(setDoc(doc(as('ravi2'), 'users/ravi2'), { role: 'owner' }));
    await assertFails(updateDoc(doc(as('ravi2'), 'users/ravi2'), { role: 'admin' }));
    await assertFails(updateDoc(doc(as('ravi2'), 'users/ravi2'), { role: 'ca' }));
  });

  describe('invites', () => {
    it('any signed-in user reads one by id; listing and anonymous reads fail', async () => {
      await assertSucceeds(getDoc(doc(as('ravi2'), `invites/${CODE}`)));
      await assertFails(getDocs(collection(as('ravi2'), 'invites')));
      await assertFails(getDocs(collection(as('alice'), 'invites')));
      await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `invites/${CODE}`)));
    });
    it('an invite cannot be updated; only its CA deletes it', async () => {
      await assertFails(updateDoc(doc(as('alice'), `invites/${CODE}`), { shopId: 's1' }));
      await assertFails(deleteDoc(doc(as('bob'), `invites/${CODE}`)));
      await assertFails(deleteDoc(doc(as('ravi2'), `invites/${CODE}`)));
      await assertSucceeds(deleteDoc(doc(as('alice'), `invites/${CODE}`)));
    });
    it('the CA creates an invite for their own shop', async () => {
      await assertSucceeds(setDoc(doc(as('alice'), 'invites/QRSTUV23'), { shopId: 's1', caUid: 'alice', createdAt: serverTimestamp() }));
    });
    it('refuses another CA\'s shop, wrong caUid, extra keys, client time, missing shop and bad ids', async () => {
      const ok = { shopId: 's1', caUid: 'alice', createdAt: serverTimestamp() };
      await assertFails(setDoc(doc(as('alice'), 'invites/QRSTUV23'), { ...ok, shopId: 'bobshop' }));
      await assertFails(setDoc(doc(as('alice'), 'invites/QRSTUV23'), { ...ok, shopId: 'nope' }));
      await assertFails(setDoc(doc(as('bob'), 'invites/QRSTUV23'), ok));
      await assertFails(setDoc(doc(as('alice'), 'invites/QRSTUV23'), { ...ok, caUid: 'bob' }));
      await assertFails(setDoc(doc(as('alice'), 'invites/QRSTUV23'), { ...ok, extra: 1 }));
      await assertFails(setDoc(doc(as('alice'), 'invites/QRSTUV23'), { ...ok, createdAt: new Date() }));
      await assertFails(setDoc(doc(as('alice'), 'invites/QRSTUV23'), { shopId: 's1', caUid: 'alice' }));
      for (const id of ['SHORT', 'QRSTUV234', 'qrstuv23', 'QRSTUV0O', 'QRSTUV1I', 'QRSTUVL2', 'QRSTUV2-'])
        await assertFails(setDoc(doc(as('alice'), `invites/${id}`), ok));
    });
  });

  describe('linking an owner', () => {
    const s1 = (uid: string) => doc(as(uid), 'shops/s1');
    it('passes with the right code and own uid', async () => {
      await assertSucceeds(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE }));
      await assertSucceeds(getDoc(s1('ravi2')));
    });
    it('fails with a wrong code or no code', async () => {
      await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: 'ZZZZ2222' }));
      await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2' }));
    });
    it('fails when setting someone else as owner', async () => {
      await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'mallory', claimedWith: CODE }));
    });
    it('fails when any other field changes in the same write', async () => {
      await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE, shopName: 'Mine' }));
      await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE, caUid: 'ravi2' }));
      await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE, inviteCode: 'ZZZZ2222' }));
      await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE, storeImages: true }));
    });
    it('fails for a second link on a linked shop, by anyone', async () => {
      await assertSucceeds(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE }));
      await assertFails(updateDoc(s1('ravi3'), { ownerUid: 'ravi3', claimedWith: CODE }));
      await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE, x: 1 }));
      await assertFails(updateDoc(doc(as('ravi3'), 'shops/linked'), { ownerUid: 'ravi3', claimedWith: 'WXYZ6789' }));
    });
    it('fails on a shop that has no invite code', async () => {
      await assertFails(updateDoc(doc(as('ravi2'), 'shops/noinvite'), { ownerUid: 'ravi2', claimedWith: 'ABCD2345' }));
      await assertFails(updateDoc(doc(as('ravi2'), 'shops/noinvite'), { ownerUid: 'ravi2', claimedWith: null }));
    });
    it('does not let the link write be used by anonymous users or to create a shop', async () => {
      await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), 'shops/s1'), { ownerUid: 'x', claimedWith: CODE }));
      await assertFails(setDoc(doc(as('ravi2'), 'shops/new'), { ownerUid: 'ravi2', claimedWith: CODE }));
    });
    it('the CA can still update their own shop after the owner links, and cannot hand it to a stranger via caUid', async () => {
      await assertSucceeds(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE }));
      await assertSucceeds(updateDoc(s1('alice'), { shopName: 'Renamed' }));
      await assertFails(updateDoc(s1('alice'), { caUid: 'bob' }));
    });
  });

  describe('reading', () => {
    it('the owner reads their shop and its bills; others cannot', async () => {
      await assertSucceeds(getDoc(doc(as('ravi'), 'shops/linked')));
      await assertSucceeds(getDoc(doc(as('ravi'), 'shops/linked/bills/draft1')));
      await assertSucceeds(getDocs(collection(as('ravi'), 'shops/linked/bills')));
      await assertFails(getDoc(doc(as('other'), 'shops/linked')));
      await assertFails(getDoc(doc(as('other'), 'shops/linked/bills/draft1')));
      await assertFails(getDocs(collection(as('other'), 'shops/linked/bills')));
    });
    it('an owner cannot read a shop they do not own', async () => {
      await assertFails(getDoc(doc(as('ravi'), 'shops/s1')));
      await assertFails(getDoc(doc(as('ravi'), 'shops/bobshop')));
      await assertFails(getDoc(doc(as('ravi'), 'shops/s1/bills/d1')));
    });
    it('the owner finds their shop by ownerUid', async () => {
      await assertSucceeds(getDocs(query(collection(as('ravi'), 'shops'), where('ownerUid', '==', 'ravi'))));
      await assertFails(getDocs(collection(as('ravi'), 'shops')));
    });
    it('an owner cannot delete a bill or the shop, nor change the shop', async () => {
      await assertFails(deleteDoc(doc(as('ravi'), 'shops/linked/bills/draft1')));
      await assertFails(deleteDoc(doc(as('ravi'), 'shops/linked')));
      await assertFails(updateDoc(doc(as('ravi'), 'shops/linked'), { shopName: 'Mine' }));
      await assertFails(updateDoc(doc(as('ravi'), 'shops/linked'), { ownerUid: 'ravi', claimedWith: 'WXYZ6789' }));
    });
  });

  describe('owner bills', () => {
    const bill = (id: string, uid = 'ravi') => doc(as(uid), `shops/linked/bills/${id}`);
    it('creates draft and manual_entry bills', async () => {
      await assertSucceeds(setDoc(bill('n1'), draftBill('draft')));
      await assertSucceeds(setDoc(bill('n2'), draftBill('manual_entry')));
    });
    it('cannot create approved or rejected, or a bill with no or unknown status', async () => {
      await assertFails(setDoc(bill('n3'), { ...draftBill('approved'), reviewedBy: 'ravi', reviewedAt: serverTimestamp() }));
      await assertFails(setDoc(bill('n4'), { ...draftBill('rejected'), reviewedBy: 'ravi', reviewedAt: serverTimestamp(), rejectNote: 'x' }));
      await assertFails(setDoc(bill('n5'), { total: 1 }));
      await assertFails(setDoc(bill('n6'), draftBill('paid')));
    });
    it('cannot create a bill in a shop they do not own, nor can a stranger create in this one', async () => {
      await assertFails(setDoc(doc(as('ravi'), 'shops/s1/bills/n7'), draftBill('draft')));
      await assertFails(setDoc(bill('n8', 'other'), draftBill('draft')));
    });
    it('updates their draft, but cannot approve or reject it', async () => {
      await assertSucceeds(updateDoc(bill('draft1'), { total: 200, editedAt: serverTimestamp() }));
      await assertSucceeds(updateDoc(bill('draft1'), { status: 'manual_entry' }));
      await assertFails(updateDoc(bill('draft1'), approveBy('ravi')));
      await assertFails(updateDoc(bill('draft1'), { status: 'rejected', reviewedBy: 'ravi', reviewedAt: serverTimestamp(), rejectNote: 'no' }));
      await assertFails(updateDoc(bill('draft1'), approveBy('alice')));
    });
    it('cannot change an approved bill in any way, nor reopen it', async () => {
      await assertFails(updateDoc(bill('appr1'), { total: 5 }));
      await assertFails(updateDoc(bill('appr1'), { imagePath: 'shops/linked/bills/appr1.jpg' }));
      await assertFails(updateDoc(bill('appr1'), reopen));
      await assertFails(updateDoc(bill('appr1'), { status: 'draft' }));
      await assertFails(setDoc(bill('appr1'), draftBill('draft')));
    });
    it('a stranger cannot update a bill of this shop', async () => {
      await assertFails(updateDoc(bill('draft1', 'other'), { total: 1 }));
    });
  });

  describe('the CA on a linked shop', () => {
    const b = (id: string) => doc(as('alice'), `shops/linked/bills/${id}`);
    it('still approves, rejects, reopens and locks', async () => {
      await assertSucceeds(updateDoc(b('draft1'), approveBy('alice')));
      await assertFails(updateDoc(b('draft1'), { total: 9 }));
      await assertSucceeds(updateDoc(b('draft1'), reopen));
      await assertSucceeds(updateDoc(b('draft1'), { status: 'rejected', reviewedBy: 'alice', reviewedAt: serverTimestamp(), rejectNote: 'blurred' }));
      await assertSucceeds(updateDoc(b('draft1'), reopen));
      await assertSucceeds(updateDoc(b('appr1'), reopen));
      await assertSucceeds(deleteDoc(b('draft1')));
    });
    it('an owner bill draft can be approved by the CA', async () => {
      await assertSucceeds(setDoc(doc(as('ravi'), 'shops/linked/bills/o1'), draftBill('draft')));
      await assertSucceeds(updateDoc(b('o1'), approveBy('alice')));
    });
  });

  describe('route logs from Android', () => {
    it('passes from the owner with the shop\'s caUid', async () => {
      await assertSucceeds(setDoc(doc(as('ravi'), 'routeLogs/a1'), alog('ravi', 'linked', 'alice')));
    });
    it('fails with the owner as caUid, for an unowned shop, or with platform web', async () => {
      await assertFails(setDoc(doc(as('ravi'), 'routeLogs/a2'), alog('ravi', 'linked', 'ravi')));
      await assertFails(setDoc(doc(as('ravi'), 'routeLogs/a3'), alog('ravi', 's1', 'alice')));
      await assertFails(setDoc(doc(as('ravi'), 'routeLogs/a4'), { ...alog('ravi', 'linked', 'alice'), platform: 'web' }));
      await assertFails(setDoc(doc(as('ravi'), 'routeLogs/a5'), { ...alog('ravi', 'nope', 'alice'), shopId: 'nope' }));
      await assertFails(setDoc(doc(as('other'), 'routeLogs/a6'), alog('other', 'linked', 'alice')));
    });
    it('the CA cannot write an android log, and the owner cannot write a web log for a CA', async () => {
      await assertFails(setDoc(doc(as('alice'), 'routeLogs/a7'), alog('alice', 'linked', 'alice')));
      await assertFails(setDoc(doc(as('ravi'), 'routeLogs/a8'), { ...log('alice', 'linked'), platform: 'web' }));
    });
    it('the CA\'s web log still passes and the CA sees the owner\'s android log', async () => {
      await assertSucceeds(setDoc(doc(as('alice'), 'routeLogs/w1'), log('alice', 'linked')));
      await assertSucceeds(setDoc(doc(as('ravi'), 'routeLogs/a9'), alog('ravi', 'linked', 'alice')));
      await assertSucceeds(getDocs(query(collection(as('alice'), 'routeLogs'), where('caUid', '==', 'alice'))));
    });
    it('an owner cannot read route logs, including their own', async () => {
      await assertSucceeds(setDoc(doc(as('ravi'), 'routeLogs/a10'), alog('ravi', 'linked', 'alice')));
      await assertFails(getDoc(doc(as('ravi'), 'routeLogs/a10')));
      await assertFails(getDocs(collection(as('ravi'), 'routeLogs')));
    });
  });
});

describe('fix round 1: consent, expiry and review keys', () => {
  const CODE = 'ABCD2345';
  const s1 = (uid: string) => doc(as(uid), 'shops/s1');
  const rv = { reviewedBy: 'alice', reviewedAt: new Date('2020-01-01') };
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const f = c.firestore();
      await setDoc(doc(f, 'shops/s1'), { caUid: 'alice', shopName: 'A', gstin: '', state: '', storeImages: false, inviteCode: CODE });
      await setDoc(doc(f, `invites/${CODE}`), { shopId: 's1', caUid: 'alice', createdAt: new Date() });
      await setDoc(doc(f, 'invites/OLDD2345'), { shopId: 's1', caUid: 'alice', createdAt: new Date(Date.now() - 8 * 86400000) });
      await setDoc(doc(f, 'invites/OTHR2345'), { shopId: 'bobshop', caUid: 'bob', createdAt: new Date() });
      await setDoc(doc(f, 'shops/linked'), { caUid: 'alice', shopName: 'L', gstin: '', state: '', storeImages: true, ownerUid: 'ravi', claimedWith: 'WXYZ6789', inviteCode: 'WXYZ6789' });
      await setDoc(doc(f, 'shops/linked/bills/rej1'), { status: 'rejected', total: 1, reviewedBy: 'alice', reviewedAt: new Date('2026-11-01'), rejectNote: 'x' });
      await setDoc(doc(f, 'shops/linked/bills/draft1'), { status: 'draft', total: 118 });
    });
  });

  it('a shop cannot be created with an owner or a claim', async () => {
    const base = { caUid: 'mallory', shopName: 'X', gstin: '', state: '', storeImages: false };
    await assertSucceeds(setDoc(doc(as('mallory'), 'shops/m1'), base));
    await assertFails(setDoc(doc(as('mallory'), 'shops/m2'), { ...base, ownerUid: 'victim' }));
    await assertFails(setDoc(doc(as('mallory'), 'shops/m3'), { ...base, claimedWith: 'ABCD2345' }));
  });
  it('the CA cannot set or change an owner', async () => {
    await assertFails(updateDoc(s1('alice'), { ownerUid: 'victim' }));
    await assertFails(updateDoc(s1('alice'), { ownerUid: 'victim', claimedWith: CODE }));
    await assertFails(updateDoc(doc(as('alice'), 'shops/linked'), { ownerUid: 'victim' }));
    await assertFails(updateDoc(doc(as('alice'), 'shops/linked'), { claimedWith: 'AAAA2222' }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'shops/linked'), { shopName: 'Renamed' }));
  });
  it('the CA unlinks only by also removing or rotating the invite code', async () => {
    const l = doc(as('alice'), 'shops/linked');
    await assertFails(updateDoc(l, { ownerUid: deleteField(), claimedWith: deleteField() }));
    await assertFails(updateDoc(l, { ownerUid: deleteField() }));
    await assertSucceeds(updateDoc(l, { ownerUid: deleteField(), claimedWith: deleteField(), inviteCode: deleteField() }));
  });
  it('the CA unlinks with a rotated code, and the old code cannot link again', async () => {
    const l = doc(as('alice'), 'shops/linked');
    await assertSucceeds(updateDoc(l, { ownerUid: deleteField(), claimedWith: deleteField(), inviteCode: 'NEWW2345' }));
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'invites/WXYZ6789'), { shopId: 'linked', caUid: 'alice', createdAt: new Date() });
    });
    await assertFails(updateDoc(doc(as('ravi2'), 'shops/linked'), { ownerUid: 'ravi2', claimedWith: 'WXYZ6789' }));
  });
  it('an unlink on a shop with no code to change is refused', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'shops/noinv'), { ownerUid: deleteField() }));
  });

  it('linking needs an invite for this shop, no older than 7 days', async () => {
    await assertSucceeds(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: CODE }));
  });
  it('refuses an invite that points at another shop', async () => {
    await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), 'shops/s1'), { inviteCode: 'OTHR2345' }); });
    await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: 'OTHR2345' }));
  });
  it('refuses an invite older than 7 days', async () => {
    await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), 'shops/s1'), { inviteCode: 'OLDD2345' }); });
    await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: 'OLDD2345' }));
  });
  it('refuses a code with no invite document', async () => {
    await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), 'shops/s1'), { inviteCode: 'NONE2345' }); });
    await assertFails(updateDoc(s1('ravi2'), { ownerUid: 'ravi2', claimedWith: 'NONE2345' }));
  });

  it('an owner bill cannot carry review fields, on create or update', async () => {
    const b = (id: string) => doc(as('ravi'), `shops/linked/bills/${id}`);
    await assertFails(setDoc(b('n1'), { status: 'draft', total: 1, ...rv }));
    await assertFails(setDoc(b('n2'), { status: 'draft', total: 1, rejectNote: 'x' }));
    await assertFails(setDoc(b('n3'), { status: 'draft', total: 1, approvedWithFailedChecks: ['gstin'] }));
    await assertFails(updateDoc(b('draft1'), { reviewedAt: new Date('2020-01-01') }));
    await assertFails(updateDoc(b('draft1'), { reviewedBy: 'ravi' }));
    await assertFails(updateDoc(b('draft1'), { rejectNote: 'x' }));
    await assertSucceeds(updateDoc(b('draft1'), { total: 5 }));
  });
  it('the owner cannot change a rejected bill', async () => {
    const r = doc(as('ravi'), 'shops/linked/bills/rej1');
    await assertFails(updateDoc(r, { total: 9 }));
    await assertFails(updateDoc(r, { status: 'draft', reviewedBy: deleteField(), reviewedAt: deleteField(), rejectNote: deleteField() }));
    await assertFails(updateDoc(r, { imagePath: 'x' }));
  });
  it('the owner cannot create an invite', async () => {
    await assertFails(setDoc(doc(as('ravi'), 'invites/QRSTUV23'), { shopId: 'linked', caUid: 'ravi', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as('ravi'), 'invites/QRSTUV24'), { shopId: 'linked', caUid: 'alice', createdAt: serverTimestamp() }));
  });
  it('an id query on invites is denied; another CA cannot overwrite an invite', async () => {
    await assertFails(getDocs(query(collection(as('ravi2'), 'invites'), where(documentId(), '==', CODE))));
    await assertFails(setDoc(doc(as('bob'), `invites/${CODE}`), { shopId: 'bobshop', caUid: 'bob', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(as('alice'), `invites/${CODE}`), { shopId: 's1', caUid: 'alice', createdAt: serverTimestamp() }));
  });
  it('a stranger\'s full overwrite of a shop with link fields is denied', async () => {
    await assertFails(setDoc(s1('ravi2'), { caUid: 'alice', shopName: 'Hacked', gstin: '', state: '', storeImages: false, inviteCode: CODE, ownerUid: 'ravi2', claimedWith: CODE }));
    await assertFails(setDoc(s1('ravi2'), { caUid: 'ravi2', shopName: 'A', ownerUid: 'ravi2', claimedWith: CODE }));
  });
  it('another CA cannot read a linked shop or its bills', async () => {
    await assertFails(getDoc(doc(as('bob'), 'shops/linked')));
    await assertFails(getDoc(doc(as('bob'), 'shops/linked/bills/draft1')));
    await assertFails(getDocs(collection(as('bob'), 'shops/linked/bills')));
  });
});
