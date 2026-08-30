import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import LogoutButton from './components/LogoutButton';

export const metadata: Metadata = {
  title: 'Hotel-Kostenmanager | Intelligente Ausgaben-Erfassung & Statistik',
  description: 'Automatische Kategorisierung von Kontoauszügen, Lernfunktion für Lieferanten, Visuelle Statistiken & Telegram/E-Mail Berichte für Ihr Hotel.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="bg-slate-50 text-slate-900 min-h-screen flex flex-col font-sans">
        <header className="bg-slate-900 text-white shadow-md border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-blue-500/30">
                🏨
              </div>
              <div>
                <span className="font-bold text-lg tracking-tight block">Hotel-Kostenmanager</span>
                <span className="text-xs text-slate-400 font-medium">Parkhotel & Restaurant</span>
              </div>
            </div>

            <nav className="flex items-center space-x-1 sm:space-x-3 text-sm font-medium">
              <Link
                href="/"
                className="px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                📊 Dashboard
              </Link>
              <Link
                href="/transactions"
                className="px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                💳 Umsätze & Import
              </Link>
              <Link
                href="/categories"
                className="px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                🏷️ Kategorien
              </Link>
              <Link
                href="/rules"
                className="px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                🧠 Regelsystem
              </Link>
              <Link
                href="/reports"
                className="px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5"
              >
                📱 Monatsberichte
              </Link>
              <LogoutButton />
            </nav>
          </div>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500">
          <p>© 2026 Hotel-Kostenmanager • Entworfen für effizientes Hotel- & Gastronomie-Finanzmanagement</p>
        </footer>
      </body>
    </html>
  );
}
