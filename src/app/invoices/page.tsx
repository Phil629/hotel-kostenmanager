'use client';

import { useState, useEffect, useRef } from 'react';

interface Category {
  id: string;
  name: string;
  color: string;
}

interface MatchedTx {
  id: string;
  date: string;
  amount: number;
  payee: string | null;
  description: string;
  category?: Category | null;
}

interface InvoiceItem {
  id: string;
  source: string;
  fileName: string;
  emailSubject: string | null;
  emailFrom: string | null;
  emailDate: string | null;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  grossAmount: number | null;
  itemsSummary: string | null;
  paymentMethod: string | null;
  suggestedCategoryId: string | null;
  suggestedCategory: Category | null;
  matchedTransactionId: string | null;
  matchedTransaction: MatchedTx | null;
  status: string;
  confidence: number;
  createdAt: string;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [gmailUser, setGmailUser] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [gmailFolder, setGmailFolder] = useState('INBOX');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [hasEnvGeminiKey, setHasEnvGeminiKey] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [availableFolders, setAvailableFolders] = useState<Array<{ path: string; name: string }>>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Sync & Upload state
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [invRes, catRes, setRes] = await Promise.all([
        fetch('/api/invoices'),
        fetch('/api/categories'),
        fetch('/api/settings'),
      ]);
      const invData = await invRes.json();
      const catData = await catRes.json();
      const setData = await setRes.json();

      setInvoices(invData.invoices || []);
      setCategories(catData.categories || []);

      if (setData.settings) {
        setGmailUser(setData.settings.gmailUser || '');
        setGmailAppPassword(setData.settings.gmailAppPassword || '');
        setGmailFolder(setData.settings.gmailFolder || 'INBOX');
        setGeminiApiKey(setData.settings.geminiApiKey || '');
        setHasEnvGeminiKey(!!setData.settings.hasEnvGeminiKey);
        setLastSyncAt(setData.settings.lastGmailSyncAt || null);

        // Einstellungen automatisch aufklappen, wenn noch kein Gmail-Konto hinterlegt ist
        if (!setData.settings.gmailUser && !silent) {
          setShowSettings(true);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll(false);
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
          text: '✅ Zugangsdaten (Gmail-Ordner & Gemini KI-Key) erfolgreich gespeichert!',
        });
      } else {
        setStatusMsg({ type: 'error', text: `❌ Fehler: ${data.error}` });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `❌ Fehler: ${err.message}` });
    } finally {
      setSavingSettings(false);
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
          text: `✅ Verbindung zu Gmail erfolgreich! ${data.folders.length} Ordner/Labels gefunden – bitte wählen Sie Ihren Rechnungs-Ordner aus.`,
        });
      } else {
        setStatusMsg({ type: 'error', text: `❌ ${data.error || 'Ordner konnten nicht geladen werden.'}` });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `❌ Fehler: ${err.message}` });
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleSyncGmailNow = async () => {
    setSyncingGmail(true);
    setStatusMsg({
      type: 'info',
      text: '🔄 Verbinde mit Gmail-Ordner, lese neue Rechnungen per KI aus und gleiche Beträge mit Bankumsätzen ab...',
    });
    try {
      const res = await fetch('/api/invoices/sync-gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxMessages: 30 }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg({
          type: 'success',
          text: `✅ Gmail-Sync abgeschlossen (${data.scannedEmails} Mails geprüft): ${data.newInvoicesCount} neue Rechnung(en) erkannt, ${data.matchedCount} direkt einem Bankumsatz zugeordnet (${data.autoCategorizedCount} automatisch kategorisiert)!`,
        });
        fetchAll(true);
      } else {
        setStatusMsg({ type: 'error', text: `❌ ${data.error}` });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `❌ Fehler beim Gmail-Abruf: ${err.message}` });
    } finally {
      setSyncingGmail(false);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadingPdf(true);
    setStatusMsg({
      type: 'info',
      text: `🔄 Analysiere ${files.length} PDF-Rechnung(en) mit KI und suche passende Bankumsätze...`,
    });

    const formData = new FormData();
    for (const f of Array.from(files)) {
      formData.append('files', f);
    }

    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg({
          type: 'success',
          text: `✅ ${data.importedCount} PDF-Rechnung(en) ausgelesen: ${data.matchedCount} direkt mit Bankumsätzen verknüpft (${data.autoCategorizedCount} automatisch kategorisiert)!`,
        });
        fetchAll(true);
      } else {
        setStatusMsg({ type: 'error', text: `❌ Fehler: ${data.error}` });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `❌ Upload-Fehler: ${err.message}` });
    } finally {
      setUploadingPdf(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRematchPending = async () => {
    setRematching(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rematch' }),
      });
      const data = await res.json();
      if (data.success) {
        setStatusMsg({
          type: 'success',
          text: `✅ Abgleich durchgeführt (${data.checkedCount} offene Belege geprüft): ${data.matchedCount} neu zugeordnet!`,
        });
        fetchAll(true);
      }
    } finally {
      setRematching(false);
    }
  };

  const handleChangeInvoiceCategory = async (invoiceId: string, categoryId: string) => {
    const targetCat = categories.find((c) => c.id === categoryId) || null;
    setInvoices((prev) =>
      prev.map((inv) =>
        inv.id === invoiceId ? { ...inv, suggestedCategoryId: categoryId, suggestedCategory: targetCat } : inv
      )
    );

    await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateCategory', invoiceId, categoryId }),
    });
    fetchAll(true);
  };

  const handleDeleteInvoice = async (id: string) => {
    setInvoices((prev) => prev.filter((i) => i.id !== id));
    await fetch(`/api/invoices?id=${id}`, { method: 'DELETE' });
  };

  const formatEuro = (num: number | null) => {
    if (num === null || num === undefined) return '–';
    return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  const matchedCount = invoices.filter((i) => i.status === 'MATCHED').length;
  const pendingCount = invoices.filter((i) => i.status === 'PENDING').length;

  return (
    <div className="space-y-8">
      {/* Header & Main Actions */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            📄 Rechnungs-KI & Gmail-Belegabgleich
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Liest Rechnungen aus Ihrem DATEV-Gmail-Ordner (oder per PDF-Upload) per KI aus und ordnet offene PayPal- & Bankumsätze automatisch zu.
          </p>
          {lastSyncAt && (
            <p className="text-xs text-slate-400 mt-1">
              Letzter Gmail-Abruf: {new Date(lastSyncAt).toLocaleString('de-DE')} • Ordner: <b>{gmailFolder}</b>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleSyncGmailNow}
            disabled={syncingGmail}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {syncingGmail ? '🔄 Synchronisiere Gmail...' : '📧 Gmail-Ordner jetzt abrufen'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handlePdfUpload}
            className="hidden"
            id="invoice-pdf-upload"
          />
          <label
            htmlFor="invoice-pdf-upload"
            className={`px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer ${
              uploadingPdf ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            {uploadingPdf ? '🔄 Lese PDF...' : '📥 PDF-Rechnung hochladen'}
          </label>

          <button
            type="button"
            onClick={() => setShowSettings((prev) => !prev)}
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold rounded-xl transition cursor-pointer"
          >
            ⚙️ {showSettings ? 'Einstellungen schließen' : 'Gmail & KI einrichten'}
          </button>
        </div>
      </div>

      {/* Status Notification */}
      {statusMsg && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center justify-between ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : statusMsg.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button onClick={() => setStatusMsg(null)} className="font-bold opacity-60 hover:opacity-100 cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Collapsible Setup Card for Gmail IMAP + Gemini API Key */}
      {showSettings && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-slate-900">⚙️ Einmalige Einrichtung: Gmail-Ordner & Gemini KI</h2>
            <p className="text-xs text-slate-500 mt-1">
              Ihre Zugangsdaten werden geschützt in Ihrer Datenbank gespeichert. Das Programm greift ausschließlich lesend auf Ihren angegebenen Rechnungs-Ordner zu.
            </p>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Gmail Setup */}
              <div className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200/70">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900">1. Gmail-Verbindung (Ihr DATEV-Ordner)</h3>
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 font-semibold hover:underline"
                  >
                    🔑 Google App-Passwort erstellen ↗
                  </a>
                </div>

                <div className="text-xs text-slate-600 bg-white p-3 rounded-lg border border-slate-200/80 space-y-1">
                  <p className="font-semibold text-slate-800">So funktioniert der Lesezugriff in 30 Sekunden:</p>
                  <p>1. Klicken Sie oben rechts auf <b>„Google App-Passwort erstellen“</b>.</p>
                  <p>2. Geben Sie als Name z. B. <i>„Kostenmanager“</i> ein und kopieren Sie den 16-stelligen Code.</p>
                  <p>3. Klicken Sie unten auf <b>„📂 Ordner aus Gmail laden“</b> und wählen Sie Ihren DATEV-Ordner.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Ihre Gmail-Adresse</label>
                  <input
                    type="email"
                    placeholder="z.B. hotel.schottenhof@gmail.com"
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
                      placeholder="z.B. DATEV oder Rechnungen oder INBOX"
                      value={gmailFolder}
                      onChange={(e) => setGmailFolder(e.target.value)}
                      className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                    />
                  )}
                </div>
              </div>

              {/* Right Column: Gemini AI Key */}
              <div className="space-y-4 bg-slate-50 p-5 rounded-xl border border-slate-200/70 flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm text-slate-900">2. Google Gemini KI-Schlüssel (Kostenlos)</h3>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 font-semibold hover:underline"
                    >
                      ✨ Kostenlosen Gemini-Key holen ↗
                    </a>
                  </div>

                  <div className="text-xs text-slate-600 bg-white p-3 rounded-lg border border-slate-200/80 space-y-1">
                    <p className="font-semibold text-slate-800">Warum ein Gemini API-Key?</p>
                    <p>
                      • Mit Gemini 2.0 Flash liest die KI jede PDF-Rechnung (auch eingescannte Belege) wie ein Mensch und erkennt sofort Artikel wie <i>„20 Kartons Klopapier → Reinigung & Hygiene“</i>.
                    </p>
                    <p>• Der Schlüssel ist bei Google AI Studio <b>kostenlos</b> (bis zu 1.500 Belege pro Tag gratis).</p>
                    <p>• Auch ohne Key ist bereits eine automatische Text- & Stichworterkennung aktiv.</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Gemini API-Key {hasEnvGeminiKey ? '(bereits in Server-Umgebung aktiv)' : ''}
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

                <div className="flex justify-end pt-4 border-t border-slate-200/70">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl shadow-xs transition cursor-pointer"
                  >
                    {savingSettings ? 'Speichere...' : '💾 Einstellungen speichern'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* KPI Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-slate-500">Erfasste Rechnungsbelege</div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{invoices.length}</div>
          <div className="text-xs text-slate-400 mt-1">Aus Gmail-Ordner & PDF-Upload</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div className="text-xs font-semibold text-emerald-700">✅ Automatisch mit Bankumsatz verknüpft</div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">{matchedCount}</div>
          <div className="text-xs text-slate-400 mt-1">Umsatz gefunden & Kategorie zugewiesen</div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
          <div>
            <div className="text-xs font-semibold text-amber-700">⏳ Wartend auf Kontoauszug</div>
            <div className="text-2xl font-bold text-amber-600 mt-2">{pendingCount}</div>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-slate-400">Wird beim nächsten Auszug-Upload abgeglichen</span>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={handleRematchPending}
                disabled={rematching}
                className="text-xs text-blue-600 font-bold hover:underline cursor-pointer"
              >
                {rematching ? 'Prüfe...' : '🔄 Jetzt prüfen'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Ausgelesene Rechnungen & Beleg-Zuordnungen</h3>
            <p className="text-xs text-slate-500">
              Jede Rechnung wird anhand von Bruttobetrag, Rechnungsdatum, Rechnungsnummer und Zahlungsart (z. B. PayPal) mit Ihren Bankumsätzen verknüpft.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Lade Rechnungsbelege...</div>
        ) : invoices.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-4xl">📄</div>
            <div className="text-base font-bold text-slate-800">Noch keine Rechnungen eingelesen</div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Laden Sie oben rechts testweise eine PDF-Rechnung hoch oder verbinden Sie Ihren Gmail-Ordner, um Belege automatisch mit Ihren offenen Bankumsätzen abzugleichen.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200 font-semibold tracking-wider">
                <tr>
                  <th className="px-5 py-3">Datum & Quelle</th>
                  <th className="px-5 py-3">Lieferant / Händler</th>
                  <th className="px-5 py-3">Gekaufte Artikel (KI-Inhalt)</th>
                  <th className="px-5 py-3">Bruttobetrag</th>
                  <th className="px-5 py-3">Erkannte Kategorie</th>
                  <th className="px-5 py-3">Verknüpfter Bankumsatz</th>
                  <th className="px-4 py-3 text-right">Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => {
                  const displayDate = inv.invoiceDate || inv.emailDate || inv.createdAt;
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-5 py-4 whitespace-nowrap text-xs">
                        <div className="font-mono text-slate-700 font-semibold">
                          {new Date(displayDate).toLocaleDateString('de-DE')}
                        </div>
                        <span className="inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600">
                          {inv.source === 'GMAIL' ? '📧 Gmail' : '📄 PDF-Upload'}
                        </span>
                      </td>

                      <td className="px-5 py-4">
                        <div className="font-bold text-slate-900">{inv.vendorName || 'Unbekannter Aussteller'}</div>
                        <div className="text-xs text-slate-400 truncate max-w-[200px]" title={inv.fileName}>
                          {inv.invoiceNumber ? `Rechnungs-Nr.: ${inv.invoiceNumber}` : inv.fileName}
                        </div>
                        {inv.paymentMethod && (
                          <span className="inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700">
                            💳 {inv.paymentMethod}
                          </span>
                        )}
                      </td>

                      <td className="px-5 py-4 max-w-xs text-xs text-slate-700">
                        <div className="font-medium">{inv.itemsSummary || '–'}</div>
                        {inv.emailSubject && (
                          <div className="text-[11px] text-slate-400 truncate mt-0.5" title={inv.emailSubject}>
                            Betreff: {inv.emailSubject}
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap font-extrabold text-slate-900 tabular-nums">
                        {formatEuro(inv.grossAmount)}
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap">
                        <select
                          value={inv.suggestedCategoryId || ''}
                          onChange={(e) => handleChangeInvoiceCategory(inv.id, e.target.value)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer"
                          style={{
                            backgroundColor: inv.suggestedCategory ? `${inv.suggestedCategory.color}15` : '#f8fafc',
                            color: inv.suggestedCategory ? inv.suggestedCategory.color : '#475569',
                            borderColor: inv.suggestedCategory ? `${inv.suggestedCategory.color}40` : '#e2e8f0',
                          }}
                        >
                          <option value="">Kategorie wählen...</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-5 py-4 text-xs">
                        {inv.matchedTransaction ? (
                          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-900 space-y-0.5">
                            <div className="font-bold flex items-center gap-1.5">
                              <span>✅ Zugeordnet:</span>
                              <span>{inv.matchedTransaction.payee || 'Bankumsatz'}</span>
                            </div>
                            <div className="text-[11px] text-emerald-700">
                              {formatEuro(inv.matchedTransaction.amount)} am{' '}
                              {new Date(inv.matchedTransaction.date).toLocaleDateString('de-DE')}
                            </div>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200/70 text-amber-800 font-medium">
                            <span>⏳ Wartet auf passenden Bankumsatz ({formatEuro(inv.grossAmount)})</span>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleDeleteInvoice(inv.id)}
                          className="text-slate-400 hover:text-red-600 text-xs font-semibold px-2 py-1 rounded-lg hover:bg-red-50 transition cursor-pointer"
                          title="Beleg-Eintrag entfernen"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
