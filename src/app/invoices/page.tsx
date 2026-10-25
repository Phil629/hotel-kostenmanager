'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';

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

  // Settings info
  const [gmailFolder, setGmailFolder] = useState('INBOX');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  // Sync & Upload state
  const [syncingGmail, setSyncingGmail] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'MATCHED'>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Edit Modal state
  const [editingInvoice, setEditingInvoice] = useState<InvoiceItem | null>(null);
  const [editVendor, setEditVendor] = useState('');
  const [editInvoiceNumber, setEditInvoiceNumber] = useState('');
  const [editInvoiceDate, setEditInvoiceDate] = useState('');
  const [editGrossAmount, setEditGrossAmount] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState('');
  const [editItemsSummary, setEditItemsSummary] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

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
        setGmailFolder(setData.settings.gmailFolder || 'INBOX');
        setLastSyncAt(setData.settings.lastGmailSyncAt || null);
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

  const handleSyncGmailNow = async () => {
    setSyncingGmail(true);
    setStatusMsg({
      type: 'info',
      text: '🔄 Verbinde mit Gmail-Ordner, prüfe alle noch nicht gelesenen E-Mails und analysiere Rechnungen per KI...',
    });

    let totalScanned = 0;
    let totalNewInvoices = 0;
    let totalMatched = 0;
    let totalAutoCategorized = 0;

    try {
      let hasMore = true;
      let safetyLoops = 0;

      while (hasMore && safetyLoops < 30) {
        safetyLoops++;
        const res = await fetch('/api/invoices/sync-gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchSize: 8 }),
        });
        const data = await res.json();

        if (!data.success) {
          setStatusMsg({ type: 'error', text: `❌ ${data.error}` });
          return;
        }

        totalScanned += data.scannedEmails || 0;
        totalNewInvoices += data.newInvoicesCount || 0;
        totalMatched += data.matchedCount || 0;
        totalAutoCategorized += data.autoCategorizedCount || 0;

        fetchAll(true);

        const remaining = Number(data.remainingUnseenCount || 0);
        if (remaining > 0 && (data.scannedEmails || 0) > 0) {
          setStatusMsg({
            type: 'info',
            text: `🔄 Lade alle Rechnungen aus Gmail... (${totalScanned} geprüft, ${totalNewInvoices} Rechnung(en) erkannt – noch ${remaining} E-Mail(s) im Ordner offen...)`,
          });
          hasMore = true;
        } else {
          hasMore = false;
        }
      }

      if (totalScanned === 0) {
        setStatusMsg({
          type: 'success',
          text: '✅ Ihr Gmail-Ordner ist bereits komplett synchronisiert – keine neuen ungelesenen E-Mails vorhanden!',
        });
      } else {
        setStatusMsg({
          type: 'success',
          text: `✅ Gmail-Sync abgeschlossen (${totalScanned} neue Mails geprüft): ${totalNewInvoices} neue Rechnung(en) geladen, ${totalMatched} direkt einem offenen Bankumsatz zugeordnet (${totalAutoCategorized} automatisch kategorisiert)!`,
        });
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

  const openEditModal = (inv: InvoiceItem) => {
    setEditingInvoice(inv);
    setEditVendor(inv.vendorName || '');
    setEditInvoiceNumber(inv.invoiceNumber || '');
    const rawDate = inv.invoiceDate || inv.emailDate || inv.createdAt;
    setEditInvoiceDate(rawDate ? new Date(rawDate).toISOString().slice(0, 10) : '');
    setEditGrossAmount(inv.grossAmount !== null && inv.grossAmount !== undefined ? String(inv.grossAmount) : '');
    setEditPaymentMethod(inv.paymentMethod || '');
    setEditItemsSummary(inv.itemsSummary || '');
    setEditCategoryId(inv.suggestedCategoryId || '');
  };

  const handleSaveEditModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingInvoice) return;
    setSavingEdit(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateInvoice',
          invoiceId: editingInvoice.id,
          vendorName: editVendor,
          invoiceNumber: editInvoiceNumber,
          invoiceDate: editInvoiceDate || null,
          grossAmount: editGrossAmount,
          paymentMethod: editPaymentMethod,
          itemsSummary: editItemsSummary,
          suggestedCategoryId: editCategoryId || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingInvoice(null);
        setStatusMsg({
          type: 'success',
          text: '✅ Rechnungsbeleg aktualisiert und erneut mit offenen Bankumsätzen abgeglichen.',
        });
        fetchAll(true);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const formatEuro = (num: number | null) => {
    if (num === null || num === undefined) return '–';
    return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  const matchedCount = useMemo(() => invoices.filter((i) => i.status === 'MATCHED').length, [invoices]);
  const pendingCount = useMemo(() => invoices.filter((i) => i.status === 'PENDING').length, [invoices]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter === 'PENDING' && inv.status !== 'PENDING') return false;
      if (statusFilter === 'MATCHED' && inv.status !== 'MATCHED') return false;
      if (categoryFilter !== 'ALL' && (inv.suggestedCategoryId || 'NONE') !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const amountStr = inv.grossAmount !== null ? inv.grossAmount.toFixed(2).replace('.', ',') : '';
        const hay = `${inv.vendorName || ''} ${inv.itemsSummary || ''} ${inv.invoiceNumber || ''} ${inv.emailSubject || ''} ${inv.fileName || ''} ${amountStr}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, categoryFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header & Main Actions */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              📄 Rechnungs-KI & Gmail-Belegabgleich
            </h1>
            {lastSyncAt && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                Letzter Sync: {new Date(lastSyncAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ({gmailFolder})
              </span>
            )}
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Liest Rechnungen aus Ihrem Gmail-Ordner oder per PDF-Upload automatisch aus und verknüpft sie mit offenen PayPal- & Bankumsätzen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleSyncGmailNow}
            disabled={syncingGmail}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            {syncingGmail ? '🔄 Synchronisiere Gmail...' : '📧 Gmail-Ordner abrufen'}
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
            {uploadingPdf ? '🔄 Lese PDF...' : '📥 PDF hochladen'}
          </label>

          <Link
            href="/settings"
            className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold rounded-xl transition flex items-center gap-1.5"
          >
            ⚙️ Einstellungen
          </Link>
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
          <button onClick={() => setStatusMsg(null)} className="font-bold opacity-60 hover:opacity-100 cursor-pointer ml-3">
            ✕
          </button>
        </div>
      )}

      {/* Interactive KPI Filter Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`text-left bg-white p-5 rounded-2xl border transition shadow-xs cursor-pointer ${
            statusFilter === 'ALL'
              ? 'border-blue-500 ring-2 ring-blue-500/15'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">📋 Erfasste Rechnungsbelege</span>
            {statusFilter === 'ALL' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">
                Aktiv
              </span>
            )}
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5">{invoices.length}</div>
          <div className="text-xs text-slate-400 mt-1">Aus Gmail-Ordner & PDF-Upload</div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('MATCHED')}
          className={`text-left bg-white p-5 rounded-2xl border transition shadow-xs cursor-pointer ${
            statusFilter === 'MATCHED'
              ? 'border-emerald-500 ring-2 ring-emerald-500/15'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700">✅ Mit Bankumsatz verknüpft</span>
            {statusFilter === 'MATCHED' && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700">
                Filter aktiv
              </span>
            )}
          </div>
          <div className="text-2xl font-bold text-emerald-600 mt-1.5">{matchedCount}</div>
          <div className="text-xs text-slate-400 mt-1">Umsatz gefunden & Kategorie zugewiesen</div>
        </button>

        <div
          onClick={() => setStatusFilter('PENDING')}
          className={`bg-white p-5 rounded-2xl border transition shadow-xs flex flex-col justify-between cursor-pointer ${
            statusFilter === 'PENDING'
              ? 'border-amber-500 ring-2 ring-amber-500/15'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-700">⏳ Wartend auf Kontoauszug</span>
              {statusFilter === 'PENDING' && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">
                  Filter aktiv
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-amber-600 mt-1.5">{pendingCount}</div>
          </div>
          <div className="flex items-center justify-between mt-1 gap-2">
            <span className="text-xs text-slate-400 truncate">Wird beim Auszug-Upload abgeglichen</span>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRematchPending();
                }}
                disabled={rematching}
                className="text-xs text-blue-600 font-bold hover:underline shrink-0 cursor-pointer"
              >
                {rematching ? 'Prüfe...' : '🔄 Jetzt prüfen'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Invoices Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Filter & Search Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/50 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Ausgelesene Rechnungen & Beleg-Zuordnungen</h3>
              <p className="text-xs text-slate-500">
                Automatischer Abgleich anhand von Bruttobetrag, Datum, Rechnungsnummer und Zahlungsart (z. B. PayPal).
              </p>
            </div>

            {/* Quick Tabs */}
            <div className="inline-flex rounded-xl bg-slate-200/70 p-1 self-start sm:self-auto shrink-0">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'ALL' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Alle ({invoices.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('PENDING')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'PENDING' ? 'bg-white text-amber-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ⏳ Wartend ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('MATCHED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  statusFilter === 'MATCHED' ? 'bg-white text-emerald-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ✅ Verknüpft ({matchedCount})
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
            <div className="sm:col-span-7 relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="🔍 Händler, gekaufte Artikel, Rechnungs-Nr. oder Betrag suchen..."
                className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="sm:col-span-5 flex items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:border-blue-500"
              >
                <option value="ALL">🏷️ Alle Kategorien ({invoices.length})</option>
                <option value="NONE">⚠️ Ohne Kategorie</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {(statusFilter !== 'ALL' || categoryFilter !== 'ALL' || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('ALL');
                    setCategoryFilter('ALL');
                    setSearchQuery('');
                  }}
                  className="px-3 py-2 bg-slate-200/70 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold shrink-0 cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Lade Rechnungsbelege...</div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-4xl">📄</div>
            <div className="text-base font-bold text-slate-800">
              {invoices.length === 0 ? 'Noch keine Rechnungen eingelesen' : 'Keine Rechnungen für diesen Filter gefunden'}
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {invoices.length === 0
                ? 'Laden Sie oben rechts eine PDF-Rechnung hoch oder rufen Sie Ihren Gmail-Ordner ab, um Belege automatisch mit Ihren offenen Bankumsätzen abzugleichen.'
                : 'Passen Sie die Suchbegriffe oder den Status-Filter oben an, um alle Belege zu sehen.'}
            </p>
          </div>
        ) : (
          <div className="w-full">
            <table className="w-full table-fixed text-left text-sm text-slate-700">
              <thead className="bg-slate-50/80 text-slate-500 uppercase text-[11px] border-b border-slate-200 font-semibold tracking-wider">
                <tr>
                  <th className="px-4 py-3 w-[13%]">Datum & Quelle</th>
                  <th className="px-4 py-3 w-[34%]">Händler & Gekaufte Artikel (KI)</th>
                  <th className="px-3 py-3 w-[11%] text-right">Brutto</th>
                  <th className="px-3 py-3 w-[22%]">Erkannte Kategorie</th>
                  <th className="px-4 py-3 w-[20%] text-right">Bank-Abgleich & Aktion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInvoices.map((inv) => {
                  const displayDate = inv.invoiceDate || inv.emailDate || inv.createdAt;
                  // Vermeide doppelte Anzeige, wenn fileName === emailSubject
                  const subInfo =
                    inv.emailSubject && inv.emailSubject !== inv.itemsSummary
                      ? `Betreff: ${inv.emailSubject}`
                      : inv.fileName && inv.fileName !== inv.emailSubject && inv.fileName !== inv.itemsSummary
                      ? inv.fileName
                      : null;

                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition group">
                      {/* Spalte 1: Datum & Quelle */}
                      <td className="px-4 py-3.5 align-top text-xs">
                        <div className="font-mono text-slate-800 font-bold">
                          {new Date(displayDate).toLocaleDateString('de-DE')}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 whitespace-nowrap">
                            {inv.source === 'GMAIL' ? '📧 Gmail' : '📄 PDF'}
                          </span>
                          {inv.paymentMethod && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 whitespace-nowrap">
                              💳 {inv.paymentMethod}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Spalte 2: Lieferant & Gekaufte Artikel */}
                      <td className="px-4 py-3.5 align-top">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            onClick={() => openEditModal(inv)}
                            className="font-bold text-slate-900 hover:text-blue-600 cursor-pointer transition truncate max-w-[220px]"
                            title={inv.vendorName || 'Unbekannter Aussteller'}
                          >
                            {inv.vendorName || 'Unbekannter Aussteller'}
                          </span>
                          {inv.invoiceNumber && (
                            <span
                              className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-mono truncate max-w-[160px]"
                              title={`Rechnungs-Nr.: ${inv.invoiceNumber}`}
                            >
                              #{inv.invoiceNumber}
                            </span>
                          )}
                        </div>

                        <div
                          className="text-xs font-medium text-slate-700 mt-0.5 line-clamp-2 break-words"
                          title={inv.itemsSummary || ''}
                        >
                          {inv.itemsSummary || '–'}
                        </div>

                        {subInfo && (
                          <div className="text-[11px] text-slate-400 truncate mt-0.5" title={subInfo}>
                            {subInfo}
                          </div>
                        )}
                      </td>

                      {/* Spalte 3: Bruttobetrag */}
                      <td className="px-3 py-3.5 align-top text-right whitespace-nowrap font-extrabold text-slate-900 tabular-nums text-sm">
                        {formatEuro(inv.grossAmount)}
                      </td>

                      {/* Spalte 4: Erkannte Kategorie */}
                      <td className="px-3 py-3.5 align-top">
                        <select
                          value={inv.suggestedCategoryId || ''}
                          onChange={(e) => handleChangeInvoiceCategory(inv.id, e.target.value)}
                          className="w-full max-w-full truncate px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer"
                          style={{
                            backgroundColor: inv.suggestedCategory ? `${inv.suggestedCategory.color}15` : '#f8fafc',
                            color: inv.suggestedCategory ? inv.suggestedCategory.color : '#475569',
                            borderColor: inv.suggestedCategory ? `${inv.suggestedCategory.color}40` : '#e2e8f0',
                          }}
                          title={inv.suggestedCategory?.name || 'Kategorie wählen...'}
                        >
                          <option value="">-- Kategorie wählen --</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Spalte 5: Bank-Abgleich & Aktionen */}
                      <td className="px-4 py-3.5 align-top text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          {inv.matchedTransaction ? (
                            <div
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-[11px] font-bold max-w-full truncate"
                              title={`Zugeordnet: ${inv.matchedTransaction.payee || 'Bankumsatz'} (${formatEuro(inv.matchedTransaction.amount)} am ${new Date(inv.matchedTransaction.date).toLocaleDateString('de-DE')})`}
                            >
                              <span>✅</span>
                              <span className="truncate">
                                {new Date(inv.matchedTransaction.date).toLocaleDateString('de-DE')}
                              </span>
                            </div>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200/70 text-amber-800 text-[11px] font-semibold whitespace-nowrap"
                              title="Wartet auf passenden offenen Bankumsatz beim nächsten Kontoauszug-Abgleich"
                            >
                              ⏳ Wartet auf Umsatz
                            </span>
                          )}

                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEditModal(inv)}
                              className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                              title="Rechnungsdetails bearbeiten"
                            >
                              ✏️ Details
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteInvoice(inv.id)}
                              className="px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition cursor-pointer"
                              title="Beleg entfernen"
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit / Details Modal */}
      {editingInvoice && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setEditingInvoice(null)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
              <div>
                <h3 className="text-base font-bold text-slate-900">✏️ Rechnungsbeleg prüfen & bearbeiten</h3>
                <p className="text-xs text-slate-500">
                  Quelle: {editingInvoice.source === 'GMAIL' ? '📧 Gmail-Import' : '📄 PDF-Upload'} •{' '}
                  {editingInvoice.fileName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingInvoice(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditModal} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Lieferant / Händler</label>
                  <input
                    type="text"
                    value={editVendor}
                    onChange={(e) => setEditVendor(e.target.value)}
                    placeholder="z. B. Amazon.de"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Rechnungsnummer</label>
                  <input
                    type="text"
                    value={editInvoiceNumber}
                    onChange={(e) => setEditInvoiceNumber(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Bruttobetrag (€)</label>
                  <input
                    type="text"
                    value={editGrossAmount}
                    onChange={(e) => setEditGrossAmount(e.target.value)}
                    placeholder="z. B. 169,00"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 font-bold focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Rechnungsdatum</label>
                  <input
                    type="date"
                    value={editInvoiceDate}
                    onChange={(e) => setEditInvoiceDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Gekaufte Artikel / Leistungsbeschreibung</label>
                <input
                  type="text"
                  value={editItemsSummary}
                  onChange={(e) => setEditItemsSummary(e.target.value)}
                  placeholder="z. B. Samsung Galaxy A16 Smartphone"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Zahlungsart</label>
                  <input
                    type="text"
                    value={editPaymentMethod}
                    onChange={(e) => setEditPaymentMethod(e.target.value)}
                    placeholder="z. B. PayPal, Lastschrift, Überweisung"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Zugewiesene Kategorie</label>
                  <select
                    value={editCategoryId}
                    onChange={(e) => setEditCategoryId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 font-semibold focus:outline-none focus:border-blue-500"
                  >
                    <option value="">-- Keine Kategorie --</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Match Info Box */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-slate-600">
                {editingInvoice.matchedTransaction ? (
                  <div className="flex items-center justify-between">
                    <span>
                      ✅ Verknüpft mit Bankumsatz: <b>{editingInvoice.matchedTransaction.payee || 'Umsatz'}</b> (
                      {formatEuro(editingInvoice.matchedTransaction.amount)} am{' '}
                      {new Date(editingInvoice.matchedTransaction.date).toLocaleDateString('de-DE')})
                    </span>
                  </div>
                ) : (
                  <span>
                    ⏳ <b>Status:</b> Wartet auf passenden offenen Bankumsatz. Beim Speichern wird automatisch erneut nach einem passenden Umsatz gesucht.
                  </span>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingInvoice(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {savingEdit ? 'Speichere...' : '💾 Speichern & neu abgleichen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
