import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from '../../firebase';
import { ensureUser, type UserDoc } from '../../adapters/store';
import { cacheActionOnSignIn } from '../../core/session/cacheOwner';
import { BLOCKED_NOTICE, clearLocalCache, clearReloadedMark, forgetCacheOwner, hasReloadedForCache, markReloadedForCache, readCacheOwner, setLoginNotice, writeCacheOwner } from '../../session';

type Ctx = { user: User | null; profile: UserDoc | null; loading: boolean; error: string | null; refresh(): Promise<void> };
const AuthCtx = createContext<Ctx>({ user: null, profile: null, loading: true, error: null, refresh: async () => {} });
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthCtx);

const LOAD_ERROR = 'Could not load your account. Check your connection and try again.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const u = auth.currentUser;
    if (!u) return;
    setError(null); setLoading(true);
    try { setProfile(await ensureUser(u)); setUser(u); }
    catch { setError(LOAD_ERROR); }
    finally { setLoading(false); }
  };

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    if (!u) { setUser(null); setProfile(null); setError(null); setLoading(false); return; }
    setLoading(true); setError(null);
    // Before anything reads Firestore: the offline cache must not hold another user's data (for example after a
    // sign-out that did not go through signOutAndClear, such as a revoked token).
    const action = cacheActionOnSignIn(readCacheOwner(), u.uid, hasReloadedForCache());
    if (action === 'clear' || action === 'blocked') {
      if (action === 'clear' && await clearLocalCache()) {
        forgetCacheOwner(); // so a failed write below cannot leave the old uid behind to loop on
        writeCacheOwner(u.uid);
        markReloadedForCache(); // the reload may happen once; a second need ends in the message below
        window.location.reload();
      } else {
        setLoginNotice(BLOCKED_NOTICE);
        try { await signOut(auth); } catch { /* go to login anyway */ }
        window.location.assign('/login');
      }
      return; // stay on "Loading" until the page reloads
    }
    clearReloadedMark();
    if (action === 'record') writeCacheOwner(u.uid);
    try {
      const prof = await ensureUser(u);
      setUser(u); setProfile(prof); // together, so the consent check never sees a user without a profile
    } catch {
      setUser(u); setProfile(null); setError(LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }), []);

  return <AuthCtx.Provider value={{ user, profile, loading, error, refresh }}>{children}</AuthCtx.Provider>;
}
