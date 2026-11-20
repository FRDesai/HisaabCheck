import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../../firebase';
import { ensureUser, type UserDoc } from '../../adapters/store';

type Ctx = { user: User | null; profile: UserDoc | null; loading: boolean; refresh(): Promise<void> };
const AuthCtx = createContext<Ctx>({ user: null, profile: null, loading: true, refresh: async () => {} });
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => { if (auth.currentUser) setProfile(await ensureUser(auth.currentUser)); };
  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u); setProfile(u ? await ensureUser(u) : null); setLoading(false);
  }), []);
  return <AuthCtx.Provider value={{ user, profile, loading, refresh }}>{children}</AuthCtx.Provider>;
}
