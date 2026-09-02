'use client';

import { useState, useEffect, useRef } from 'react';

interface Category {
  id: string;
  name: string;
  color: string;
}

interface MatchedRule {
  id: string;
  pattern: string;
  matchType: string;
  categoryId?: string;
  category?: Category;
}

interface Transaction {
  id: string;
  date: string;
  amount: number;
  payee: string | null;
  iban: string | null;
  description: string;
  status: 'CATEGORIZED' | 'UNCATEGORIZED';
  category: Category | null;
  matchedRule?: MatchedRule | null;
}

interface MonthOption {
  value: string;
  label: string;
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availableMonths, setAvailableMonths] = useState<MonthOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  // Filters
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Bulk Selection State
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [bulkCatId, setBulkCatId] = useState<string>('');
  const [bulkApplying, setBulkApplying] = useState<boolean>(false);

  // Categorization Modal / Drawer
  const [activeTx, setActiveTx] = useState<Transaction | null>(null);
  const [selectedCatId, setSelectedCatId] = useState<string>('');
  const [learnRuleMode, setLearnRuleMode] = useState<'single' | 'rule'>('single');
  const [savingCategory, setSavingCategory] = useState<boolean>(false);

  // Rule Edit Modal from Transaction Row
  const [editingRuleFromTx, setEditingRuleFromTx] = useState<MatchedRule | null>(null);
  const [ruleNewCatId, setRuleNewCatId] = useState<string>('');
  const [matchingTxsForRule, setMatchingTxsForRule] = useState<Transaction[]>([]);
  const [selectedTxIdsForRule, setSelectedTxIdsForRule] = useState<Set<string>>(new Set());
  const [savingRuleEdit, setSavingRuleEdit] = useState<boolean>(false);

  // Toast / Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [lastAssignedTx, setLastAssignedTx] = useState<{ id: string; oldCatId: string | null } | null>(null);

  // Gemini AI Suggestion State
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<{ suggestedCategoryId: string; name: string; score: number; reasoning: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setCategories(data.categories || []);
      if (data.categories?.length > 0) {
        setBulkCatId(data.categories[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTransactions = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedMonth !== 'all') params.set('month', selectedMonth);
      if (selectedCategory !== 'all') params.set('categoryId', selectedCategory);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`/api/transactions?${params.toString()}`);
      const data = await res.json();
      setTransactions(data.transactions || []);
      if (data.availableMonths) {
        setAvailableMonths(data.availableMonths);
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchTransactions(false);
    setSelectedTxIds(new Set());
  }, [selectedMonth, selectedCategory, searchQuery]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadMessage(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', file.name && file.name.endsWith('.xml') ? 'xml' : 'csv');

    try {
      const res = await fetch('/api/transactions', {
        method: 'POST',
        body: formData,
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        if (res.status === 401 || text.includes('anmelden') || text.includes('Login')) {
          setUploadMessage('❌ Sitzung abgelaufen. Bitte Seite neu laden und erneut einloggen.');
        } else if (res.status === 413) {
          setUploadMessage('❌ Die Datei ist zu groß für den Upload.');
        } else if (res.status === 502 || res.status === 504) {
          setUploadMessage('❌ Server-Timeout bei der Verarbeitung. Bitte kurz warten und erneut versuchen.');
        } else {
          setUploadMessage(`❌ Serverfehler (${res.status}): Bitte überprüfen Sie die Verbindung.`);
        }
        return;
      }

      const data = await res.json();
      if (data.error) {
        setUploadMessage(`❌ Fehler: ${data.error}`);
      } else {
        setUploadMessage(
          `✅ Erfolgreich: ${data.importedCount} Umsätze importiert (${data.autoCategorizedCount} automatisch zugeordnet, ${data.skippedCount} Duplikate übersprungen).`
        );
        fetchTransactions(false);
      }
    } catch (err: any) {
      setUploadMessage(`❌ Fehler beim Upload: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Checkbox selection helpers
  const toggleSelectTx = (id: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (selectedTxIds.size === transactions.length) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(transactions.map((t) => t.id)));
    }
  };

  // Bulk Categorization Action
  const handleBulkAssignCategory = async (createRule = false) => {
    if (selectedTxIds.size === 0 || !bulkCatId) return;

    setBulkApplying(true);
    try {
      const ids = Array.from(selectedTxIds);
      const res = await fetch('/api/transactions/bulk-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionIds: ids,
          categoryId: bulkCatId,
          createRule,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setToastMessage(`⚡ ${data.count} Umsätze auf "${data.categoryName}" umgestellt!`);
        setSelectedTxIds(new Set());
        fetchTransactions(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBulkApplying(false);
    }
  };

  // Direct Categorization Handler
  const handleAssignCategoryDirect = async (
    txId: string,
    categoryId: string,
    createRule = false,
    deleteRuleId?: string
  ) => {
    const targetTx = transactions.find((t) => t.id === txId);
    const oldCatId = targetTx?.category?.id || null;

    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === txId) {
          const newCat = categories.find((c) => c.id === categoryId) || null;
          return {
            ...t,
            category: newCat,
            status: categoryId === 'uncategorized' ? 'UNCATEGORIZED' : 'CATEGORIZED',
            matchedRule: deleteRuleId ? null : t.matchedRule,
          };
        }
        return t;
      })
    );

    try {
      const res = await fetch('/api/transactions/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: txId,
          categoryId,
          createRule,
          deleteRuleId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setLastAssignedTx({ id: txId, oldCatId });

        if (deleteRuleId) {
          setToastMessage('⚡ Auto-Lernregel gelöscht. Zukünftige Buchungen werden nicht mehr automatisch zugeordnet.');
        } else if (data.isReset) {
          setToastMessage('↩️ Zuordnung zurückgesetzt (Umsatz ist wieder unkategorisiert).');
        } else {
          let msg = `Kategorie "${data.transaction?.category?.name || 'Kategorie'}" für diesen Umsatz zugewiesen.`;
          if (data.learnResult?.ruleCreated) {
            msg += ` 🧠 Dauerhafte Lernregel gespeichert! (${data.learnResult.retroactivelyAppliedCount} weitere Buchungen angepasst)`;
          }
          setToastMessage(`✅ ${msg}`);
        }

        setActiveTx(null);
        setAiResult(null);
        fetchTransactions(true);
      }
    } catch (e) {
      console.error(e);
      fetchTransactions(true);
    }
  };

  const handleRemoveRuleFromTx = async (tx: Transaction) => {
    if (!tx.matchedRule) return;
    if (!confirm(`Möchten Sie die automatische Lernregel "${tx.matchedRule.pattern}" wirklich aufheben und löschen?`)) return;

    await handleAssignCategoryDirect(tx.id, tx.category?.id || 'uncategorized', false, tx.matchedRule.id);
  };

  const handleOpenEditRuleModal = (rule: MatchedRule) => {
    setEditingRuleFromTx(rule);
    setRuleNewCatId(rule.categoryId || categories[0]?.id || '');

    const patternLower = rule.pattern.toLowerCase().trim();
    const cleanRuleIban = rule.pattern.replace(/\s+/g, '').toUpperCase();

    const matching = transactions.filter((t) => {
      if (rule.matchType === 'IBAN' && t.iban) {
        return t.iban.replace(/\s+/g, '').toUpperCase() === cleanRuleIban;
      }
      if (rule.matchType === 'PAYEE' && t.payee) {
        const payeeLower = t.payee.toLowerCase().trim();
        return payeeLower.includes(patternLower) || patternLower.includes(payeeLower);
      }
      const payeeLower = (t.payee || '').toLowerCase();
      const descLower = (t.description || '').toLowerCase();
      return descLower.includes(patternLower) || payeeLower.includes(patternLower);
    });

    setMatchingTxsForRule(matching);
    setSelectedTxIdsForRule(new Set(matching.map((t) => t.id)));
  };

  const handleSaveRuleFromTxModal = async () => {
    if (!editingRuleFromTx || !ruleNewCatId) return;

    setSavingRuleEdit(true);
    try {
      const updateTransactionIds = Array.from(selectedTxIdsForRule);

      const res = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingRuleFromTx.id,
          categoryId: ruleNewCatId,
          matchType: editingRuleFromTx.matchType,
          pattern: editingRuleFromTx.pattern,
          updateTransactionIds,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setToastMessage(`✅ Regel "${editingRuleFromTx.pattern}" aktualisiert & ${data.updatedTxCount} Buchungen umgestellt!`);
        setEditingRuleFromTx(null);
        fetchTransactions(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSavingRuleEdit(false);
    }
  };

  const handleUndoLastAssignment = async () => {
    if (!lastAssignedTx) return;
    await handleAssignCategoryDirect(lastAssignedTx.id, lastAssignedTx.oldCatId || 'uncategorized', false);
    setLastAssignedTx(null);
  };

  const handleAskGeminiAI = async () => {
    if (!activeTx) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await fetch('/api/transactions/ai-categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: activeTx.id }),
      });

      const data = await res.json();
      if (data.suggestion?.suggestedCategoryId) {
        setSelectedCatId(data.suggestion.suggestedCategoryId);
        setAiResult({
          suggestedCategoryId: data.suggestion.suggestedCategoryId,
          name: data.suggestion.suggestedCategoryName,
          score: Math.round(data.suggestion.confidenceScore * 100),
          reasoning: data.suggestion.reasoning,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAiLoading(false);
    }
  };

  const formatEuro = (num: number) => {
    return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  return (
    <div className="space-y-8 relative pb-24">
      {/* Top Banner & Upload */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Kontoauszüge & Ausgaben</h1>
          <p className="text-slate-500 text-sm mt-1">
            Reine Ausgabenübersicht mit Mehrfach-Auswahl, 1-Klick-Massenänderung & Regelprüfung
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".csv,.txt,.xml"
            className="hidden"
            id="bank-file-upload"
          />
          <label
            htmlFor="bank-file-upload"
            className={`px-5 py-2.5 rounded-xl font-semibold text-sm cursor-pointer transition shadow-xs flex items-center gap-2 ${
              uploading
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {uploading ? '🔄 Importiere Datei...' : '📥 Kontoauszug hochladen (CSV/CAMT)'}
          </label>
        </div>
      </div>

      {/* Notifications / Toast */}
      {uploadMessage && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm flex items-center justify-between">
          <span>{uploadMessage}</span>
          <button onClick={() => setUploadMessage(null)} className="text-slate-400 hover:text-slate-600 font-bold">
            ✕
          </button>
        </div>
      )}

      {toastMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-sm flex items-center justify-between shadow-xs">
          <span>{toastMessage}</span>
          <div className="flex items-center gap-3">
            {lastAssignedTx && (
              <button
                onClick={handleUndoLastAssignment}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition"
              >
                ↩️ Rückgängig machen
              </button>
            )}
            <button onClick={() => setToastMessage(null)} className="text-emerald-400 hover:text-emerald-700 font-bold">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col lg:flex-row gap-4 items-center justify-between">
        {/* Search */}
        <div className="flex items-center gap-3 w-full lg:w-72">
          <input
            type="text"
            placeholder="🔍 Nach Lieferant (z.B. PayPal), IBAN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Filters: Month & Category */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* Dynamic Month Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-semibold">Monat:</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">📅 Alle Monate (Gesamt)</option>
              {availableMonths.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Category Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-semibold">Kategorie:</span>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Alle Kategorien</option>
              <option value="uncategorized">🔍 Unkategorisiert (Offen)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Lade Umsätze...</div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">Keine passenden Umsätze für diese Filter gefunden.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200 font-semibold tracking-wider">
                <tr>
                  <th className="px-4 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedTxIds.size > 0 && selectedTxIds.size === transactions.length}
                      onChange={toggleSelectAllVisible}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                      title="Alle angezeigten Buchungen auswählen"
                    />
                  </th>
                  <th className="px-5 py-3">Datum</th>
                  <th className="px-6 py-3">Empfänger & Auto-Regel</th>
                  <th className="px-6 py-3">Verwendungszweck</th>
                  <th className="px-6 py-3">Betrag</th>
                  <th className="px-6 py-3">Kategorie (Einzel-Zuordnung)</th>
                  <th className="px-6 py-3 text-right">Aktionen & KI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((tx) => {
                  const isChecked = selectedTxIds.has(tx.id);
                  return (
                    <tr
                      key={tx.id}
                      className={`transition ${
                        isChecked ? 'bg-blue-50/60 border-l-4 border-blue-500' : 'hover:bg-slate-50/80'
                      }`}
                    >
                      <td className="px-4 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectTx(tx.id)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      <td className="px-5 py-4 whitespace-nowrap text-slate-500 font-mono text-xs">
                        {new Date(tx.date).toLocaleDateString('de-DE')}
                      </td>

                      <td className="px-6 py-4 font-semibold text-slate-900">
                        <div>{tx.payee || 'Unbekannt'}</div>
                        {tx.iban && <div className="text-xs text-slate-400 font-mono mt-0.5">{tx.iban}</div>}

                        {/* Interactive Active Rule Banner / Badge with Edit & Delete */}
                        {tx.matchedRule && (
                          <div className="mt-1.5 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-800 text-[11px] font-medium shadow-2xs">
                            <span>🧠 Auto-Regel: <b>{tx.matchedRule.pattern}</b></span>

                            <button
                              type="button"
                              onClick={() => handleOpenEditRuleModal(tx.matchedRule!)}
                              title="Regel-Kategorie für alle verknüpften Buchungen anpassen"
                              className="text-indigo-600 hover:text-blue-700 font-semibold underline text-[10px] ml-1 transition"
                            >
                              ✏️ Bearbeiten
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRemoveRuleFromTx(tx)}
                              title="Automatische Regel für diesen Lieferanten löschen"
                              className="text-indigo-400 hover:text-rose-600 font-bold transition ml-0.5"
                            >
                              ✖
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="px-6 py-4 max-w-md whitespace-normal break-words text-slate-600 text-xs">
                        {tx.description}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap font-bold text-sm text-slate-900">
                        {formatEuro(tx.amount)}
                      </td>

                      {/* Direct Inline Category Selector (Single Transaction Change) */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <select
                          value={tx.category?.id || 'uncategorized'}
                          onChange={(e) => handleAssignCategoryDirect(tx.id, e.target.value, false)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition focus:ring-2 focus:ring-blue-500 cursor-pointer"
                          style={{
                            backgroundColor: tx.category ? `${tx.category.color}15` : '#fef3c7',
                            color: tx.category ? tx.category.color : '#b45309',
                            borderColor: tx.category ? `${tx.category.color}40` : '#fde68a',
                          }}
                        >
                          <option value="uncategorized">🔍 Unkategorisiert (Offen)</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => {
                            setActiveTx(tx);
                            setSelectedCatId(tx.category?.id || categories[0]?.id || '');
                            setLearnRuleMode('single');
                            setAiResult(null);
                          }}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition"
                        >
                          ⚙️ Option & KI
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

      {/* Floating Sticky Bulk Action Bar */}
      {selectedTxIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex flex-col sm:flex-row items-center gap-4 border border-slate-700 animate-in fade-in slide-in-from-bottom-5 duration-200 max-w-3xl w-[92%]">
          <div className="flex items-center gap-3">
            <span className="bg-blue-600 text-white font-bold text-xs px-3 py-1 rounded-full">
              ☑ {selectedTxIds.size} ausgewählt
            </span>
            <button
              onClick={() => setSelectedTxIds(new Set())}
              className="text-xs text-slate-400 hover:text-white underline"
            >
              Auswahl aufheben
            </button>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <select
              value={bulkCatId}
              onChange={(e) => setBulkCatId(e.target.value)}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-white focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
            >
              <option value="uncategorized">🔍 Unkategorisiert (Zurücksetzen)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => handleBulkAssignCategory(false)}
              disabled={bulkApplying}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs transition shrink-0 disabled:opacity-50"
            >
              {bulkApplying ? 'Stelle um...' : `⚡ Alle ${selectedTxIds.size} Buchungen umstellen`}
            </button>
          </div>
        </div>
      )}

      {/* Edit Rule Modal Triggered from Transaction Row */}
      {editingRuleFromTx && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">
                ⚙️ Regel bearbeiten: {editingRuleFromTx.pattern}
              </h3>
              <button onClick={() => setEditingRuleFromTx(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Neue Kategorie für diese Regel auswählen:</label>
                <select
                  value={ruleNewCatId}
                  onChange={(e) => setRuleNewCatId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-blue-600"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-950 font-medium">
                💡 <b>Verknüpfte Buchungen:</b> Es gibt aktuell {matchingTxsForRule.length} Buchungen mit diesem Muster in Ihrer Datenbank.
              </div>

              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50/50 p-1">
                {matchingTxsForRule.map((t) => (
                  <div key={t.id} className="p-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-slate-900 block">{t.payee || 'Unbekannt'}</span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(t.date).toLocaleDateString('de-DE')} • {t.description.substring(0, 40)}...
                      </span>
                    </div>
                    <span className="font-bold text-slate-900">{formatEuro(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  const rId = editingRuleFromTx.id;
                  setEditingRuleFromTx(null);
                  if (transactions.length > 0) {
                    handleAssignCategoryDirect(transactions[0].id, 'uncategorized', false, rId);
                  }
                }}
                className="px-3.5 py-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl text-xs font-bold transition border border-rose-200"
              >
                ✖ Regel komplett löschen
              </button>

              <div className="flex gap-3">
                <button
                  onClick={() => setEditingRuleFromTx(null)}
                  className="px-4 py-2 text-slate-600 text-sm font-medium hover:bg-slate-100 rounded-xl transition"
                >
                  Abbrechen
                </button>
                <button
                  onClick={handleSaveRuleFromTxModal}
                  disabled={savingRuleEdit}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-xs transition"
                >
                  {savingRuleEdit ? 'Speichere...' : `Kategorie für alle ${matchingTxsForRule.length} Buchungen ändern`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Categorization Modal */}
      {activeTx && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Kategorie anpassen & Regel-Optionen</h3>
              <button onClick={() => setActiveTx(null)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Empfänger:</span>
                <span className="font-semibold text-slate-900">{activeTx.payee || 'Unbekannt'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Betrag:</span>
                <span className="font-bold text-slate-900">{formatEuro(activeTx.amount)}</span>
              </div>
              <div className="text-xs text-slate-500 pt-1 border-t border-slate-200/60">
                <b>Verwendungszweck:</b> {activeTx.description}
              </div>
            </div>

            {/* Gemini AI Assistant Button & Banner */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-4 rounded-xl border border-indigo-100 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                  <span>🤖</span> Gemini KI Vorschlag
                </span>
                <button
                  type="button"
                  onClick={handleAskGeminiAI}
                  disabled={aiLoading}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition shadow-xs disabled:opacity-50"
                >
                  {aiLoading ? 'Analysiere...' : 'KI Vorschlag anfordern'}
                </button>
              </div>

              {aiResult && (
                <div className="text-xs text-indigo-900 bg-white/80 p-3 rounded-lg border border-indigo-200 space-y-1">
                  <div className="flex justify-between font-bold">
                    <span>Vorschlag: {aiResult.name}</span>
                    <span className="text-indigo-600">{aiResult.score}% Konfidenz</span>
                  </div>
                  <p className="text-slate-600 italic">{aiResult.reasoning}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Ziel-Kategorie auswählen:</label>
              <select
                value={selectedCatId}
                onChange={(e) => setSelectedCatId(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500"
              >
                <option value="uncategorized">🔍 Unkategorisiert (Zurücksetzen)</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear Mode Selection: Single Transaction vs Permanent Vendor Rule */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="text-xs font-bold text-slate-800">
                ⚙️ Wie soll diese Änderung angewendet werden?
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="learnMode"
                  checked={learnRuleMode === 'single'}
                  onChange={() => setLearnRuleMode('single')}
                  className="mt-1 w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <div className="text-xs text-slate-700">
                  <span className="font-bold text-slate-900 block">📍 Nur DIESEN einzelnen Umsatz ändern</span>
                  Ideal für Misch-Lieferanten wie MediaMarkt, Amazon oder PayPal (keine automatische Regel für die Zukunft).
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer pt-1 border-t border-slate-200/60">
                <input
                  type="radio"
                  name="learnMode"
                  checked={learnRuleMode === 'rule'}
                  onChange={() => setLearnRuleMode('rule')}
                  className="mt-1 w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
                <div className="text-xs text-slate-700">
                  <span className="font-bold text-slate-900 block">🧠 Dauerhafte Lernregel für alle {activeTx.payee || 'Lieferanten'}-Umsätze speichern</span>
                  Ideal für eindeutige Hotel-Lieferanten (wie Metro, Telekom oder Schwälbchen).
                </div>
              </label>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => handleAssignCategoryDirect(activeTx.id, 'uncategorized', false)}
                className="px-3.5 py-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl text-xs font-bold transition border border-rose-200"
              >
                ❌ Zurücksetzen
              </button>

              <div className="flex gap-3">
                <button
                  onClick={() => setActiveTx(null)}
                  className="px-4 py-2 text-slate-600 text-sm font-medium hover:bg-slate-100 rounded-xl transition"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() =>
                    handleAssignCategoryDirect(activeTx.id, selectedCatId, learnRuleMode === 'rule')
                  }
                  disabled={savingCategory}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-xs transition"
                >
                  {savingCategory ? 'Speichere...' : 'Speichern'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
