import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ set: vi.fn(), update: vi.fn(), commit: vi.fn() }));
vi.mock('../../src/firebase', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...p: string[]) => ({ id: p[p.length - 1], path: p.join('/') }),
  serverTimestamp: () => 'TS',
  writeBatch: () => ({ set: m.set, update: m.update, commit: m.commit }),
  collection: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), deleteField: vi.fn(),
  addDoc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), onSnapshot: vi.fn(), getDocsFromServer: vi.fn(), getCountFromServer: vi.fn(),
}));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));

import { createInvite, type Shop } from '../../src/adapters/store';

const shop: Shop = { id: 's1', caUid: 'alice', shopName: 'A', gstin: '', state: '', storeImages: false };

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.commit.mockResolvedValue(undefined);
});

describe('createInvite', () => {
  it('writes the invite and the shop code in one batch and returns the code', async () => {
    const code = await createInvite(shop, 'alice');
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(m.set).toHaveBeenCalledTimes(1);
    const [iref, idata] = m.set.mock.calls[0];
    expect(iref.path).toBe(`invites/${code}`);
    expect(idata).toEqual({ shopId: 's1', caUid: 'alice', createdAt: 'TS' });
    expect(m.update).toHaveBeenCalledTimes(1);
    const [sref, sdata] = m.update.mock.calls[0];
    expect(sref.path).toBe('shops/s1');
    expect(sdata).toEqual({ inviteCode: code });
    expect(m.commit).toHaveBeenCalledTimes(1);
  });
  it('draws random bytes again until a code comes out', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues')
      .mockImplementationOnce((a) => { (a as Uint8Array).fill(255); return a; })
      .mockImplementationOnce((a) => { (a as Uint8Array).set([0, 1, 2, 3, 4, 5, 6, 7]); return a; });
    expect(await createInvite(shop, 'alice')).toBe('ABCDEFGH');
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it('passes a refusal on to the caller', async () => {
    m.commit.mockRejectedValue(new Error('denied'));
    await expect(createInvite(shop, 'alice')).rejects.toThrow('denied');
  });
});
