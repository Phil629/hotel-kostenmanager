'use client';

import { useRouter } from 'next/navigation';

export default function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
      router.refresh();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <button
      onClick={handleLogout}
      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/80 text-slate-300 hover:text-white text-xs font-semibold transition flex items-center gap-1 border border-slate-700"
      title="Vom Cloud-Kostenmanager abmelden"
    >
      <span>🔒 Logout</span>
    </button>
  );
}
