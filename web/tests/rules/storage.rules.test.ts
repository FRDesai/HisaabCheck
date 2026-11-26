import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

let env: RulesTestEnvironment;
const rules = (f: string) => readFileSync(join(__dirname, '../../../firebase', f), 'utf8');
const jpeg = { contentType: 'image/jpeg' };
const small = new Uint8Array([1, 2, 3]);
const P = (shop: string, file = 'b1.jpg') => `shops/${shop}/bills/${file}`;
// clearStorage does not reliably empty the emulator, so every test that creates an object uses a name of its own.
let n = 0;
const fresh = () => `f${Date.now()}-${n++}.jpg`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-hisaabcheck',
    firestore: { rules: rules('firestore.rules'), host: '127.0.0.1', port: 8080 },
    storage: { rules: rules('storage.rules'), host: '127.0.0.1', port: 9199 },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (c) => {
    const f = c.firestore();
    await setDoc(doc(f, 'shops/img'), { caUid: 'alice', ownerUid: 'ravi', storeImages: true });
    await setDoc(doc(f, 'shops/noimg'), { caUid: 'alice', ownerUid: 'ravi', storeImages: false });
    await setDoc(doc(f, 'shops/bobimg'), { caUid: 'bob', storeImages: true });
    await uploadBytes(ref(c.storage(), P('img', 'old.jpg')), small, jpeg);
    await uploadBytes(ref(c.storage(), P('noimg', 'old.jpg')), small, jpeg);
  });
});
const st = (uid: string) => env.authenticatedContext(uid).storage();

describe('storage rules', () => {
  it('the CA reads, uploads and deletes for their own shop', async () => {
    await assertSucceeds(getBytes(ref(st('alice'), P('img', 'old.jpg'))));
    await assertSucceeds(uploadBytes(ref(st('alice'), P('img', fresh())), small, jpeg));
    // Not tested here: a CA replacing a stored photo. The emulator evaluates every upload as `create`, so it cannot
    // reach the `update` rule (see report); in production a replacement is an `update`, which is the CA's.
    await assertSucceeds(deleteObject(ref(st('alice'), P('img', 'old.jpg'))));
  });
  it('the CA cannot upload when storeImages is false', async () => {
    await assertFails(uploadBytes(ref(st('alice'), P('noimg', fresh())), small, jpeg));
  });
  it('the owner reads and creates a new object when storeImages is true', async () => {
    await assertSucceeds(getBytes(ref(st('ravi'), P('img', 'old.jpg'))));
    await assertSucceeds(uploadBytes(ref(st('ravi'), P('img', fresh())), small, jpeg));
  });
  it('the owner cannot create when storeImages is false', async () => {
    await assertFails(uploadBytes(ref(st('ravi'), P('noimg', fresh())), small, jpeg));
  });
  it('the owner cannot overwrite an existing object or delete one', async () => {
    await assertFails(uploadBytes(ref(st('ravi'), P('img', 'old.jpg')), small, jpeg));
    await assertFails(deleteObject(ref(st('ravi'), P('img', 'old.jpg'))));
  });
  it('a stranger and another CA can do nothing', async () => {
    for (const u of ['stranger', 'bob']) {
      await assertFails(getBytes(ref(st(u), P('img', 'old.jpg'))));
      await assertFails(uploadBytes(ref(st(u), P('img', fresh())), small, jpeg));
      await assertFails(uploadBytes(ref(st(u), P('img', 'old.jpg')), small, jpeg));
      await assertFails(deleteObject(ref(st(u), P('img', 'old.jpg'))));
    }
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), P('img', 'old.jpg'))));
  });
  it('refuses the wrong content type and files of 3 MB or more', async () => {
    await assertFails(uploadBytes(ref(st('alice'), P('img', fresh())), small, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(st('ravi'), P('img', fresh())), small, { contentType: 'image/png' }));
    await assertFails(uploadBytes(ref(st('alice'), P('img', fresh())), new Uint8Array(3 * 1024 * 1024), jpeg));
    await assertSucceeds(uploadBytes(ref(st('alice'), P('img', fresh())), new Uint8Array(3 * 1024 * 1024 - 1), jpeg));
  });
});
