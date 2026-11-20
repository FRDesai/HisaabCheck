import type { User } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, limit } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Checks, Extraction, ProcessedBill } from '../core/types';
import { toRouteLog, type RouteLogDoc } from '../core/router/routeLog';

export const CONSENT_VERSION = '2026-11-v1';
export type UserDoc = { role: 'ca' | 'admin'; name: string; email: string; consentVersion?: string };
export type Shop = { id: string; caUid: string; shopName: string; gstin: string; state: string; storeImages: boolean };

export async function ensureUser(u: User): Promise<UserDoc> {
  const r = doc(db, 'users', u.uid);
  const snap = await getDoc(r);
  if (snap.exists()) return snap.data() as UserDoc;
  const d: UserDoc = { role: 'ca', name: u.displayName ?? '', email: u.email ?? '' };
  // Do not wait for the server ack: the persistent cache queues the write offline.
  setDoc(r, { ...d, createdAt: serverTimestamp() }).catch(() => {});
  return d;
}
export async function recordConsent(u: Pick<User, 'uid' | 'displayName' | 'email'>): Promise<void> {
  const r = doc(db, 'users', u.uid);
  const snap = await getDoc(r);
  const consent = { consentVersion: CONSENT_VERSION, consentAt: serverTimestamp() };
  if (!snap.exists()) {
    // ensureUser's create was refused or lost: create the doc now (always as 'ca'; rules allow nothing else).
    // merge: if the doc does exist on the server after all, this cannot change its role (rules refuse a role change).
    const d: UserDoc = { role: 'ca', name: u.displayName ?? '', email: u.email ?? '' };
    await setDoc(r, { ...d, ...consent, createdAt: serverTimestamp() }, { merge: true });
    return;
  }
  if (snap.data().consentVersion === CONSENT_VERSION) return; // keep the original consent time
  await updateDoc(r, consent); // never touches role
}

export function watchShops(caUid: string, cb: (s: Shop[]) => void) {
  return onSnapshot(query(collection(db, 'shops'), where('caUid', '==', caUid)), (q) =>
    cb(q.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Shop, 'id'>) }))));
}
export async function createShop(caUid: string, s: Omit<Shop, 'id' | 'caUid'>) {
  return (await addDoc(collection(db, 'shops'), { ...s, caUid, createdAt: serverTimestamp() })).id;
}

export type SavedBill = { billId: string; synced: Promise<void>; photo: Promise<'stored' | 'skipped' | 'failed'> };

export function saveProcessedBill(shop: Shop, caUid: string, p: ProcessedBill, billId?: string): SavedBill {
  // billId given = re-save of an existing bill (same doc, no duplicate); otherwise a fresh auto-id.
  const billRef = billId ? doc(db, 'shops', shop.id, 'bills', billId) : doc(collection(db, 'shops', shop.id, 'bills'));
  // Bill first. Not awaited here: the offline cache queues it; `synced` settles on server ack/refusal.
  const synced = setDoc(billRef, {
    ...(p.extraction ?? {}), checks: p.checks, status: p.status, route: p.route, createdAt: serverTimestamp(),
  });
  synced.catch(() => {}); // callers may ignore `synced`; avoid an unhandled rejection
  // Route log is best-effort telemetry (counts/types only) and never affects the bill.
  try {
    // createdAt is the server's clock (rules require request.time); toRouteLog stays pure and its Date is replaced here.
    const log = { ...toRouteLog(p, { billId: billRef.id, shopId: shop.id, caUid }, new Date()), createdAt: serverTimestamp() };
    setDoc(doc(collection(db, 'routeLogs')), log).catch(() => {});
  } catch { /* telemetry only */ }

  let photo: Promise<'stored' | 'skipped' | 'failed'> = Promise.resolve('skipped');
  if (shop.storeImages && p.redactedImage) {
    const imagePath = `shops/${shop.id}/bills/${billRef.id}.jpg`;
    const blob = p.redactedImage; // redacted image only
    photo = (async () => {
      try {
        await uploadBytes(ref(storage, imagePath), blob, { contentType: 'image/jpeg' });
        await updateDoc(billRef, { imagePath });
        return 'stored' as const;
      } catch {
        return 'failed' as const;
      }
    })();
  }
  return { billId: billRef.id, synced, photo };
}

export const updateBillFields = (shopId: string, billId: string, e: Extraction, checks: Checks) =>
  updateDoc(doc(db, 'shops', shopId, 'bills', billId), { ...e, checks, editedAt: serverTimestamp() });

export const ROUTE_LOG_LIMIT = 1000;
export function watchRouteLogs(caUid: string, isAdmin: boolean, cb: (logs: RouteLogDoc[]) => void, onError?: (e: Error) => void) {
  const base = collection(db, 'routeLogs');
  const q = isAdmin ? query(base, orderBy('createdAt', 'desc'), limit(ROUTE_LOG_LIMIT))
                    : query(base, where('caUid', '==', caUid), orderBy('createdAt', 'desc'), limit(ROUTE_LOG_LIMIT));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => d.data() as RouteLogDoc)), (e) => onError?.(e));
}
