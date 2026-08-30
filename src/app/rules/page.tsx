'use client';

import { useState, useEffect } from 'react';

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
  const [filterApproval, setFilterApproval] = useState<'all' | 'approved' | 'pending'>('approved');

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
      if (data.categories?.length > 0) {
        setSelectedCatId(data.categories[0].id);
      }
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
        body: JSON.stringify({ categoryId: selectedCatId, matchType, pattern, applyToExisting: true, isApproved: true }),
      });

      const data = await res.json();
      if (data.success) {
        setPattern('');
        setToastMsg(`✅ Regel "${pattern}" manuell angelegt, freigegeben & auf ${data.appliedCount} Umsätze angewendet!`);
        fetchRules(true);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAddingRule(false);
    }
  };

  // 0ms Optimistic Direct Approval
  const handleApproveRuleDirect = async (rule: Rule) => {
    // 0ms Optimistic UI update
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, isApproved: true } : r))
    );
    setToastMsg(`✅ Regel "${rule.pattern}" freigegeben & Buchungen zugeordnet!`);

    try {
      const txIds = rule.matchingTransactions.map((t) => t.id);
      await fetch('/api/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rule.id,
          isApproved: true,
          updateTransactionIds: txIds,
        }),
      });
      fetchRules(true);
    } catch (e) {
      console.error(e);
    }
  };

  const openApprovalDetailModal = (rule: Rule, newCatId?: string, openRejectImmediately = false) => {
    setEditingRule(rule);
    setTargetCategoryId(newCatId || rule.category?.id || categories[0]?.id || '');
    setEditPattern(rule.pattern);
    setEditMatchType(rule.matchType);
    setShowInlineRejectOptions(openRejectImmediately);

    const allIds = new Set((rule.matchingTransactions || []).map((t) => t.id));
    setSelectedTxIds(allIds);
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

  // 0ms Optimistic Save & Approve from Modal
  const handleSaveAndApproveRule = async () => {
    if (!editingRule || !targetCategoryId) return;

    const ruleId = editingRule.id;
    const targetCat = categories.find((c) => c.id === targetCategoryId) || editingRule.category;

    // 0ms Optimistic UI Update
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
    setToastMsg(`✅ Regel "${editPattern}" freigegeben & Buchungen neu kategorisiert!`);

    try {
      const updateTransactionIds = Array.from(selectedTxIds);
      await fetch('/api/rules', {
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
      fetchRules(true);
    } catch (e) {
      console.error(e);
    }
  };

  // 0ms Optimistic Rule Rejection / Deletion
  const handleExecuteReject = async (resetTransactions: boolean) => {
    if (!editingRule) return;

    const ruleId = editingRule.id;
    const rulePattern = editingRule.pattern;

    // 0ms Optimistic Instant Removal from State
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    setEditingRule(null);
    setShowInlineRejectOptions(false);

    setToastMsg(
      resetTransactions
        ? `❌ Regel "${rulePattern}" gelöscht & Buchungen auf UNKATEGORISIERT zurückgesetzt.`
        : `❌ Regel "${rulePattern}" gelöscht (bisherige Kategorien beibehalten).`
    );

    try {
      await fetch(`/api/rules?id=${ruleId}&reset=${resetTransactions}`, {
        method: 'DELETE',
      });
      fetchRules(true);
    } catch (e) {
      console.error(e);
    }
  };

  // 0ms Direct Table Delete Button
  const handleDirectDelete = async (rule: Rule) => {
    // 0ms Optimistic Removal
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
    setToastMsg(`❌ Regel "${rule.pattern}" gelöscht.`);

    try {
      await fetch(`/api/rules?id=${rule.id}&reset=false`, {
        method: 'DELETE',
      });
      fetchRules(true);
    } catch (e) {
      console.error(e);
    }
  };

  const formatEuro = (num: number) => {
    return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  const pendingRules = rules.filter((r) => !r.isApproved);
  const approvedRulesCount = rules.filter((r) => r.isApproved).length;

  // Filter rules based on search and selected filters
  const filteredRules = rules.filter((rule) => {
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">🧠 Regelsystem & Freigabe-Zentrale</h1>
        <p className="text-slate-500 text-sm mt-1">
          Nur von Ihnen explizit freigegebene Regeln greifen für automatische Buchungen.
        </p>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm flex items-center justify-between shadow-xs animate-in fade-in duration-150">
          <span>{toastMsg}</span>
          <button onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* Pending Approval Alert Banner */}
      {pendingRules.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-amber-950 flex items-center gap-2">
              <span>⏳</span> {pendingRules.length} Regel-Vorschläge warten auf Ihre Prüfung & Freigabe
            </span>
            <button
              onClick={() => setFilterApproval('pending')}
              className="text-xs text-amber-900 font-bold underline hover:text-amber-950 cursor-pointer"
            >
              Zeige alle {pendingRules.length} ausstehenden Vorschläge in der Tabelle ↓
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-1">
            {pendingRules.slice(0, 10).map((rule) => (
              <div
                key={rule.id}
                className="bg-white p-4 rounded-xl border border-amber-200 flex items-center justify-between shadow-2xs transition-all duration-150"
              >
                <div>
                  <span className="font-bold text-slate-900 block text-sm">{rule.pattern}</span>
                  <span className="text-xs text-slate-500">
                    Vorgeschlagen für: <b className="text-indigo-600">{rule.category?.name}</b> • {rule.matchingCount} Buchungen
                  </span>
                </div>

                {/* Ordered: 🔍 Details | ✅ Freigeben | ❌ Ablehnen */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openApprovalDetailModal(rule)}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition shadow-xs cursor-pointer"
                  >
                    🔍 Details
                  </button>

                  <button
                    onClick={() => handleApproveRuleDirect(rule)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition shadow-xs cursor-pointer"
                  >
                    ✅ Freigeben
                  </button>

                  <button
                    onClick={() => openApprovalDetailModal(rule, undefined, true)}
                    className="px-2.5 py-1.5 text-rose-600 hover:bg-rose-50 text-xs font-bold rounded-lg transition border border-rose-200 cursor-pointer"
                    title="Regel ablehnen / löschen"
                  >
                    ❌ Ablehnen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add New Rule Form */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h3 className="text-base font-bold text-slate-900">➕ Neue Manuelle Zuordnungsregel anlegen & freigeben</h3>
        <form onSubmit={handleAddRule} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Muster-Typ</label>
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="KEYWORD">Stichwort / Text</option>
              <option value="PAYEE">Lieferanten-Name</option>
              <option value="IBAN">Exakte IBAN</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Suchmuster / Wert</label>
            <input
              type="text"
              placeholder={matchType === 'IBAN' ? 'DE1234567890...' : 'z.B. Brauerei oder Metro'}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Kategorie zuweisen</label>
            <select
              value={selectedCatId}
              onChange={(e) => setSelectedCatId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="submit"
              disabled={addingRule || !pattern.trim()}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {addingRule ? 'Speichere...' : 'Regel freigeben & anwenden'}
            </button>
          </div>
        </form>
      </div>

      {/* Rules Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col lg:flex-row gap-4 items-center justify-between shadow-xs">
        {/* Live Search Input */}
        <div className="flex items-center gap-3 w-full lg:w-72">
          <input
            type="text"
            placeholder="🔍 Regel durchsuchen (Name, IBAN...)"
            value={ruleSearchQuery}
            onChange={(e) => setRuleSearchQuery(e.target.value)}
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Status Tabs / Filter */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* Approval Filter Buttons */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setFilterApproval('approved')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                filterApproval === 'approved'
                  ? 'bg-white text-emerald-800 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ✅ Von mir freigegeben ({approvedRulesCount})
            </button>
            <button
              onClick={() => setFilterApproval('pending')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                filterApproval === 'pending'
                  ? 'bg-amber-500 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              ⏳ Wartet auf Freigabe ({pendingRules.length})
            </button>
            <button
              onClick={() => setFilterApproval('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                filterApproval === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Alle ({rules.length})
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-semibold">Kategorie:</span>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">Alle Kategorien</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Match Type Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-semibold">Typ:</span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">Alle Typen</option>
              <option value="IBAN">🏦 IBAN</option>
              <option value="PAYEE">🏢 Lieferant</option>
              <option value="KEYWORD">🔍 Stichwort</option>
            </select>
          </div>
        </div>
      </div>

      {/* Active Rules List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            {filterApproval === 'approved'
              ? `✅ Von Ihnen freigegebene Regeln (${filteredRules.length})`
              : filterApproval === 'pending'
              ? `⏳ Ausstehende Regel-Vorschläge (${filteredRules.length})`
              : `Alle Regelleisten (${filteredRules.length} von ${rules.length})`}
          </h3>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Lade Regeln...</div>
        ) : filteredRules.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Keine passenden Regeln für diesen Status oder Filter gefunden.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200 font-semibold tracking-wider">
                <tr>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Muster-Typ</th>
                  <th className="px-6 py-3">Suchbegriff / IBAN</th>
                  <th className="px-6 py-3">Ziel-Kategorie</th>
                  <th className="px-6 py-3">Verknüpfte Umsätze</th>
                  <th className="px-6 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-slate-50/80 transition">
                    <td className="px-6 py-4 whitespace-nowrap text-xs font-bold">
                      {rule.isApproved ? (
                        <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md">
                          ✅ Freigegeben
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-900 rounded-md">
                          ⏳ Wartet auf Freigabe
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs text-slate-500">
                      <span className="px-2.5 py-1 bg-slate-100 rounded-md font-semibold text-slate-700">
                        {rule.matchType === 'IBAN' ? '🏦 IBAN' : rule.matchType === 'PAYEE' ? '🏢 Lieferant' : '🔍 Stichwort'}
                      </span>
                    </td>

                    <td className="px-6 py-4 font-bold text-slate-900">
                      {rule.pattern}
                    </td>

                    {/* Direct Category Dropdown */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={rule.category?.id || ''}
                        onChange={(e) => openApprovalDetailModal(rule, e.target.value)}
                        className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition focus:ring-2 focus:ring-blue-500 cursor-pointer"
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

                    {/* Linked Transactions Count Button */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => openApprovalDetailModal(rule)}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition flex items-center gap-1.5 cursor-pointer"
                      >
                        <span>🔗 {rule.matchingCount} Buchungen</span>
                        <span className="text-slate-400">→</span>
                      </button>
                    </td>

                    {/* Ordered: 🔍 Details | ✅ Freigeben | ❌ Löschen */}
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => openApprovalDetailModal(rule)}
                        className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                      >
                        🔍 Details
                      </button>

                      {!rule.isApproved && (
                        <button
                          onClick={() => handleApproveRuleDirect(rule)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition cursor-pointer"
                        >
                          ✅ Freigeben
                        </button>
                      )}

                      <button
                        onClick={() => handleDirectDelete(rule)}
                        className="text-red-500 hover:text-red-700 text-xs font-medium px-2 py-1 hover:bg-red-50 rounded-lg transition cursor-pointer"
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                  📋 Regel-Prüfung & Detailansicht: {editingRule.pattern}
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
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Muster-Typ</label>
                  <select
                    value={editMatchType}
                    onChange={(e) => setEditMatchType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    <option value="KEYWORD">Stichwort / Text</option>
                    <option value="PAYEE">Lieferanten-Name</option>
                    <option value="IBAN">Exakte IBAN</option>
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
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Ziel-Kategorie für Freigabe</label>
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
                  🔗 Verknüpfte Buchungen im Detail (Insgesamt {editingRule.matchingTransactions.length}):
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
                        className={`p-3.5 flex items-start justify-between text-xs cursor-pointer transition ${
                          isChecked ? 'bg-blue-50/70 border-l-4 border-blue-500' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleTxSelection(tx.id)}
                            className="mt-0.5 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <div className="space-y-1">
                            <div className="font-bold text-slate-900 text-sm">
                              {tx.payee || 'Unbekannter Empfänger'}
                              {tx.iban && <span className="ml-2 font-mono text-xs text-slate-400 font-normal">({tx.iban})</span>}
                            </div>
                            <div className="text-slate-600 text-xs leading-relaxed">
                              <b>Verwendungszweck:</b> {tx.description}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              Datum: {new Date(tx.date).toLocaleDateString('de-DE')}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 ml-4">
                          <span className="font-extrabold text-sm text-slate-900 block">{formatEuro(tx.amount)}</span>
                          <span className="text-[10px] text-slate-500 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 mt-1 inline-block">
                            Aktuell: {tx.category?.name || 'Unkategorisiert'}
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
                /* Inline Expanded Rejection Choice Box directly inside the same modal */
                <div className="bg-rose-50 p-4 rounded-xl border border-rose-200 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-950 flex items-center gap-1.5">
                      <span>❌</span> Wie möchten Sie die Regel "{editingRule.pattern}" ablehnen / löschen?
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowInlineRejectOptions(false)}
                      className="text-xs font-semibold text-rose-700 hover:underline cursor-pointer"
                    >
                      Zurück zu Aktionen
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
                        📌 Kategorien BEIBEHALTEN
                      </span>
                      <span className="text-[11px] text-slate-500 block mt-0.5">
                        Löscht die Regel, aber lässt die zugeordneten Buchungen unberührt.
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExecuteReject(true)}
                      disabled={savingRule}
                      className="p-3 bg-white hover:bg-rose-100/70 border border-rose-300 rounded-xl text-left transition cursor-pointer shadow-2xs group"
                    >
                      <span className="font-bold text-xs text-rose-900 block">
                        ↩️ Auf UNKATEGORISIERT zurücksetzen
                      </span>
                      <span className="text-[11px] text-rose-700 block mt-0.5">
                        Löscht die Regel UND setzt alle {editingRule.matchingTransactions.length} Buchungen zurück.
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Default Action Bar */
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500 font-medium">
                    {selectedTxIds.size} von {editingRule.matchingTransactions.length} Buchungen werden der Kategorie zugewiesen.
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowInlineRejectOptions(true)}
                      className="px-3.5 py-2 text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-xl text-xs font-bold transition border border-rose-200 cursor-pointer"
                    >
                      ❌ Regel ablehnen / löschen...
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingRule(null)}
                      className="px-4 py-2 text-slate-600 text-sm font-medium hover:bg-slate-100 rounded-xl transition cursor-pointer"
                    >
                      Abbrechen
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveAndApproveRule}
                      disabled={savingRule}
                      className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-xs transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                    >
                      {savingRule ? 'Speichere...' : `✅ Freigeben & ${selectedTxIds.size} Buchungen umstellen`}
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
