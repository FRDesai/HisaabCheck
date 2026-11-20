import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './features/auth/AuthProvider';
import { RequireAuth } from './features/auth/RequireAuth';
import LoginPage from './features/auth/LoginPage';
import ConsentPage from './features/auth/ConsentPage';
import Layout from './features/Layout';
import ShopsPage from './features/shops/ShopsPage';
import UploadPage from './features/upload/UploadPage';
import DashboardPage from './features/dashboard/DashboardPage';
const AccuracyPage = import.meta.env.DEV ? lazy(() => import('./dev/accuracy/AccuracyPage')) : null;

export default function App() {
  return (
    <AuthProvider><BrowserRouter><Suspense fallback={null}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/consent" element={<RequireAuth consent={false}><ConsentPage /></RequireAuth>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/shops" element={<ShopsPage />} />
        <Route path="/shops/:shopId/upload" element={<UploadPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Route>
      {AccuracyPage && <Route path="/dev/accuracy" element={<AccuracyPage />} />}
      <Route path="*" element={<Navigate to="/shops" replace />} />
    </Routes></Suspense></BrowserRouter></AuthProvider>
  );
}
