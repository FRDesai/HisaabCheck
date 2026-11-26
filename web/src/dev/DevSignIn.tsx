import { useState } from 'react';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../firebase';

/**
 * Emulator mode only (LoginPage loads this only when USE_EMULATORS, which is false in any production build).
 * The Auth emulator accepts an unsigned Google ID token, so this signs in as a fake Google user without a popup.
 */
const TEST_CAS = [
  { label: 'Sign in as test CA', sub: 'test-ca-1', email: 'test-ca-1@example.com', name: 'Test CA One' },
  { label: 'Sign in as second test CA', sub: 'test-ca-2', email: 'test-ca-2@example.com', name: 'Test CA Two' },
];

export default function DevSignIn() {
  const [error, setError] = useState<string | null>(null);
  async function signIn(t: (typeof TEST_CAS)[number]) {
    setError(null);
    const token = JSON.stringify({ sub: t.sub, email: t.email, email_verified: true, name: t.name });
    try { await signInWithCredential(auth, GoogleAuthProvider.credential(token)); }
    catch (e) { setError(`Test sign-in failed: ${(e as Error).message}`); }
  }
  return (
    <div className="border border-dashed border-amber-500 rounded-lg p-3 space-y-2 text-sm">
      <p className="text-amber-800">Emulator mode (development only)</p>
      {TEST_CAS.map((t) => (
        <button key={t.sub} className="block w-full px-4 py-2 rounded border" onClick={() => void signIn(t)}>{t.label}</button>
      ))}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  );
}
