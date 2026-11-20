import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../firebase';
import { ensureUser, type UserDoc } from '../../adapters/store';

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
