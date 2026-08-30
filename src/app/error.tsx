'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Router Error:', error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
      <div className="text-4xl">⚠️</div>
      <h2 className="text-xl font-bold text-slate-900">Ein unerwarteter Fehler ist aufgetreten</h2>
      <p className="text-slate-500 text-sm max-w-md">
        {error.message || 'Die Seite konnte nicht geladen werden.'}
      </p>
      <div className="flex gap-3 pt-2">
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition shadow-xs"
        >
          🔄 Erneut versuchen
        </button>
        <button
          onClick={() => (window.location.href = '/')}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl transition"
        >
          🏠 Zum Dashboard
        </button>
      </div>
    </div>
  );
}
