import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
const AccuracyPage = import.meta.env.DEV ? lazy(() => import('./dev/accuracy/AccuracyPage')) : null;
export default function App() {
  return (
    <BrowserRouter><Suspense fallback={null}><Routes>
      {AccuracyPage && <Route path="/dev/accuracy" element={<AccuracyPage />} />}
      <Route path="*" element={<p className="p-6">HisaabCheck</p>} />
    </Routes></Suspense></BrowserRouter>
  );
}
