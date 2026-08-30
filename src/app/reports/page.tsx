'use client';

import { useState, useEffect } from 'react';

interface MonthOption {
  value: string;
  label: string;
}

export default function ReportsPage() {
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [hotelName, setHotelName] = useState('City Hotel Schottenhof');
  const [autoSend, setAutoSend] = useState(true);

  const [availableMonths, setAvailableMonths] = useState<MonthOption[]>([]);
  const [selectedReportMonth, setSelectedReportMonth] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [testingTelegram, setTestingTelegram] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.settings) {
        setTelegramToken(data.settings.telegramToken || '');
        setTelegramChatId(data.settings.telegramChatId || '');
        setEmailAddress(data.settings.emailAddress || '');
        setHotelName(data.settings.hotelName || 'City Hotel Schottenhof');
        setAutoSend(data.settings.autoSendReports ?? true);
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

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramToken,
          telegramChatId,
          emailAddress,
          hotelName,
          autoSendReports: autoSend,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setStatusMsg('✅ Einstellungen erfolgreich gespeichert!');
      } else {
        setStatusMsg(`❌ Fehler: ${data.error}`);
      }
    } catch (e: any) {
      setStatusMsg(`❌ Fehler: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTestDispatch = async (channel: 'telegram' | 'email' | 'all') => {
    setTestingTelegram(true);
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
        setTestResult('Berichtsversand simuliert.');
      }
    } catch (e: any) {
      setTestResult(`❌ Fehler beim Senden: ${e.message}`);
    } finally {
      setTestingTelegram(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">📱 Automatische Monatsberichte (E-Mail & Telegram)</h1>
        <p className="text-slate-500 text-sm mt-1">
          Richten Sie den automatischen Versand Ihrer monatlichen Ausgabenübersicht und Kennzahlen per Telegram Bot oder E-Mail ein.
        </p>
      </div>

      {statusMsg && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm flex items-center justify-between">
          <span>{statusMsg}</span>
          <button onClick={() => setStatusMsg(null)} className="text-slate-400 hover:text-slate-600 font-bold">
            ✕
          </button>
        </div>
      )}

      {testResult && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between">
          <span>{testResult}</span>
          <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-slate-600 font-bold">
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Settings Form */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3">⚙️ Empfänger & Benachrichtigungen</h3>

          <form onSubmit={handleSaveSettings} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Hotel- / Betriebsname</label>
              <input
                type="text"
                value={hotelName}
                onChange={(e) => setHotelName(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="pt-2 border-t border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">
                <span className="text-blue-600">✈️</span> Telegram Bot Konfiguration
              </h4>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Telegram Bot Token</label>
                  <input
                    type="password"
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ..."
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Erhalten Sie kostenlos in Telegram über <b>@BotFather</b></p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Telegram Chat-ID (Ihr Handy / Ihre Gruppe)</label>
                  <input
                    type="text"
                    placeholder="z.B. 987654321"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-3">
                <span className="text-blue-600">✉️</span> E-Mail Empfänger
              </h4>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">E-Mail-Adresse für Monatsbericht</label>
                <input
                  type="email"
                  placeholder="hotelier@schottenhof.de"
                  value={emailAddress}
                  onChange={(e) => setEmailAddress(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <label className="flex items-center gap-3 cursor-pointer">
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
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition shadow-xs"
              >
                {saving ? 'Speichere...' : 'Einstellungen speichern'}
              </button>
            </div>
          </form>
        </div>

        {/* Live Preview & Instant Test */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-slate-900">🧪 Sofort-Testversand</h3>
            <p className="text-xs text-slate-500">
              Wählen Sie den Monat aus, für den der Bericht versendet werden soll:
            </p>

            <select
              value={selectedReportMonth}
              onChange={(e) => setSelectedReportMonth(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500"
            >
              {availableMonths.map((m) => (
                <option key={m.value} value={m.value}>
                  📅 {m.label}
                </option>
              ))}
            </select>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => handleTestDispatch('telegram')}
                disabled={testingTelegram || !telegramToken}
                className="w-full px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-xs disabled:opacity-50"
              >
                ✈️ An Telegram-Bot senden
              </button>

              <button
                onClick={() => handleTestDispatch('email')}
                disabled={testingTelegram}
                className="w-full px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-semibold text-sm rounded-xl transition flex items-center justify-center gap-2 shadow-xs"
              >
                ✉️ Per E-Mail senden (PDF Simu)
              </button>
            </div>
          </div>

          {/* Telegram Preview Box */}
          <div className="bg-slate-900 text-slate-100 p-5 rounded-2xl border border-slate-800 shadow-lg font-sans space-y-3 text-xs leading-relaxed">
            <div className="flex items-center justify-between text-slate-400 pb-2 border-b border-slate-800">
              <span className="font-semibold text-slate-300">Vorschau: Telegram Nachricht</span>
              <span>Telegram Bot</span>
            </div>

            <div>
              <p className="font-bold text-sm text-white">🏨 Monatsbericht: {hotelName}</p>
              <p className="text-slate-400">📅 Ausgabenbericht</p>
            </div>

            <div>
              <p className="font-semibold text-emerald-400">💸 Gesamtausgaben der Periode erfasst</p>
            </div>

            <div className="space-y-1 text-slate-300">
              <p className="font-semibold text-slate-200">📊 Haupt-Kostenblöcke:</p>
              <p>• <b>Personal & Löhne:</b> Gehälter & Aushilfen</p>
              <p>• <b>OTA Provisionen:</b> Booking.com, Travelscape</p>
              <p>• <b>F&B Wareneinsatz:</b> METRO, Schwälbchen</p>
              <p>• <b>Energie:</b> Mainzer Fernwärme & EVM</p>
            </div>

            <div className="pt-2 border-t border-slate-800 text-slate-400 text-[11px]">
              <p>⚡ <i>Berechnet vom Hotel-Kostenmanager</i></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
