import { signOut } from 'firebase/auth';
import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from 'firebase/firestore';
import { auth, db } from './firebase';

/** The uid whose data the browser's offline cache may hold. Lives in localStorage so it outlives the tab. */
const CACHE_OWNER_KEY = 'hc.cacheUid';
/** sessionStorage: set just before the one automatic reload, so a second one is refused. */
const RELOADED_KEY = 'hc.cacheReloaded';
/** sessionStorage: a message for the login page after a sign-out the user did not ask for. */
const NOTICE_KEY = 'hc.loginNotice';

export const BLOCKED_NOTICE = 'Close other HisaabCheck tabs and try again. This browser still holds another account’s offline data.';
const PENDING_WAIT_MS = 5000;

function store(kind: 'local' | 'session'): Storage | null {
  try { return kind === 'local' ? localStorage : sessionStorage; } catch { return null; }
}
export function readCacheOwner(): string | null {
  try { return store('local')?.getItem(CACHE_OWNER_KEY) ?? null; } catch { return null; }
}
export function writeCacheOwner(uid: string): void {
  try { store('local')?.setItem(CACHE_OWNER_KEY, uid); } catch { /* the cache is then cleared on the next sign-in */ }
}
export function forgetCacheOwner(): void {
  try { store('local')?.removeItem(CACHE_OWNER_KEY); } catch { /* ignore */ }
}
export function hasReloadedForCache(): boolean {
  try { return store('session')?.getItem(RELOADED_KEY) === '1'; } catch { return false; }
}
export function markReloadedForCache(): void {
  try { store('session')?.setItem(RELOADED_KEY, '1'); } catch { /* ignore */ }
}
export function clearReloadedMark(): void {
  try { store('session')?.removeItem(RELOADED_KEY); } catch { /* ignore */ }
}
export function readLoginNotice(): string | null {
  try { return store('session')?.getItem(NOTICE_KEY) ?? null; } catch { return null; }
}
export function clearLoginNotice(): void {
  try { store('session')?.removeItem(NOTICE_KEY); } catch { /* ignore */ }
}
export function setLoginNotice(text: string): void {
  try { store('session')?.setItem(NOTICE_KEY, text); } catch { /* ignore */ }
}

/**
 * Stops Firestore and deletes its IndexedDB cache. A terminated instance cannot be used again, so the caller must
 * reload the page afterwards. Returns false when the cache could not be deleted (for example another tab holds it).
 */
export async function clearLocalCache(): Promise<boolean> {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
    return true;
  } catch {
    return false;
  }
}

/** True when every queued write reached the server within [ms]. Offline, queued writes never finish, so this times out. */
export async function pendingWritesSettled(ms = PENDING_WAIT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      waitForPendingWrites(db).then(() => true),
      new Promise<boolean>((r) => { timer = setTimeout(() => r(false), ms); }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The one way to sign out. Unless `force`, it first waits up to 5 seconds for queued offline changes to be sent; if
 * they are not, it does nothing and returns 'pending' so the caller can ask the user (wiping would lose them).
 * Otherwise: sign out, wipe the offline cache, then reload at the login page for a fresh Firestore.
 */
export async function signOutAndClear(force = false): Promise<'signed-out' | 'pending'> {
  if (!force && !(await pendingWritesSettled())) return 'pending';
  try { await signOut(auth); } catch { /* still wipe and reload */ }
  if (await clearLocalCache()) forgetCacheOwner(); // if it failed, the owner stays recorded so the next other user clears it
  window.location.assign('/login');
  return 'signed-out';
}
