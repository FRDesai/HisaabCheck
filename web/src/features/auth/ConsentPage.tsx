import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import { CONSENT_VERSION, recordConsent } from '../../adapters/store';
import { useAuth } from './AuthProvider';

export default function ConsentPage() {
  const { user, profile, refresh } = useAuth();
  const nav = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (profile?.consentVersion === CONSENT_VERSION) return <Navigate to="/shops" replace />;

  async function agree() {
    setSaving(true); setError(null);
    try { await recordConsent(user!.uid); await refresh(); nav('/shops'); }
    catch { setError('Could not save your consent. Please try again.'); setSaving(false); }
  }
  return (
    <main className="max-w-xl mx-auto p-8 space-y-4">
      <h1 className="text-2xl font-bold">Before you start</h1>
      <p>HisaabCheck processes bill photos you upload to extract supplier, invoice and tax details for your clients.</p>
      <ul className="list-disc pl-6 space-y-1 text-slate-700">
        <li>Bills are read on this computer when possible.</li>
        <li>If a bill needs the cloud, PAN, Aadhaar, phone and bank numbers are blacked out first.</li>
        <li>Photos are not stored unless you turn that on for a shop. Data is kept in India (Mumbai).</li>
        <li>You can withdraw consent by signing out and asking us to delete your data.</li>
      </ul>
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button disabled={saving} className="px-5 py-3 rounded-lg bg-emerald-700 text-white disabled:opacity-60" onClick={agree}>
          {saving ? 'Saving…' : 'I agree'}</button>
        <button className="px-5 py-3 rounded-lg border" onClick={() => signOut(auth)}>Not now</button>
      </div>
    </main>
  );
}
