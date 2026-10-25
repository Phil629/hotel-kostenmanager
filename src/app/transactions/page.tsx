'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { usePersistentState } from '../../lib/usePersistentState';

type SortOption = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

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

interface PeriodStats {
  totalCount: number;
  openCount: number;
  categorizedCount: number;
  openAmount: number;
}

// Entfernt kryptische SEPA-Maschinencodes (EREF, MREF, CRED, BIC, doppelte IBAN) für eine saubere 1-Zeilen-Vorschau
function cleanBankPurpose(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    .replace(/\b(EREF|MREF|CRED|SVWZ|ABWA|BIC|KREF)\s*[:+]\s*[^\s,;]+/gi, '')
    .replace(/\b(IBAN|BIC)\s*[:]\s*[A-Z0-9]+/gi, '')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || raw;
}

// Falls die Bank keinen Empfänger ("Unbekannt") mitliefert, nutze den Anfang des bereinigten Buchungstextes als verständlichen Titel
function getSmartPayeeTitle(tx: Transaction): { title: string; isFallback: boolean } {
  const rawPayee = (tx.payee || '').trim();
  if (rawPayee && rawPayee.toLowerCase() !== 'unbekannt') {
    return { title: rawPayee, isFallback: false };
  }
  const cleanDesc = cleanBankPurpose(tx.description);
  const shortTitle = cleanDesc.length > 52 ? cleanDesc.slice(0, 52) + '…' : cleanDesc;
  return { title: shortTitle || 'Bankbuchung / Gebühr', isFallback: true };
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availableMonths, setAvailableMonths] = useState<MonthOption[]>([]);
  const [periodStats, setPeriodStats] = useState<PeriodStats>({
    totalCount: 0,
    openCount: 0,
    categorizedCount: 0,
    openAmount: 0,
  });
  const [expandedDescIds, setExpandedDescIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(100);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  // Filters (werden seitenübergreifend gemerkt; Monat wird mit dem Dashboard geteilt)
  const [selectedMonth, setSelectedMonth, monthReady] = usePersistentState<string>('filter.month', 'all');
  const [selectedCategory, setSelectedCategory, categoryReady] = usePersistentState<string>('transactions.category', 'all');
  const [searchQuery, setSearchQuery, searchReady] = usePersistentState<string>('transactions.search', '');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [sortBy, setSortBy] = usePersistentState<SortOption>('transactions.sort', 'date_desc');
  const filtersReady = monthReady && categoryReady && searchReady;

  // Entprellte Suche (250ms), damit nicht bei jedem Tastendruck eine DB-Abfrage ausgelöst wird
  useEffect(() => {
    if (!searchReady) return;
    if (!searchQuery) {
      setDebouncedSearch('');
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, searchReady]);

  // Bearbeitete Buchungen bleiben bis zum nächsten Filterwechsel sichtbar (kein "Wegspringen")
  const stickyIdsRef = useRef<Set<string>>(new Set());

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
    if (!silent && !hasLoadedOnceRef.current) {
      setLoading(true);
    } else {
      setIsFetching(true);
    }
    try {
      const params = new URLSearchParams();
      if (selectedMonth !== 'all') params.set('month', selectedMonth);
      if (selectedCategory !== 'all') params.set('categoryId', selectedCategory);
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await fetch(`/api/transactions?${params.toString()}`);
      const data = await res.json();
      const fetched: Transaction[] = data.transactions || [];
      hasLoadedOnceRef.current = true;
      if (silent) {
        // Bereits bearbeitete Buchungen, die nicht mehr zum Filter passen, sichtbar lassen
        setTransactions((prev) => {
          const fetchedIds = new Set(fetched.map((t) => t.id));
          const kept = prev.filter((t) => stickyIdsRef.current.has(t.id) && !fetchedIds.has(t.id));
          return [...fetched, ...kept];
        });
      } else {
        setTransactions(fetched);
      }
      if (data.availableMonths) {
        setAvailableMonths(data.availableMonths);
      }
      if (data.stats) {
        setPeriodStats({
          totalCount: data.stats.periodTotalCount ?? data.stats.totalCount ?? fetched.length,
          openCount: data.stats.periodOpenCount ?? data.stats.uncategorizedCount ?? 0,
          categorizedCount:
            data.stats.periodCategorizedCount ??
            (data.stats.periodTotalCount ?? fetched.length) - (data.stats.periodOpenCount ?? 0),
          openAmount: data.stats.periodOpenAmount ?? 0,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchCategories();
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      if (sp.get('status') === 'UNCATEGORIZED') {
        setSelectedCategory('uncategorized');
      }
    }
  }, []);

  useEffect(() => {
    if (!filtersReady) return; // erst laden, wenn gemerkte Filter bekannt sind
    stickyIdsRef.current = new Set();
    setVisibleCount(100);
    fetchTransactions(false);
    setSelectedTxIds(new Set());
  }, [selectedMonth, selectedCategory, debouncedSearch, filtersReady]);

  // Passt eine (bearbeitete) Buchung noch zum aktiven Kategorie-Filter?
  const matchesCategoryFilter = (tx: Transaction) => {
    if (selectedCategory === 'all') return true;
    if (selectedCategory === 'uncategorized') return !tx.category;
    return tx.category?.id === selectedCategory;
  };

  const doneCount = transactions.filter((t) => stickyIdsRef.current.has(t.id) && !matchesCategoryFilter(t)).length;

  const hideDoneTransactions = () => {
    setTransactions((prev) => prev.filter((t) => matchesCategoryFilter(t)));
    stickyIdsRef.current = new Set();
  };

  // Clientseitige Sortierung (Datum oder Betrag)
  const sortedTransactions = useMemo(() => {
    const list = [...transactions];
    const byDate = (a: Transaction, b: Transaction) => new Date(a.date).getTime() - new Date(b.date).getTime();
    const byAmount = (a: Transaction, b: Transaction) => Math.abs(a.amount) - Math.abs(b.amount);
    switch (sortBy) {
      case 'date_asc':
        return list.sort((a, b) => byDate(a, b) || a.id.localeCompare(b.id));
      case 'amount_desc':
        return list.sort((a, b) => byAmount(b, a) || byDate(b, a));
      case 'amount_asc':
        return list.sort((a, b) => byAmount(a, b) || byDate(b, a));
      case 'date_desc':
      default:
        return list.sort((a, b) => byDate(b, a) || b.id.localeCompare(a.id));
    }
  }, [transactions, sortBy]);

  const visibleTransactions = useMemo(
    () => sortedTransactions.slice(0, visibleCount),
    [sortedTransactions, visibleCount]
  );

  const toggleSort = (column: 'date' | 'amount') => {
    if (column === 'date') setSortBy(sortBy === 'date_desc' ? 'date_asc' : 'date_desc');
    else setSortBy(sortBy === 'amount_desc' ? 'amount_asc' : 'amount_desc');
  };

  const sortIndicator = (column: 'date' | 'amount') => {
    if (!sortBy.startsWith(column)) return <span className="text-slate-300">↕</span>;
    return <span className="text-blue-600">{sortBy.endsWith('desc') ? '↓' : '↑'}</span>;
  };

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
    if (selectedTxIds.size > 0 && selectedTxIds.size === sortedTransactions.length) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(sortedTransactions.map((t) => t.id)));
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
        // Sofort lokal übernehmen; Zeilen bleiben an ihrer Stelle stehen
        ids.forEach((id) => stickyIdsRef.current.add(id));
        const newCat = categories.find((c) => c.id === bulkCatId) || null;
        setTransactions((prev) =>
          prev.map((t) =>
            selectedTxIds.has(t.id)
              ? { ...t, category: newCat, status: newCat ? 'CATEGORIZED' : 'UNCATEGORIZED', matchedRule: null }
              : t
          )
        );
        setSelectedTxIds(new Set());
        fetchTransactions(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBulkApplying(false);
    }
  };

  const toggleDescExpand = (id: string) => {
    setExpandedDescIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    const wasOpen = !oldCatId;
    const isNowOpen = categoryId === 'uncategorized';

    // Buchung bleibt sichtbar, auch wenn sie nicht mehr zum Kategorie-Filter passt
    stickyIdsRef.current.add(txId);

    if (wasOpen !== isNowOpen && targetTx) {
      const absAmt = Math.abs(targetTx.amount);
      setPeriodStats((prev) => ({
        ...prev,
        openCount: Math.max(0, prev.openCount + (isNowOpen ? 1 : -1)),
        categorizedCount: Math.max(0, prev.categorizedCount + (isNowOpen ? -1 : 1)),
        openAmount: Math.max(0, Math.round((prev.openAmount + (isNowOpen ? absAmt : -absAmt)) * 100) / 100),
      }));
    }

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

        // Serverstand der Buchung übernehmen (ohne die ganze Liste neu zu laden)
        if (data.transaction) {
          setTransactions((prev) =>
            prev.map((t) =>
              t.id === txId
                ? { ...t, category: data.transaction.category || null, status: data.transaction.status, matchedRule: data.transaction.matchedRule || null }
                : t
            )
          );
        }

        // Nur neu laden, wenn sich auch andere Buchungen geändert haben können (Lernregel angelegt/gelöscht)
        if (data.learnResult?.ruleCreated || data.ruleDeleted) {
          fetchTransactions(true);
        }
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

    const patternLower = (rule.pattern || '').toLowerCase().trim();
    const cleanRuleIban = (rule.pattern || '').replace(/\s+/g, '').toUpperCase();

    const matching = transactions.filter((t) => {
      if (!patternLower) return false;
      if (rule.matchType === 'IBAN') {
        if (!t.iban || !cleanRuleIban) return false;
        return t.iban.replace(/\s+/g, '').toUpperCase() === cleanRuleIban;
      }
      if (rule.matchType === 'PAYEE') {
        if (!t.payee) return false;
        const payeeLower = t.payee.toLowerCase().trim();
        return payeeLower.includes(patternLower);
      }
      const payeeLower = (t.payee || '').toLowerCase();
      const descLower = (t.description || '').toLowerCase();
      return descLower.includes(patternLower) || payeeLower.includes(patternLower);
    });

    setMatchingTxsForRule(matching);
    const safeIds = matching
      .filter((t) => !t.category || t.category.id === rule.categoryId || t.matchedRule?.id === rule.id)
      .map((t) => t.id);
    setSelectedTxIdsForRule(new Set(safeIds.length > 0 ? safeIds : matching.map((t) => t.id)));
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
        updateTransactionIds.forEach((id) => stickyIdsRef.current.add(id));
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
      } else if (data.suggestion) {
        setAiResult({
          suggestedCategoryId: '',
          name: 'Keine eindeutige Kategorie erkannt',
          score: 0,
          reasoning:
            data.suggestion.reasoning ||
            'Für diesen Umsatz ist keine eindeutige Zuordnung ohne Rechnungsbeleg erkennbar (Kategorie "Sonstiges" wird bewusst ignoriert).',
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

  const periodProgressPct =
    periodStats.totalCount > 0
      ? Math.round((periodStats.categorizedCount / periodStats.totalCount) * 100)
      : 100;

  return (
    <div className="space-y-5 relative pb-24">
      {/* 1. Klare Aufgaben- & Upload-Kopfzeile */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Umsätze & Kategorien zuordnen
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
              1. Kontoauszug hochladen → 2. Offene Buchungen einer Kategorie zuweisen (oder als feste Regel speichern)
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
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
              className={`px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm cursor-pointer transition shadow-xs flex items-center gap-2 ${
                uploading
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {uploading ? '🔄 Importiere Datei...' : '📥 Kontoauszug hochladen (CSV / CAMT)'}
            </label>
          </div>
        </div>

        {/* Visuelle Aufgaben-Box: Zeigt sofort, ob noch etwas zu tun ist */}
        {!loading && periodStats.totalCount > 0 && (
          <div
            className={`p-3.5 sm:px-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              periodStats.openCount > 0
                ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-xl shrink-0">{periodStats.openCount > 0 ? '🎯' : '✅'}</span>
              <div className="text-xs sm:text-sm">
                {periodStats.openCount > 0 ? (
                  <>
                    <b>Aufgabe offen:</b> In diesem Zeitraum sind noch{' '}
                    <span className="underline font-extrabold">{periodStats.openCount} Ausgaben</span> (
                    {formatEuro(periodStats.openAmount)}) ohne Kategorie.
                  </>
                ) : (
                  <>
                    <b>Alles erledigt!</b> Alle <b>{periodStats.totalCount} Ausgaben</b> in diesem Zeitraum sind bereits
                    einer Kategorie zugeordnet ({periodProgressPct}%).
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {periodStats.openCount > 0 && selectedCategory !== 'uncategorized' && (
                <button
                  type="button"
                  onClick={() => setSelectedCategory('uncategorized')}
                  className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-2xs transition cursor-pointer"
                >
                  👉 Jetzt die {periodStats.openCount} offenen Umsätze anzeigen
                </button>
              )}
              {selectedCategory === 'uncategorized' && (
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Alle {periodStats.totalCount} Buchungen zeigen
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Notifications / Toast */}
      {uploadMessage && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm flex items-center justify-between">
          <span>{uploadMessage}</span>
          <button onClick={() => setUploadMessage(null)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">
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
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition cursor-pointer"
              >
                ↩️ Rückgängig machen
              </button>
            )}
            <button onClick={() => setToastMessage(null)} className="text-emerald-400 hover:text-emerald-700 font-bold cursor-pointer">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 2. Aufgeräumte Modus-Tabs & Einzeilige Filterleiste */}
      <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col xl:flex-row gap-3 items-stretch xl:items-center justify-between">
        {/* Links: Schnelle Arbeits-Tabs (Offen vs. Alle) */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory('uncategorized')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              selectedCategory === 'uncategorized'
                ? 'bg-amber-500 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>🎯 Offene Zuordnungen</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                selectedCategory === 'uncategorized'
                  ? 'bg-white/25 text-white'
                  : periodStats.openCount > 0
                  ? 'bg-amber-200 text-amber-900'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {periodStats.openCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-2 ${
              selectedCategory === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>📋 Alle Buchungen</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                selectedCategory === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {periodStats.totalCount}
            </span>
          </button>

          {isFetching && (
            <span className="text-[11px] font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full animate-pulse">
              Aktualisiere…
            </span>
          )}
        </div>

        {/* Rechts: Zeitraum, Kategorie-Filter & Suche in einer sauberen Reihe */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Zeitraum */}
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            title="Zeitraum auswählen"
          >
            <option value="all">📅 Alle Monate (Gesamt)</option>
            {availableMonths.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>

          {/* Bestimmte Kategorie filtern */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[210px]"
            title="Nach Kategorie filtern"
          >
            <option value="all">🏷️ Alle Kategorien</option>
            <option value="uncategorized">🎯 Nur Unkategorisiert (Offen)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Suche */}
          <div className="relative flex-1 sm:flex-initial sm:w-60">
            <input
              type="text"
              placeholder="🔍 Lieferant, Text, Betrag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                title="Suche zurücksetzen"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info-Leiste für erledigte, aber bewusst eingeblendet gelassene Buchungen */}
      {doneCount > 0 && (
        <div className="px-4 py-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between">
          <span>
            ✅ <b>{doneCount}</b> gerade zugeordnete Buchung{doneCount === 1 ? ' bleibt' : 'en bleiben'} zur Kontrolle noch sichtbar, bis Sie den Filter wechseln.
          </span>
          <button
            type="button"
            onClick={hideDoneTransactions}
            className="px-3 py-1 bg-white hover:bg-emerald-100 text-emerald-800 font-semibold rounded-lg border border-emerald-300 transition cursor-pointer"
          >
            Erledigte jetzt ausblenden
          </button>
        </div>
      )}

      {/* 3. Kompakte, übersichtliche Tabelle (ohne SEPA-Salat & ohne abgeschnittenen Rand) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Lade Umsätze...</div>
        ) : sortedTransactions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-3xl">{selectedCategory === 'uncategorized' ? '🎉' : '🔎'}</div>
            <div className="text-slate-800 font-bold text-sm">
              {selectedCategory === 'uncategorized'
                ? 'Super! Keine offenen Umsätze in diesem Zeitraum.'
                : 'Keine passenden Umsätze für diese Filter gefunden.'}
            </div>
            {selectedCategory !== 'all' && (
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Alle Buchungen des Zeitraums anzeigen
              </button>
            )}
          </div>
        ) : (
          <div>
            <table className="w-full text-left text-sm text-slate-700 table-fixed">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] border-b border-slate-200 font-bold tracking-wider">
                <tr>
                  <th className="px-3 py-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedTxIds.size > 0 && selectedTxIds.size === sortedTransactions.length}
                      onChange={toggleSelectAllVisible}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                      title="Alle angezeigten Buchungen auswählen"
                    />
                  </th>
                  <th className="px-3 py-3 w-24">
                    <button
                      type="button"
                      onClick={() => toggleSort('date')}
                      className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer uppercase font-bold tracking-wider"
                      title="Nach Datum sortieren"
                    >
                      <span>Datum</span>
                      {sortIndicator('date')}
                    </button>
                  </th>
                  <th className="px-4 py-3">Empfänger & Buchungsdetails</th>
                  <th className="px-3 py-3 w-28 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('amount')}
                      className="inline-flex items-center justify-end gap-1 hover:text-slate-900 cursor-pointer uppercase font-bold tracking-wider w-full"
                      title="Nach Umsatzgröße sortieren"
                    >
                      <span>Betrag</span>
                      {sortIndicator('amount')}
                    </button>
                  </th>
                  <th className="px-4 py-3 w-72 sm:w-80 text-right">Kategorie zuweisen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleTransactions.map((tx) => {
                  const isChecked = selectedTxIds.has(tx.id);
                  const isDoneHere = stickyIdsRef.current.has(tx.id) && !matchesCategoryFilter(tx);
                  const isUncategorized = !tx.category;
                  const { title: displayTitle, isFallback } = getSmartPayeeTitle(tx);
                  const cleanedPurpose = cleanBankPurpose(tx.description);
                  const isExpanded = expandedDescIds.has(tx.id);

                  return (
                    <tr
                      key={tx.id}
                      className={`transition ${
                        isChecked
                          ? 'bg-blue-50/60 border-l-4 border-l-blue-500'
                          : isDoneHere
                          ? 'bg-emerald-50/40 border-l-4 border-l-emerald-400'
                          : isUncategorized
                          ? 'bg-amber-50/25 hover:bg-amber-50/50'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-3 py-3 text-center align-middle">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelectTx(tx.id)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                      </td>

                      {/* Datum */}
                      <td className="px-3 py-3 whitespace-nowrap text-slate-500 font-mono text-xs align-middle">
                        {new Date(tx.date).toLocaleDateString('de-DE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Empfänger + bereinigter 1-zeiliger Verwendungszweck + dezentes Regel-Badge */}
                      <td className="px-4 py-3 align-middle min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm truncate max-w-md">
                            {displayTitle}
                          </span>

                          {isFallback && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                              Bankbuchung
                            </span>
                          )}

                          {/* Dezentes 1-Zeilen-Regel-Badge statt riesigem lila Kasten */}
                          {tx.matchedRule && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200/70 text-indigo-700 text-[11px] font-semibold">
                              <button
                                type="button"
                                onClick={() => handleOpenEditRuleModal(tx.matchedRule!)}
                                title={`Automatische Regel "${tx.matchedRule.pattern}" bearbeiten`}
                                className="hover:underline cursor-pointer flex items-center gap-1"
                              >
                                <span>⚡ Regel: {tx.matchedRule.pattern}</span>
                                <span className="text-[10px] opacity-75">✏️</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveRuleFromTx(tx)}
                                title="Automatische Regel löschen"
                                className="text-indigo-400 hover:text-rose-600 font-bold ml-0.5 cursor-pointer"
                              >
                                ✖
                              </button>
                            </span>
                          )}
                        </div>

                        {/* Bereinigter Verwendungszweck (Klick klappt vollen Bank-Rohtext + IBAN auf) */}
                        <div
                          onClick={() => toggleDescExpand(tx.id)}
                          title="Klicken, um vollständige Bankdaten / IBAN ein- oder auszublenden"
                          className="mt-0.5 text-xs text-slate-500 cursor-pointer hover:text-slate-700"
                        >
                          {isExpanded ? (
                            <div className="mt-1 p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 space-y-1 whitespace-normal break-words font-mono text-[11px]">
                              <div>{tx.description}</div>
                              {tx.iban && <div className="text-slate-400">IBAN: {tx.iban}</div>}
                              <div className="text-[10px] text-blue-600 font-sans font-semibold">▲ Kompaktansicht</div>
                            </div>
                          ) : (
                            <div className="truncate">
                              {cleanedPurpose}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Betrag */}
                      <td className="px-3 py-3 whitespace-nowrap font-extrabold text-sm text-slate-900 text-right tabular-nums align-middle">
                        {formatEuro(tx.amount)}
                      </td>

                      {/* Kategorie-Dropdown + Regel/KI-Button (Kompakt & nie abgeschnitten) */}
                      <td className="px-4 py-3 whitespace-nowrap text-right align-middle">
                        <div className="inline-flex items-center justify-end gap-1.5 w-full">
                          <select
                            value={tx.category?.id || 'uncategorized'}
                            onChange={(e) => handleAssignCategoryDirect(tx.id, e.target.value, false)}
                            className="w-48 sm:w-52 px-2.5 py-1.5 rounded-xl text-xs font-bold border transition focus:ring-2 focus:ring-blue-500 cursor-pointer truncate"
                            style={{
                              backgroundColor: tx.category ? `${tx.category.color}15` : '#fef3c7',
                              color: tx.category ? tx.category.color : '#b45309',
                              borderColor: tx.category ? `${tx.category.color}40` : '#f59e0b',
                            }}
                          >
                            <option value="uncategorized">👉 Kategorie wählen (Offen)</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => {
                              setActiveTx(tx);
                              setSelectedCatId(tx.category?.id || categories[0]?.id || '');
                              setLearnRuleMode('single');
                              setAiResult(null);
                            }}
                            title="Dauerhafte Lieferanten-Regel erstellen oder Gemini KI fragen"
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer shrink-0"
                          >
                            🧠 Regel / KI
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {sortedTransactions.length > visibleCount && (
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
                <span>
                  Zeige <b>{visibleCount}</b> von insgesamt <b>{sortedTransactions.length}</b> Umsätzen
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + 150)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-2xs transition cursor-pointer"
                  >
                    ➕ Weitere 150 Umsätze anzeigen
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleCount(sortedTransactions.length)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-xl border border-slate-200 transition cursor-pointer"
                  >
                    Alle ({sortedTransactions.length}) laden
                  </button>
                </div>
              </div>
            )}
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
                onClick={async () => {
                  const rId = editingRuleFromTx.id;
                  const rPattern = editingRuleFromTx.pattern;
                  setEditingRuleFromTx(null);
                  setTransactions((prev) =>
                    prev.map((t) => (t.matchedRule?.id === rId ? { ...t, matchedRule: null } : t))
                  );
                  await fetch(`/api/rules?id=${rId}&reset=false`, { method: 'DELETE' });
                  setToastMessage(`⚡ Auto-Lernregel "${rPattern}" gelöscht (bisherige Kategorien bleiben erhalten).`);
                  fetchTransactions(true);
                }}
                className="px-3.5 py-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl text-xs font-bold transition border border-rose-200 cursor-pointer"
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
