'use client';

import { useState, useEffect, useMemo } from 'react';

type RuleSortOption = 'count_desc' | 'alpha_asc' | 'newest';

interface Category {
  id: string;
  name: string;
  color: string;
}

interface TransactionMatch {
  id: string;
  date: string;
  amount: number;
  payee: string | null;
  iban: string | null;
  description: string;
  status: string;
  category: Category | null;
}

interface Rule {
  id: string;
  matchType: 'IBAN' | 'PAYEE' | 'KEYWORD';
  pattern: string;
  isAuto: boolean;
  isApproved: boolean;
  category: Category;
  createdAt: string;
  matchingCount: number;
  matchingTransactions: TransactionMatch[];
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter States for Rules
  const [ruleSearchQuery, setRuleSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterApproval, setFilterApproval] = useState<'all' | 'approved' | 'pending'>('all');
  const [ruleSortBy, setRuleSortBy] = useState<RuleSortOption>('count_desc');
  const [visibleRuleCount, setVisibleRuleCount] = useState(80);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Form state (New Rule)
  const [selectedCatId, setSelectedCatId] = useState('');
  const [matchType, setMatchType] = useState<'IBAN' | 'PAYEE' | 'KEYWORD'>('KEYWORD');
  const [pattern, setPattern] = useState('');
  const [addingRule, setAddingRule] = useState(false);

  // Unified Single Modal State
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [targetCategoryId, setTargetCategoryId] = useState<string>('');
  const [editPattern, setEditPattern] = useState<string>('');
  const [editMatchType, setEditMatchType] = useState<'IBAN' | 'PAYEE' | 'KEYWORD'>('KEYWORD');
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [savingRule, setSavingRule] = useState(false);
  const [showInlineRejectOptions, setShowInlineRejectOptions] = useState(false);

  // Toast / Notification Message
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const fetchRules = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/rules');
      const data = await res.json();
      setRules(data.rules || []);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setCategories(data.categories || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchRules();
    fetchCategories();
  }, []);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim() || !selectedCatId) return;

    setAddingRule(true);
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: selectedCatId,
          matchType,
          pattern: pattern.trim(),
          applyToExisting: true,
          isApproved: true,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setPattern('');
        setSelectedCatId('');
        setShowCreateForm(false);
        setToastMsg(`✅ Regel "${pattern.trim()}" angelegt & auf ${data.appliedCount} Umsätze angewendet!`);
        fetchRules(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAddingRule(false);
    }
  };

  // 0ms Optimistic Direct Approval with Automatic Rollback Protection
  const handleApproveRuleDirect = async (rule: Rule) => {
    const previousRules = [...rules];

    // 0ms Optimistic UI update
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isApproved: true } : r)));
    setToastMsg(`✅ Regel "${rule.pattern}" freigegeben & Buchungen zugeordnet!`);

    try {
      const txIds = rule.matchingTransactions
        .filter((t) => !t.category || t.category.id === rule.category?.id)
        .map((t) => t.id);
      const res = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rule.id,
          isApproved: true,
          updateTransactionIds: txIds,
        }),
      });

      if (!res.ok) {
        throw new Error('Fehler beim Speichern der Freigabe auf dem Server');
      }

      fetchRules(true);
    } catch (e) {
      console.error('Fehler beim Speichern der Regel:', e);
      setRules(previousRules);
      setToastMsg(
        `⚠️ Verbindungsfehler: Regel "${rule.pattern}" konnte nicht gespeichert werden. Änderung wurde wiederhergestellt.`
      );
    }
  };

  const openApprovalDetailModal = (rule: Rule, newCatId?: string, openRejectImmediately = false) => {
    setEditingRule(rule);
    setTargetCategoryId(newCatId || rule.category?.id || categories[0]?.id || '');
    setEditPattern(rule.pattern);
    setEditMatchType(rule.matchType);
    setShowInlineRejectOptions(openRejectImmediately);

    const safeMatching = (rule.matchingTransactions || []).filter(
      (t) => !t.category || t.category.id === rule.category?.id
    );
    const defaultIds =
      safeMatching.length > 0 ? safeMatching.map((t) => t.id) : (rule.matchingTransactions || []).map((t) => t.id);
    setSelectedTxIds(new Set(defaultIds));
  };

  const toggleTxSelection = (id: string) => {
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

  const toggleSelectAllTxs = () => {
    if (!editingRule) return;
    const txs = editingRule.matchingTransactions || [];
    if (selectedTxIds.size === txs.length) {
      setSelectedTxIds(new Set());
    } else {
      setSelectedTxIds(new Set(txs.map((t) => t.id)));
    }
  };

  // 0ms Optimistic Save & Approve from Modal with Rollback
  const handleSaveAndApproveRule = async () => {
    if (!editingRule || !targetCategoryId) return;

    const previousRules = [...rules];
    const ruleId = editingRule.id;
    const targetCat = categories.find((c) => c.id === targetCategoryId) || editingRule.category;

    setRules((prev) =>
      prev.map((r) =>
        r.id === ruleId
          ? {
              ...r,
              pattern: editPattern,
              matchType: editMatchType,
              category: targetCat,
              isApproved: true,
            }
          : r
      )
    );

    setEditingRule(null);
    setShowInlineRejectOptions(false);
    setToastMsg(`✅ Regel "${editPattern}" gespeichert & ${selectedTxIds.size} Buchungen aktualisiert!`);

    try {
      const updateTransactionIds = Array.from(selectedTxIds);
      const res = await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ruleId,
          categoryId: targetCategoryId,
          matchType: editMatchType,
          pattern: editPattern,
          isApproved: true,
          updateTransactionIds,
        }),
      });

      if (!res.ok) {
        throw new Error('Fehler beim Speichern der Regel auf dem Server');
      }

      fetchRules(true);
    } catch (e) {
      console.error(e);
      setRules(previousRules);
      setToastMsg(`⚠️ Fehler beim Speichern der Regel "${editPattern}". Änderung wurde wiederhergestellt.`);
    }
  };

  // 0ms Optimistic Rule Rejection / Deletion with Rollback
  const handleExecuteReject = async (resetTransactions: boolean) => {
    if (!editingRule) return;

    const previousRules = [...rules];
    const ruleId = editingRule.id;
    const rulePattern = editingRule.pattern;

    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    setEditingRule(null);
    setShowInlineRejectOptions(false);

    setToastMsg(
      resetTransactions
        ? `❌ Regel "${rulePattern}" gelöscht & Buchungen auf UNKATEGORISIERT zurückgesetzt.`
        : `❌ Regel "${rulePattern}" gelöscht (bisherige Kategorien beibehalten).`
    );

    try {
      const res = await fetch(`/api/rules?id=${ruleId}&reset=${resetTransactions}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Fehler beim Löschen der Regel auf dem Server');
      }

      fetchRules(true);
    } catch (e) {
      console.error(e);
      setRules(previousRules);
      setToastMsg(`⚠️ Server-Fehler beim Löschen der Regel "${rulePattern}". Die Regel wurde wiederhergestellt.`);
    }
  };

  const formatEuro = (num: number) => {
    return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  const pendingRules = rules.filter((r) => !r.isApproved);

  // Filter & sort rules
  const filteredRules = useMemo(() => {
    const filtered = rules.filter((rule) => {
      if (filterCategory !== 'all' && rule.category?.id !== filterCategory) return false;
      if (filterType !== 'all' && rule.matchType !== filterType) return false;
      if (filterApproval !== 'all') {
        if (filterApproval === 'approved' && !rule.isApproved) return false;
        if (filterApproval === 'pending' && rule.isApproved) return false;
      }
      if (ruleSearchQuery.trim()) {
        const q = ruleSearchQuery.toLowerCase().trim();
        const patternMatch = rule.pattern.toLowerCase().includes(q);
        const catMatch = (rule.category?.name || '').toLowerCase().includes(q);
        const typeMatch = rule.matchType.toLowerCase().includes(q);
        if (!patternMatch && !catMatch && !typeMatch) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (ruleSortBy === 'alpha_asc') {
        return a.pattern.localeCompare(b.pattern, 'de');
      }
      if (ruleSortBy === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return (b.matchingCount || 0) - (a.matchingCount || 0) || a.pattern.localeCompare(b.pattern, 'de');
    });
  }, [rules, filterCategory, filterType, filterApproval, ruleSearchQuery, ruleSortBy]);

  const visibleRules = useMemo(
    () => filteredRules.slice(0, visibleRuleCount),
    [filteredRules, visibleRuleCount]
  );

  useEffect(() => {
    setVisibleRuleCount(80);
  }, [filterCategory, filterType, filterApproval, ruleSearchQuery, ruleSortBy]);

  return (
    <div className="space-y-5 pb-16">
      {/* 1. Kompakte Kopfzeile + Aufklappbares Formular für neue Regeln */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                🧠 Automatische Zuordnungs-Regeln
              </h1>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
                {rules.length} Regeln aktiv
              </span>
            </div>
            <p className="text-slate-500 text-xs sm:text-sm mt-0.5">
              Verwalten Sie Ihre gespeicherten Lieferanten- und Suchbegriff-Regeln für die automatische Kategorisierung.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition shadow-xs shrink-0 cursor-pointer flex items-center gap-2 ${
              showCreateForm
                ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {showCreateForm ? '✕ Formular schließen' : '➕ Neue Regel anlegen'}
          </button>
        </div>

        {/* Collapsible Create Form */}
        {showCreateForm && (
          <form
            onSubmit={handleAddRule}
            className="pt-4 border-t border-slate-100 bg-slate-50/70 p-4 rounded-xl border border-slate-200/80 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end animate-in fade-in duration-150"
          >
            <div className="sm:col-span-3">
              <label className="block text-xs font-bold text-slate-700 mb-1">Wo soll gesucht werden?</label>
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as any)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="KEYWORD">🔍 Text & Empfänger (Stichwort)</option>
                <option value="PAYEE">🏢 Nur Empfänger-Name</option>
                <option value="IBAN">🏦 Exakte IBAN</option>
              </select>
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">Suchbegriff / Lieferant / IBAN</label>
              <input
                type="text"
                placeholder={matchType === 'IBAN' ? 'DE1234567890...' : 'z.B. Metro, Telekom oder Bike24'}
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-bold text-slate-700 mb-1">Ziel-Kategorie</label>
              <select
                value={selectedCatId}
                onChange={(e) => setSelectedCatId(e.target.value)}
                className={`w-full px-3 py-2 border rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-500 cursor-pointer ${
                  !selectedCatId
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-white border-slate-300 text-slate-900'
                }`}
              >
                <option value="">-- Kategorie wählen --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={addingRule || !pattern.trim() || !selectedCatId}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {addingRule ? 'Speichere...' : '💾 Speichern'}
              </button>
            </div>
          </form>
        )}
      </div>

      {toastMsg && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm flex items-center justify-between shadow-xs animate-in fade-in duration-150">
          <span>{toastMsg}</span>
          <button onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Pending Approval Alert Banner (nur sichtbar falls unbestätigte Vorschläge existieren) */}
      {pendingRules.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 p-5 rounded-2xl space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-amber-950 flex items-center gap-2">
              <span>⏳</span> {pendingRules.length} Regel-Vorschläge warten auf Ihre Prüfung
            </span>
            <button
              onClick={() => setFilterApproval(filterApproval === 'pending' ? 'all' : 'pending')}
              className="text-xs text-amber-900 font-bold underline hover:text-amber-950 cursor-pointer"
            >
              {filterApproval === 'pending' ? 'Alle Regeln zeigen' : `Nur diese ${pendingRules.length} Vorschläge filtern`}
            </button>
          </div>
        </div>
      )}

      {/* 2. Aufgeräumte 1-Zeilen-Such- & Filterleiste */}
      <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 flex flex-col xl:flex-row gap-3 items-stretch xl:items-center justify-between shadow-xs">
        {/* Links: Breite, übersichtliche Suche */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder="🔍 Regel suchen (z.B. Telekom, Saulheim, KFZ...)"
            value={ruleSearchQuery}
            onChange={(e) => setRuleSearchQuery(e.target.value)}
            className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7"
          />
          {ruleSearchQuery && (
            <button
              type="button"
              onClick={() => setRuleSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
              title="Suche leeren"
            >
              ✕
            </button>
          )}
        </div>

        {/* Rechts: Kategorie, Regel-Typ & Sortierung sauber in einer Reihe */}
        <div className="flex flex-wrap items-center gap-2.5">
          {pendingRules.length > 0 && (
            <div className="flex items-center bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setFilterApproval('all')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  filterApproval === 'all' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
                }`}
              >
                Alle ({rules.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterApproval('pending')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                  filterApproval === 'pending' ? 'bg-amber-500 text-white shadow-2xs' : 'text-slate-600'
                }`}
              >
                ⏳ Offen ({pendingRules.length})
              </button>
            </div>
          )}

          {/* Kategorie-Filter */}
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[210px]"
            title="Nach Kategorie filtern"
          >
            <option value="all">🏷️ Alle Kategorien ({categories.length})</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Typ-Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            title="Nach Regel-Typ filtern"
          >
            <option value="all">🔎 Alle Regel-Typen</option>
            <option value="KEYWORD">🔍 Stichwort (Text & Empfänger)</option>
            <option value="PAYEE">🏢 Lieferanten-Name</option>
            <option value="IBAN">🏦 Exakte IBAN</option>
          </select>

          {/* Sortierung */}
          <select
            value={ruleSortBy}
            onChange={(e) => setRuleSortBy(e.target.value as RuleSortOption)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            title="Sortierung wählen"
          >
            <option value="count_desc">📊 Meiste Buchungen zuerst</option>
            <option value="alpha_asc">🔤 Alphabetisch (A–Z)</option>
            <option value="newest">🕒 Neueste zuerst</option>
          </select>
        </div>
      </div>

      {/* 3. Schlanke, übersichtliche Regeln-Tabelle (nichts mehr abgeschnitten!) */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Lade Regeln...</div>
        ) : filteredRules.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="text-2xl">🔎</div>
            <div className="text-slate-700 font-bold text-sm">Keine passenden Regeln für diese Filter gefunden.</div>
            {(ruleSearchQuery || filterCategory !== 'all' || filterType !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setRuleSearchQuery('');
                  setFilterCategory('all');
                  setFilterType('all');
                  setFilterApproval('all');
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Filter zurücksetzen
              </button>
            )}
          </div>
        ) : (
          <div>
            <table className="w-full text-left text-sm text-slate-700 table-fixed">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[11px] border-b border-slate-200 font-bold tracking-wider">
                <tr>
                  <th className="px-5 py-3">Suchbegriff / Lieferant / IBAN</th>
                  <th className="px-4 py-3 w-60 sm:w-64">Zugewiesene Kategorie</th>
                  <th className="px-4 py-3 w-40 text-center">Erkannte Umsätze</th>
                  <th className="px-5 py-3 w-44 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50/80 transition">
                    {/* Spalte 1: Suchbegriff + einzeiliges Typ-Badge */}
                    <td className="px-5 py-3.5 align-middle min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm break-all">
                          {rule.pattern}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-100 border border-slate-200/70 rounded-md font-semibold text-[11px] text-slate-600 whitespace-nowrap shrink-0">
                          {rule.matchType === 'IBAN'
                            ? '🏦 IBAN'
                            : rule.matchType === 'PAYEE'
                            ? '🏢 Lieferant'
                            : '🔍 Stichwort'}
                        </span>
                        {!rule.isApproved && (
                          <span className="px-2 py-0.5 bg-amber-100 border border-amber-200 text-amber-900 rounded-md text-[11px] font-bold whitespace-nowrap shrink-0">
                            ⏳ Vorschlag
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Spalte 2: Direktes Kategorie-Dropdown */}
                    <td className="px-4 py-3.5 whitespace-nowrap align-middle">
                      <select
                        value={rule.category?.id || ''}
                        onChange={(e) => openApprovalDetailModal(rule, e.target.value)}
                        className="w-full px-3 py-1.5 rounded-xl text-xs font-bold border transition focus:ring-2 focus:ring-blue-500 cursor-pointer truncate"
                        style={{
                          backgroundColor: `${rule.category?.color || '#3b82f6'}15`,
                          color: rule.category?.color || '#3b82f6',
                          borderColor: `${rule.category?.color || '#3b82f6'}40`,
                        }}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Spalte 3: Verknüpfte Buchungen */}
                    <td className="px-4 py-3.5 whitespace-nowrap text-center align-middle">
                      <button
                        type="button"
                        onClick={() => openApprovalDetailModal(rule)}
                        title="Alle verknüpften Buchungen dieser Regel anzeigen"
                        className={`px-3 py-1 rounded-full text-xs font-bold border transition inline-flex items-center gap-1.5 cursor-pointer ${
                          rule.matchingCount > 0
                            ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200/80'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-400 border-slate-200'
                        }`}
                      >
                        <span>
                          🔗 {rule.matchingCount} Buchung{rule.matchingCount === 1 ? '' : 'en'}
                        </span>
                      </button>
                    </td>

                    {/* Spalte 4: Kompakte Aktionen (nie abgeschnitten!) */}
                    <td className="px-5 py-3.5 whitespace-nowrap text-right align-middle">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {!rule.isApproved && (
                          <button
                            type="button"
                            onClick={() => handleApproveRuleDirect(rule)}
                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                            title="Regel freigeben"
                          >
                            ✅
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => openApprovalDetailModal(rule)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition cursor-pointer"
                          title="Suchbegriff, Kategorie oder betroffene Buchungen bearbeiten"
                        >
                          ✏️ Bearbeiten
                        </button>

                        <button
                          type="button"
                          onClick={() => openApprovalDetailModal(rule, undefined, true)}
                          className="px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 text-xs font-bold rounded-xl transition cursor-pointer"
                          title="Regel löschen"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredRules.length > visibleRuleCount && (
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
                <span>
                  Zeige <b>{visibleRuleCount}</b> von insgesamt <b>{filteredRules.length}</b> Regeln
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleRuleCount((prev) => prev + 100)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-2xs transition cursor-pointer"
                  >
                    ➕ Weitere Regeln anzeigen
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleRuleCount(filteredRules.length)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-xl border border-slate-200 transition cursor-pointer"
                  >
                    Alle ({filteredRules.length}) laden
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fully Unified Single Rule Detail & Approval Modal */}
      {editingRule && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 space-y-5 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-slate-900">
                  ⚙️ Regel bearbeiten: {editingRule.pattern}
                </h3>
                {!editingRule.isApproved && (
                  <span className="px-2.5 py-0.5 bg-amber-100 text-amber-900 text-xs font-bold rounded-md border border-amber-200">
                    ⏳ Wartet auf Freigabe
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setEditingRule(null);
                  setShowInlineRejectOptions(false);
                }}
                className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Rule Settings Form */}
            <div className="space-y-3 shrink-0 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Wo soll gesucht werden?</label>
                  <select
                    value={editMatchType}
                    onChange={(e) => setEditMatchType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    <option value="KEYWORD">🔍 Stichwort (Text & Empfänger)</option>
                    <option value="PAYEE">🏢 Lieferanten-Name</option>
                    <option value="IBAN">🏦 Exakte IBAN</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Suchbegriff / Wert</label>
                  <input
                    type="text"
                    value={editPattern}
                    onChange={(e) => setEditPattern(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ziel-Kategorie</label>
                  <select
                    value={targetCategoryId}
                    onChange={(e) => setTargetCategoryId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-blue-600 cursor-pointer"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* List of ALL matching transactions with Full Details & Checkboxes */}
            <div className="space-y-2 flex-1 overflow-hidden flex flex-col min-h-0 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-xs font-bold text-slate-900">
                  🔗 Verknüpfte Buchungen im Detail ({editingRule.matchingTransactions.length} Treffer):
                </span>
                <button
                  type="button"
                  onClick={toggleSelectAllTxs}
                  className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                >
                  {selectedTxIds.size === editingRule.matchingTransactions.length
                    ? 'Alle Haken entfernen'
                    : '☑ Alle Haken setzen'}
                </button>
              </div>

              <div className="overflow-y-auto flex-1 border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white">
                {editingRule.matchingTransactions.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    Keine Buchungen zu dieser Regel in der Datenbank gefunden.
                  </div>
                ) : (
                  editingRule.matchingTransactions.map((tx) => {
                    const isChecked = selectedTxIds.has(tx.id);
                    return (
                      <label
                        key={tx.id}
                        className={`p-3 flex items-start justify-between text-xs cursor-pointer transition ${
                          isChecked ? 'bg-blue-50/70 border-l-4 border-blue-500' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleTxSelection(tx.id)}
                            className="mt-0.5 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                          />
                          <div className="space-y-0.5 min-w-0">
                            <div className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                              {tx.payee || 'Unbekannter Empfänger'}
                              {tx.iban && (
                                <span className="ml-2 font-mono text-[11px] text-slate-400 font-normal">
                                  ({tx.iban})
                                </span>
                              )}
                            </div>
                            <div className="text-slate-600 text-xs break-words">{tx.description}</div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              Datum: {new Date(tx.date).toLocaleDateString('de-DE')}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 ml-4">
                          <span className="font-extrabold text-sm text-slate-900 block tabular-nums">
                            {formatEuro(tx.amount)}
                          </span>
                          <span className="text-[10px] text-slate-500 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 mt-1 inline-block">
                            {tx.category?.name || 'Unkategorisiert'}
                          </span>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* Unified Bottom Action Section */}
            <div className="pt-3 border-t border-slate-100 shrink-0 space-y-3">
              {showInlineRejectOptions ? (
                <div className="bg-rose-50 p-4 rounded-xl border border-rose-200 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-950 flex items-center gap-1.5">
                      <span>🗑️</span> Wie möchten Sie die Regel „{editingRule.pattern}“ löschen?
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowInlineRejectOptions(false)}
                      className="text-xs font-semibold text-rose-700 hover:underline cursor-pointer"
                    >
                      Abbrechen
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleExecuteReject(false)}
                      disabled={savingRule}
                      className="p-3 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-left transition cursor-pointer shadow-2xs group"
                    >
                      <span className="font-bold text-xs text-slate-900 block group-hover:text-blue-600">
                        📌 Kategorien der Umsätze BEIBEHALTEN
                      </span>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        Löscht nur die Regel, lässt aber die bisherigen {editingRule.matchingTransactions.length} Umsätze zugeordnet.
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExecuteReject(true)}
                      disabled={savingRule}
                      className="p-3 bg-white hover:bg-rose-100/70 border border-rose-300 rounded-xl text-left transition cursor-pointer shadow-2xs group"
                    >
                      <span className="font-bold text-xs text-rose-900 block">
                        ↩️ Umsätze auf „Offen“ zurücksetzen
                      </span>
                      <span className="text-[11px] text-rose-700 block mt-0.5">
                        Löscht die Regel UND setzt alle {editingRule.matchingTransactions.length} Umsätze auf Unkategorisiert zurück.
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowInlineRejectOptions(true)}
                    className="px-3.5 py-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl text-xs font-bold transition border border-rose-200 cursor-pointer"
                  >
                    🗑️ Regel löschen...
                  </button>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditingRule(null)}
                      className="px-4 py-2 text-slate-600 text-xs sm:text-sm font-medium hover:bg-slate-100 rounded-xl transition cursor-pointer"
                    >
                      Abbrechen
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveAndApproveRule}
                      disabled={savingRule}
                      className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                    >
                      {savingRule ? 'Speichere...' : `💾 Speichern & ${selectedTxIds.size} Buchungen aktualisieren`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
