import { lazy, Suspense, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Navigate } from 'react-router-dom';
import { auth, USE_EMULATORS } from '../../firebase';
import { useAuth } from './AuthProvider';
// Dev-only test sign-in for the local emulators; `import.meta.env.DEV` is false in a production build, so it is not bundled.
const DevSignIn = import.meta.env.DEV && USE_EMULATORS ? lazy(() => import('../../dev/DevSignIn')) : null;

export default function LoginPage() {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  if (user) return <Navigate to="/shops" replace />;
  async function signIn() {
    setError(null);
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch { setError('Sign-in did not complete. Please try again.'); }
  }
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50">
      <div className="max-w-md text-center space-y-4 p-8">
        <h1 className="text-3xl font-bold">HisaabCheck</h1>
        <p className="text-slate-600">Bill photos to checked GST data. Private numbers are hidden on your computer before anything goes to the cloud.</p>
        <button className="px-6 py-3 rounded-lg bg-emerald-700 text-white text-lg" onClick={signIn}>
          Sign in with Google
        </button>
        {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
        {DevSignIn && <Suspense fallback={null}><DevSignIn /></Suspense>}
      </div>
    </main>
  );
}
