import { NavLink, Outlet } from 'react-router-dom';
import { signOutAndClear } from '../session';

export default function Layout() {
  const link = ({ isActive }: { isActive: boolean }) => `px-3 py-2 rounded ${isActive ? 'bg-emerald-100 text-emerald-900' : ''}`;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-2 px-6 py-3 bg-white border-b">
        <span className="font-bold mr-4">HisaabCheck</span>
        <NavLink to="/shops" className={link}>Shops</NavLink>
        <NavLink to="/dashboard" className={link}>Routing</NavLink>
        <button className="ml-auto text-sm underline" onClick={() => void signOutAndClear()}>Sign out</button>
      </header>
      <main className="p-6"><Outlet /></main>
    </div>
  );
}
