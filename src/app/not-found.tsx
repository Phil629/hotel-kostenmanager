import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="text-5xl">🔍</div>
      <h2 className="text-2xl font-bold text-slate-900">Seite nicht gefunden (404)</h2>
      <p className="text-slate-500 text-sm max-w-md">
        Die angeforderte Adresse existiert nicht. Bitte nutzen Sie das Navigationsmenü oben.
      </p>
      <div className="pt-2">
        <Link
          href="/"
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition shadow-xs inline-flex items-center gap-2"
        >
          🏠 Zurück zum Hauptdashboard
        </Link>
      </div>
    </div>
  );
}
