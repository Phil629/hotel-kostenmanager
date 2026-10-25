'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LogoutButton from './LogoutButton';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/transactions', label: 'Umsätze', icon: '💳' },
  { href: '/invoices', label: 'Rechnungen', icon: '📄' },
  { href: '/categories', label: 'Kategorien', icon: '🏷️' },
  { href: '/rules', label: 'Regeln', icon: '🧠' },
  { href: '/settings', label: 'Einstellungen', icon: '⚙️' },
];

export default function HeaderNav() {
  const pathname = usePathname();

  if (pathname === '/login') {
    return null;
  }

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800/80 sticky top-0 z-30 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-sm shadow-xs group-hover:bg-blue-500 transition-colors">
            🏨
          </div>
          <span className="font-bold text-sm tracking-tight text-white">
            Kostenmanager
          </span>
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href) || (item.href === '/settings' && pathname.startsWith('/reports'));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                }`}
              >
                <span className="text-xs leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
          <div className="pl-1.5 ml-1 border-l border-slate-800">
            <LogoutButton />
          </div>
        </nav>
      </div>
    </header>
  );
}
