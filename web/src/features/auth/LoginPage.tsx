import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Navigate } from 'react-router-dom';
import { auth } from '../../firebase';
import { useAuth } from './AuthProvider';

export default function LoginPage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/shops" replace />;
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50">
      <div className="max-w-md text-center space-y-4 p-8">
        <h1 className="text-3xl font-bold">HisaabCheck</h1>
        <p className="text-slate-600">Bill photos to checked GST data. Private numbers are hidden on your computer before anything goes to the cloud.</p>
        <button className="px-6 py-3 rounded-lg bg-emerald-700 text-white text-lg" onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
          Sign in with Google
        </button>
      </div>
    </main>
  );
}
