import type { Metadata } from 'next';
import './globals.css';
import HeaderNav from './components/HeaderNav';

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
        <HeaderNav />

        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {children}
        </main>

        <footer className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-400">
          <p>© 2026 Hotel-Kostenmanager • Effizientes Hotel- & Gastronomie-Finanzmanagement</p>
        </footer>
      </body>
    </html>
  );
}
