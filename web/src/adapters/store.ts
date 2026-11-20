import type { User } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, limit } from 'firebase/firestore';
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
  await setDoc(r, { ...d, createdAt: serverTimestamp() });
  return d;
}
export const recordConsent = (uid: string) =>
  updateDoc(doc(db, 'users', uid), { consentVersion: CONSENT_VERSION, consentAt: serverTimestamp() });

export function watchShops(caUid: string, cb: (s: Shop[]) => void) {
  return onSnapshot(query(collection(db, 'shops'), where('caUid', '==', caUid)), (q) =>
    cb(q.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Shop, 'id'>) }))));
}
export async function createShop(caUid: string, s: Omit<Shop, 'id' | 'caUid'>) {
  return (await addDoc(collection(db, 'shops'), { ...s, caUid, createdAt: serverTimestamp() })).id;
}

export async function saveProcessedBill(shop: Shop, caUid: string, p: ProcessedBill): Promise<string> {
  const billRef = doc(collection(db, 'shops', shop.id, 'bills'));
  let imagePath: string | null = null;
  if (shop.storeImages && p.redactedImage) {
    imagePath = `shops/${shop.id}/bills/${billRef.id}.jpg`;
    await uploadBytes(ref(storage, imagePath), p.redactedImage, { contentType: 'image/jpeg' });
  }
  const batch = writeBatch(db);
  batch.set(billRef, {
    ...(p.extraction ?? {}), checks: p.checks, status: p.status, route: p.route,
    ...(imagePath ? { imagePath } : {}), createdAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'routeLogs')), toRouteLog(p, { billId: billRef.id, shopId: shop.id, caUid }, new Date()));
  void batch.commit(); // offline cache queues it; do not block the UI on the server ack
  return billRef.id;
}

export const updateBillFields = (shopId: string, billId: string, e: Extraction, checks: Checks) =>
  updateDoc(doc(db, 'shops', shopId, 'bills', billId), { ...e, checks, editedAt: serverTimestamp() });

export function watchRouteLogs(caUid: string, isAdmin: boolean, cb: (logs: RouteLogDoc[]) => void) {
  const base = collection(db, 'routeLogs');
  const q = isAdmin ? query(base, orderBy('createdAt', 'desc'), limit(1000))
                    : query(base, where('caUid', '==', caUid), orderBy('createdAt', 'desc'), limit(1000));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => d.data() as RouteLogDoc)));
}
