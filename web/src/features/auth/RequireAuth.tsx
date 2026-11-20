import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { CONSENT_VERSION } from '../../adapters/store';

export function RequireAuth({ children, consent = true }: { children: ReactNode; consent?: boolean }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <p className="p-6">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (consent && profile?.consentVersion !== CONSENT_VERSION) return <Navigate to="/consent" replace />;
  return <>{children}</>;
}
