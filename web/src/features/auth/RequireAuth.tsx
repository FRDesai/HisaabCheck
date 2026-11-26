import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import SignOutControl from './SignOutControl';
import { useAuth } from './AuthProvider';
import { CONSENT_VERSION } from '../../adapters/store';

export function RequireAuth({ children, consent = true }: { children: ReactNode; consent?: boolean }) {
  const { user, profile, loading, error, refresh } = useAuth();
  if (loading) return <p className="p-6">Loading…</p>;
  if (error) return (
    <div role="alert" className="p-6 space-y-3">
      <p className="text-red-700">{error}</p>
      <div className="flex gap-3">
        <button className="px-4 py-2 rounded-lg bg-emerald-700 text-white" onClick={() => void refresh()}>Try again</button>
        <SignOutControl className="px-4 py-2 rounded-lg border" />
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  if (consent && profile?.consentVersion !== CONSENT_VERSION) return <Navigate to="/consent" replace />;
  return <>{children}</>;
}
