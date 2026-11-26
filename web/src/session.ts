import { signOut } from 'firebase/auth';
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore';
import { auth, db } from './firebase';

/** The uid whose data the browser's offline cache may hold. Lives in localStorage so it outlives the tab. */
const CACHE_OWNER_KEY = 'hc.cacheUid';

export function readCacheOwner(): string | null {
  try { return localStorage.getItem(CACHE_OWNER_KEY); } catch { return null; }
}
export function writeCacheOwner(uid: string): void {
  try { localStorage.setItem(CACHE_OWNER_KEY, uid); } catch { /* the cache is then cleared on the next sign-in */ }
}
function forgetCacheOwner(): void {
  try { localStorage.removeItem(CACHE_OWNER_KEY); } catch { /* ignore */ }
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

/** The one way to sign out: sign out, wipe the offline cache, then reload at the login page for a fresh Firestore. */
export async function signOutAndClear(): Promise<void> {
  try { await signOut(auth); } catch { /* still wipe and reload */ }
  if (await clearLocalCache()) forgetCacheOwner(); // if it failed, the owner stays recorded so the next other user clears it
  window.location.assign('/login');
}
