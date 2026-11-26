import type { User } from 'firebase/auth';
import { addDoc, collection, deleteField, doc, getCountFromServer, getDoc, getDocsFromServer, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where, limit, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import type { Checks, Extraction, ProcessedBill } from '../core/types';
import { toRouteLog, type RouteLogDoc } from '../core/router/routeLog';
import { inviteCode } from '../core/invite/code';
import { toBillDoc, type BillDoc } from '../core/review/billDoc';

export const CONSENT_VERSION = '2026-11-v1';
export type UserDoc = { role: 'ca' | 'admin'; name: string; email: string; consentVersion?: string };
export type Shop = { id: string; caUid: string; shopName: string; gstin: string; state: string; storeImages: boolean; inviteCode?: string; ownerUid?: string };

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
    // merge, and only role + consent fields: if the local read was stale and the doc exists on the server, this
    // overwrites none of its other fields (createdAt, name, email) and cannot change its role (rules refuse that).
    await setDoc(r, { role: 'ca', ...consent }, { merge: true });
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

/** A new invite code for the shop's owner: the invite document and the shop's code are written together. */
export async function createInvite(shop: Shop, caUid: string): Promise<string> {
  let code: string | null = null;
  while (code === null) code = inviteCode(crypto.getRandomValues(new Uint8Array(16)));
  const batch = writeBatch(db);
  batch.set(doc(db, 'invites', code), { shopId: shop.id, caUid, createdAt: serverTimestamp() });
  batch.update(doc(db, 'shops', shop.id), { inviteCode: code });
  await batch.commit();
  return code;
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

// ---- Sub-project B: inbox, review, export ----

export const BILL_PAGE = 300;
// A bill written offline has no server time yet; 'estimate' gives the local time so it still sorts and shows.
const SNAP = { serverTimestamps: 'estimate' } as const;
const billsCol = (shopId: string) => collection(db, 'shops', shopId, 'bills');
const billRef = (shopId: string, billId: string) => doc(db, 'shops', shopId, 'bills', billId);

export function watchShop(shopId: string, cb: (shop: Shop | null) => void, onError: (e: Error) => void) {
  return onSnapshot(doc(db, 'shops', shopId),
    (s) => cb(s.exists() ? ({ id: s.id, ...(s.data() as Omit<Shop, 'id'>) }) : null), onError);
}

/** Newest bills of a shop, live. Filters run in the browser (core/review/filters). */
export function watchBills(shopId: string, max: number, cb: (bills: BillDoc[]) => void, onError: (e: Error) => void) {
  return onSnapshot(query(billsCol(shopId), orderBy('createdAt', 'desc'), limit(max)),
    (s) => cb(s.docs.map((d) => toBillDoc(d.id, d.data(SNAP)))), onError);
}

export function watchBill(shopId: string, billId: string, cb: (bill: BillDoc | null) => void, onError: (e: Error) => void) {
  return onSnapshot(billRef(shopId, billId), (s) => cb(s.exists() ? toBillDoc(s.id, s.data(SNAP)) : null), onError);
}

export async function countToReview(shopId: string): Promise<number> {
  const s = await getCountFromServer(query(billsCol(shopId), where('status', 'in', ['draft', 'manual_entry'])));
  return s.data().count;
}

/**
 * One-off read for export: every bill dated from..to, any status. Not capped by the inbox page size.
 * From the server only: offline, getDocs would answer from whatever this browser has cached and the export
 * would be silently partial; this fails instead.
 */
export async function fetchBillsByInvoiceDate(shopId: string, from: string, to: string): Promise<BillDoc[]> {
  const s = await getDocsFromServer(query(billsCol(shopId), where('invoiceDate', '>=', from), where('invoiceDate', '<=', to), orderBy('invoiceDate')));
  return s.docs.map((d) => toBillDoc(d.id, d.data(SNAP)));
}

/** Bill fields for an update: no undefined values; absent line items are removed from the stored bill. */
function billFields(e: Extraction) {
  const { items, itemCount, ...rest } = e;
  return { ...rest, items: items ?? deleteField(), ...(itemCount === undefined ? {} : { itemCount }) };
}

export const saveReviewFields = (shopId: string, billId: string, e: Extraction, checks: Checks) =>
  updateDoc(billRef(shopId, billId), { ...billFields(e), checks, editedAt: serverTimestamp() });

/** Fields and approval in one write, so what is approved is exactly what was on screen. */
export const approveBill = (shopId: string, billId: string, uid: string, e: Extraction, checks: Checks, failed: string[]) =>
  updateDoc(billRef(shopId, billId), {
    ...billFields(e), checks, status: 'approved', reviewedBy: uid, reviewedAt: serverTimestamp(), rejectNote: deleteField(),
    approvedWithFailedChecks: failed.length > 0 ? failed : deleteField(), editedAt: serverTimestamp(),
  });

export const rejectBill = (shopId: string, billId: string, uid: string, note: string) =>
  updateDoc(billRef(shopId, billId), {
    status: 'rejected', reviewedBy: uid, reviewedAt: serverTimestamp(), rejectNote: note.trim(), approvedWithFailedChecks: deleteField(),
  });

export const reopenBill = (shopId: string, billId: string) =>
  updateDoc(billRef(shopId, billId), {
    status: 'draft', reviewedBy: deleteField(), reviewedAt: deleteField(), rejectNote: deleteField(), approvedWithFailedChecks: deleteField(),
  });

/** Download URL of the stored (redacted) bill photo. Storage rules allow it only for the shop's CA. */
export const billImageUrl = (imagePath: string) => getDownloadURL(ref(storage, imagePath));
