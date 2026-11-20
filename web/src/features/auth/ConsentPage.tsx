import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../../firebase';
import { recordConsent } from '../../adapters/store';
import { useAuth } from './AuthProvider';

export default function ConsentPage() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
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
      <div className="flex gap-3">
        <button className="px-5 py-3 rounded-lg bg-emerald-700 text-white"
          onClick={async () => { await recordConsent(user!.uid); await refresh(); nav('/shops'); }}>I agree</button>
        <button className="px-5 py-3 rounded-lg border" onClick={() => signOut(auth)}>Not now</button>
      </div>
    </main>
  );
}
