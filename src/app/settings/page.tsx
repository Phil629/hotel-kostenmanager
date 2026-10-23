'use client';

import { useState, useEffect } from 'react';

interface MonthOption {
  value: string;
  label: string;
}

export default function SettingsPage() {
  // General & Reports state
  const [hotelName, setHotelName] = useState('City Hotel Schottenhof');
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [autoSend, setAutoSend] = useState(true);

  // Gmail & Gemini AI state
  const [gmailUser, setGmailUser] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [gmailFolder, setGmailFolder] = useState('INBOX');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [hasEnvGeminiKey, setHasEnvGeminiKey] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [availableFolders, setAvailableFolders] = useState<Array<{ path: string; name: string }>>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  // Test report state
  const [availableMonths, setAvailableMonths] = useState<MonthOption[]>([]);
  const [selectedReportMonth, setSelectedReportMonth] = useState<string>('');
  const [testingDispatch, setTestingDispatch] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.settings) {
        setHotelName(data.settings.hotelName || 'City Hotel Schottenhof');
        setTelegramToken(data.settings.telegramToken || '');
        setTelegramChatId(data.settings.telegramChatId || '');
        setEmailAddress(data.settings.emailAddress || '');
        setAutoSend(data.settings.autoSendReports ?? true);
        setGmailUser(data.settings.gmailUser || '');
        setGmailAppPassword(data.settings.gmailAppPassword || '');
        setGmailFolder(data.settings.gmailFolder || 'INBOX');
        setGeminiApiKey(data.settings.geminiApiKey || '');
        setHasEnvGeminiKey(!!data.settings.hasEnvGeminiKey);
        setLastSyncAt(data.settings.lastGmailSyncAt || null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMonths = async () => {
    try {
      const res = await fetch('/api/transactions');
      const data = await res.json();
      if (data.availableMonths && data.availableMonths.length > 0) {
        setAvailableMonths(data.availableMonths);
        setSelectedReportMonth(data.availableMonths[0].value);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchMonths();
  }, []);

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelName: hotelName.trim() || 'City Hotel Schottenhof',
          telegramToken: telegramToken.trim(),
          telegramChatId: telegramChatId.trim(),
          emailAddress: emailAddress.trim(),
          autoSendReports: autoSend,
          gmailUser: gmailUser.trim(),
          gmailAppPassword: gmailAppPassword.replace(/\s+/g, ''),
          gmailFolder: gmailFolder.trim() || 'INBOX',
          geminiApiKey: geminiApiKey.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setStatusMsg({
          type: 'success',
          text: '✅ Alle Einstellungen (Gmail, Gemini KI & Monatsberichte) erfolgreich gespeichert!',
        });
      } else {
        setStatusMsg({ type: 'error', text: `❌ Fehler: ${data.error}` });
      }
    } catch (e: any) {
      setStatusMsg({ type: 'error', text: `❌ Fehler: ${e.message}` });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadGmailFolders = async () => {
    if (!gmailUser.trim() || !gmailAppPassword.trim()) {
      setStatusMsg({
        type: 'error',
        text: 'Bitte tragen Sie zuerst Ihre Gmail-Adresse und das 16-stellige Google App-Passwort ein.',
      });
      return;
    }
    setLoadingFolders(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/invoices/sync-gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'listFolders',
          gmailUser: gmailUser.trim(),
          gmailAppPassword: gmailAppPassword.replace(/\s+/g, ''),
        }),
      });
      const data = await res.json();
      if (data.success && data.folders) {
        setAvailableFolders(data.folders);
        setStatusMsg({
          type: 'success',
          text: `✅ Verbindung zu Gmail erfolgreich! ${data.folders.length} Ordner/Labels geladen – bitte wählen Sie Ihren Rechnungs-Ordner aus.`,
        });
      } else {
        setStatusMsg({
          type: 'error',
          text: `❌ ${data.error || 'Ordner konnten nicht geladen werden.'}`,
        });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `❌ Fehler: ${err.message}` });
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleTestDispatch = async (channel: 'telegram' | 'email') => {
    setTestingDispatch(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/reports/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, month: selectedReportMonth || 'all' }),
      });

      const data = await res.json();
      if (data.results?.telegram?.success) {
        setTestResult('🎉 Telegram-Monatsbericht wurde direkt an Ihr Smartphone gesendet!');
      } else if (data.results?.telegram?.error) {
        setTestResult(`❌ Telegram Fehler: ${data.results.telegram.error}`);
      } else if (data.results?.email?.success) {
        setTestResult(`✉️ ${data.results.email.message}`);
      } else {
        setTestResult('Berichtsversand ausgeführt.');
      }
    } catch (e: any) {
      setTestResult(`❌ Fehler beim Senden: ${e.message}`);
    } finally {
      setTestingDispatch(false);
    }
  };

  return (
    <form onSubmit={handleSaveAll} className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">⚙️ Einstellungen</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Zentrale Verwaltung für Ihren Gmail-Rechnungsordner, Gemini KI sowie automatische Monatsberichte per Telegram & E-Mail.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl transition shadow-xs shrink-0 cursor-pointer"
        >
          {saving ? 'Speichere...' : '💾 Alle Einstellungen speichern'}
        </button>
      </div>

      {statusMsg && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center justify-between ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {testResult && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-sm flex items-center justify-between">
          <span>{testResult}</span>
          <button
            type="button"
            onClick={() => setTestResult(null)}
            className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Section 1: Gmail & Gemini KI */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>📧</span> Gmail-Rechnungsordner & Gemini KI
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Lesezugriff auf Ihren DATEV-Ordner in Gmail und KI-Schlüssel für die automatische Beleg-Erkennung.
            </p>
          </div>
          {lastSyncAt && (
            <span className="text-xs text-slate-400">
              Letzter Gmail-Sync: {new Date(lastSyncAt).toLocaleString('de-DE')}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Gmail Box */}
          <div className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200/70">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900">1. Gmail-Verbindung (IMAP)</h3>
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 font-semibold hover:underline"
              >
                🔑 Google App-Passwort erstellen ↗
              </a>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Ihre Gmail-Adresse</label>
              <input
                type="email"
                placeholder="z.B. philippe@hotelschottenhof.de"
                value={gmailUser}
                onChange={(e) => setGmailUser(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Google App-Passwort (16-stellig)
              </label>
              <input
                type="password"
                placeholder="xxxx xxxx xxxx xxxx"
                value={gmailAppPassword}
                onChange={(e) => setGmailAppPassword(e.target.value)}
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm font-mono"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Gmail-Ordner / Label mit den Rechnungen
                </label>
                <button
                  type="button"
                  onClick={handleLoadGmailFolders}
                  disabled={loadingFolders}
                  className="text-xs text-blue-600 font-bold hover:underline cursor-pointer"
                >
                  {loadingFolders ? 'Lade Ordner...' : '📂 Ordner aus Gmail laden'}
                </button>
              </div>

              {availableFolders.length > 0 ? (
                <select
                  value={gmailFolder}
                  onChange={(e) => setGmailFolder(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-blue-300 rounded-xl text-sm font-semibold text-slate-800"
                >
                  {availableFolders.map((f) => (
                    <option key={f.path} value={f.path}>
                      📁 {f.name} ({f.path})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="z.B. Bestellwesen/Zu_versenden"
                  value={gmailFolder}
                  onChange={(e) => setGmailFolder(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                />
              )}
            </div>
          </div>

          {/* Gemini AI Key Box */}
          <div className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200/70 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-900">2. Google Gemini KI-Schlüssel</h3>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 font-semibold hover:underline"
                >
                  ✨ Kostenlosen Gemini-Key holen ↗
                </a>
              </div>

              <div className="text-xs text-slate-600 bg-white p-3.5 rounded-lg border border-slate-200/80 space-y-1.5">
                <p className="font-semibold text-slate-800">Automatische Beleg- & Kategorien-Analyse:</p>
                <p>
                  • Liest PDF-Rechnungen und HTML-Bestellmails aus und ordnet sie offenen Bankumsätzen zu.
                </p>
                <p>
                  • Bereits zugeordnete Umsätze sowie die Kategorie <b>„Sonstiges“</b> werden von der KI strikt ignoriert.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Gemini API-Key {hasEnvGeminiKey ? '(in Server-Umgebung aktiv)' : ''}
                </label>
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm font-mono"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
              <span>
                Status:{' '}
                {geminiApiKey || hasEnvGeminiKey ? (
                  <b className="text-emerald-600">✅ KI-Schlüssel hinterlegt</b>
                ) : (
                  <b className="text-amber-600">⚠️ Noch kein Key hinterlegt</b>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Monatsberichte (Telegram & E-Mail) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span>📱</span> Monatsberichte & Benachrichtigungen (Telegram & E-Mail)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Empfänger und Zugangsdaten für den monatlichen Ausgabenbericht Ihres Hotels.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Hotel- / Betriebsname</label>
              <input
                type="text"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ✉️ E-Mail-Adresse für Monatsbericht
              </label>
              <input
                type="email"
                placeholder="philippe@hotelschottenhof.de"
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">
              ✈️ Telegram Bot Konfiguration
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Telegram Bot Token (@BotFather)</label>
                <input
                  type="password"
                  placeholder="123456789:ABCdef..."
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Telegram Chat-ID (Handy / Gruppe)
                </label>
                <input
                  type="text"
                  placeholder="z.B. 987654321"
                  value={telegramChatId}
                  onChange={(e) => setTelegramChatId(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSend}
                onChange={(e) => setAutoSend(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600"
              />
              <span className="text-sm text-slate-700 font-medium">
                Automatischen Versand am 1. jedes Monats aktivieren
              </span>
            </label>

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm rounded-xl transition shadow-xs cursor-pointer"
            >
              {saving ? 'Speichere...' : '💾 Einstellungen speichern'}
            </button>
          </div>
        </div>

        {/* Test Dispatch Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <h3 className="text-base font-bold text-slate-900">🧪 Monatsbericht sofort senden</h3>
            <p className="text-xs text-slate-500">
              Wählen Sie einen Zeitraum aus, um den Ausgabenbericht direkt an Telegram oder per E-Mail zu senden:
            </p>

            <select
              value={selectedReportMonth}
              onChange={(e) => setSelectedReportMonth(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
            >
              {availableMonths.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2.5 pt-2">
            <button
              type="button"
              onClick={() => handleTestDispatch('telegram')}
              disabled={testingDispatch || !telegramToken}
              className="w-full px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-xs disabled:opacity-50 cursor-pointer"
            >
              ✈️ Jetzt an Telegram-Bot senden
            </button>

            <button
              type="button"
              onClick={() => handleTestDispatch('email')}
              disabled={testingDispatch}
              className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs sm:text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              ✉️ Jetzt per E-Mail senden
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
