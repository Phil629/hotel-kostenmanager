'use client';

import { useState, useMemo } from 'react';

interface Category {
  id: string;
  name: string;
  color: string;
}

interface AuditSuggestion {
  id: string;
  date: string;
  amount: number;
  originalPayee: string;
  cleanPayee: string;
  description: string;
  currentCategory: { id: string; name: string; color: string } | null;
  suggestedCategory: { id: string; name: string; color: string } | null;
  confidence: number;
  type: 'NEW_ASSIGNMENT' | 'CORRECTION' | 'CLEANUP';
  reason: string;
  selected: boolean;
}

interface AiMonthAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedMonth: string; // e.g. "2026-08" or "latest" or "all"
  onApplied?: () => void;
  categories: Category[];
}

const GERMAN_MONTHS: Record<string, string> = {
  '01': 'Januar',
  '02': 'Februar',
  '03': 'März',
  '04': 'April',
  '05': 'Mai',
  '06': 'Juni',
  '07': 'Juli',
  '08': 'August',
  '09': 'September',
  '10': 'Oktober',
  '11': 'November',
  '12': 'Dezember',
};

export default function AiMonthAuditModal({
  isOpen,
  onClose,
  selectedMonth,
  onApplied,
  categories,
}: AiMonthAuditModalProps) {
  const [step, setStep] = useState<'IDLE' | 'ANALYZING' | 'REVIEW' | 'APPLYING'>('IDLE');
  const [suggestions, setSuggestions] = useState<AuditSuggestion[]>([]);
  const [summary, setSummary] = useState<{
    newAssignmentsCount: number;
    correctionsCount: number;
    cleanupsCount: number;
    totalProposed: number;
  } | null>(null);
  const [filterTab, setFilterTab] = useState<'ALL' | 'NEW_ASSIGNMENT' | 'CORRECTION' | 'CLEANUP'>('ALL');
  const [autoCreateRules, setAutoCreateRules] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Monat lesbar formatieren
  const displayMonthLabel = useMemo(() => {
    if (!selectedMonth || selectedMonth === 'latest') return 'Aktueller Monat';
    if (selectedMonth === 'all') return 'Alle Monate';
    if (/^\d{4}$/.test(selectedMonth)) return `Jahr ${selectedMonth}`;
    if (/^\d{4}-\d{2}$/.test(selectedMonth)) {
      const [y, m] = selectedMonth.split('-');
      return `${GERMAN_MONTHS[m] || m} ${y}`;
    }
    return selectedMonth;
  }, [selectedMonth]);

  if (!isOpen) return null;

  const handleStartAudit = async () => {
    setStep('ANALYZING');
    setErrorMessage(null);
    try {
      const res = await fetch('/api/ai/month-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fehler beim KI-Prüflauf');
      }

      if (!data.suggestions || data.suggestions.length === 0) {
        setStep('REVIEW');
        setSuggestions([]);
        setSummary({
          newAssignmentsCount: 0,
          correctionsCount: 0,
          cleanupsCount: 0,
          totalProposed: 0,
        });
        return;
      }

      setSuggestions(data.suggestions);
      setSummary(data.summary);
      setStep('REVIEW');
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.message || 'Verbindung zur KI fehlgeschlagen.');
      setStep('IDLE');
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (filterTab !== 'ALL' && s.type !== filterTab) return s;
        return { ...s, selected: checked };
      })
    );
  };

  const toggleItemSelect = (id: string) => {
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)));
  };

  const handleOverrideCategory = (id: string, newCatId: string) => {
    const foundCat = categories.find((c) => c.id === newCatId) || null;
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, suggestedCategory: foundCat, selected: true } : s))
    );
  };

  const filteredSuggestions = useMemo(() => {
    if (filterTab === 'ALL') return suggestions;
    return suggestions.filter((s) => s.type === filterTab);
  }, [suggestions, filterTab]);

  const selectedCount = suggestions.filter((s) => s.selected).length;

  const handleApplyAll = async () => {
    const selectedItems = suggestions.filter((s) => s.selected);
    if (selectedItems.length === 0) return;

    setStep('APPLYING');
    setErrorMessage(null);

    const updates = selectedItems.map((s) => ({
      transactionId: s.id,
      categoryId: s.suggestedCategory?.id || null,
      cleanPayee: s.cleanPayee,
      createRule: autoCreateRules && !!s.suggestedCategory,
      rulePattern: s.cleanPayee || s.originalPayee,
      matchType: 'KEYWORD',
    }));

    try {
      const res = await fetch('/api/ai/month-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'apply',
          updates,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Fehler beim Anwenden der Änderungen');
      }

      setSuccessToast(`🎉 ${data.appliedCount} Buchungen erfolgreich bereinigt & aktualisiert!`);
      if (onApplied) onApplied();

      setTimeout(() => {
        onClose();
        setStep('IDLE');
        setSuccessToast(null);
      }, 1200);
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e.message || 'Fehler beim Speichern');
      setStep('REVIEW');
    }
  };

  const formatEuro = (num: number) => {
    return Math.abs(num).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-xl shadow-md">
              ✨
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold tracking-tight">
                  KI-Monatsbereinigung & Prüflauf
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-blue-500/30 text-blue-200 border border-blue-400/30">
                  {displayMonthLabel}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Automatische Zuordnung offener Buchungen, Plausibilitätsprüfung & Händlerbereinigung mit Gemini KI
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-slate-700">
          {errorMessage && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs sm:text-sm flex items-center justify-between">
              <span>❌ {errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="font-bold opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          )}

          {successToast && (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm font-bold flex items-center gap-2">
              <span>{successToast}</span>
            </div>
          )}

          {/* STEP 1: IDLE / START */}
          {step === 'IDLE' && (
            <div className="py-6 sm:py-8 text-center space-y-6 max-w-xl mx-auto">
              <div className="w-16 h-16 rounded-3xl bg-blue-50 border border-blue-200 flex items-center justify-center text-3xl mx-auto shadow-sm">
                🤖
              </div>

              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Monat „{displayMonthLabel}“ mit KI bereinigen
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-2 leading-relaxed">
                  Die Google Gemini KI scannt alle Bankbuchungen dieses Monats, entschlüsselt kryptische
                  Verwendungszwecke, erkennt Fehlbuchungen und schlägt Ihnen die passenden Hotel-Kategorien vor.
                </p>
              </div>

              {/* 3 Leistungs-Punkte */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <span className="text-lg">🎯</span>
                  <div className="text-xs font-bold text-slate-900">Offene Umsätze zuordnen</div>
                  <p className="text-[11px] text-slate-500">
                    Ordnet unkategorisierte Buchungen präzise der passenden Hotel-Kostenstelle zu.
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <span className="text-lg">⚠️</span>
                  <div className="text-xs font-bold text-slate-900">Plausibilitäts-Check</div>
                  <p className="text-[11px] text-slate-500">
                    Erkennt Fehlzuordnungen (z. B. Telekom-Rechnung versehentlich unter Lebensmittel).
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <span className="text-lg">✨</span>
                  <div className="text-xs font-bold text-slate-900">Händlernamen bereinigen</div>
                  <p className="text-[11px] text-slate-500">
                    Holt den echten Händlernamen aus PayPal- und SEPA-Maschinencodes hervor.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleStartAudit}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-sm rounded-2xl shadow-md transition flex items-center gap-2 mx-auto cursor-pointer"
                >
                  <span>✨</span>
                  <span>KI-Prüflauf für {displayMonthLabel} starten</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: ANALYZING */}
          {step === 'ANALYZING' && (
            <div className="py-16 text-center space-y-4">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  Gemini KI prüft alle Buchungen für {displayMonthLabel}…
                </h3>
                <p className="text-xs text-slate-500">
                  Kryptische PayPal-Texte werden entschlüsselt und Hotel-Kategorien analysiert. Einen Moment bitte…
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: REVIEW FINDINGS */}
          {step === 'REVIEW' && (
            <div className="space-y-4">
              {/* Summary KPIs */}
              {summary && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-2xl bg-blue-50/80 border border-blue-200/80">
                    <span className="text-xs font-semibold text-blue-700">🎯 Neue Zuordnungen</span>
                    <div className="text-2xl font-extrabold text-blue-900 mt-1">
                      {summary.newAssignmentsCount}
                    </div>
                    <span className="text-[11px] text-blue-600">Offene Buchungen mit Vorschlag</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-amber-50/80 border border-amber-200/80">
                    <span className="text-xs font-semibold text-amber-700">⚠️ Plausibilitäts-Korrekturen</span>
                    <div className="text-2xl font-extrabold text-amber-900 mt-1">
                      {summary.correctionsCount}
                    </div>
                    <span className="text-[11px] text-amber-600">Unstimmigkeiten korrigiert</span>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
                    <span className="text-xs font-semibold text-slate-600">✨ Händlernamen bereinigt</span>
                    <div className="text-2xl font-extrabold text-slate-900 mt-1">
                      {summary.cleanupsCount}
                    </div>
                    <span className="text-[11px] text-slate-500">PayPal- / SEPA-Texte gesäubert</span>
                  </div>
                </div>
              )}

              {/* No suggestions notice */}
              {suggestions.length === 0 ? (
                <div className="p-12 text-center space-y-3 bg-slate-50 rounded-2xl border border-slate-200">
                  <div className="text-4xl">🎉</div>
                  <h3 className="text-base font-bold text-slate-900">
                    Alles perfekt! Keine Korrekturen notwendig.
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Die KI hat alle Buchungen für {displayMonthLabel} geprüft. Alle Ausgaben sind bereits
                    vollständig und plausibel den richtigen Kategorien zugeordnet.
                  </p>
                </div>
              ) : (
                <>
                  {/* Filter Tabs & Select All Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                    <div className="inline-flex rounded-xl bg-slate-100 p-1">
                      <button
                        type="button"
                        onClick={() => setFilterTab('ALL')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                          filterTab === 'ALL'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Alle Vorschläge ({suggestions.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterTab('NEW_ASSIGNMENT')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                          filterTab === 'NEW_ASSIGNMENT'
                            ? 'bg-white text-blue-700 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        🎯 Offene ({summary?.newAssignmentsCount || 0})
                      </button>
                      <button
                        type="button"
                        onClick={() => setFilterTab('CORRECTION')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                          filterTab === 'CORRECTION'
                            ? 'bg-white text-amber-700 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        ⚠️ Korrekturen ({summary?.correctionsCount || 0})
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filteredSuggestions.length > 0 && filteredSuggestions.every((s) => s.selected)}
                          onChange={(e) => toggleSelectAll(e.target.checked)}
                          className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                        />
                        <span>Alle ({filteredSuggestions.length}) auswählen</span>
                      </label>
                    </div>
                  </div>

                  {/* Suggestions List */}
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden max-h-[46vh] overflow-y-auto">
                    {filteredSuggestions.map((item) => (
                      <div
                        key={item.id}
                        className={`p-3.5 transition flex items-start gap-3 ${
                          item.selected ? 'bg-white' : 'bg-slate-50/50 opacity-60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => toggleItemSelect(item.id)}
                          className="w-4 h-4 rounded text-blue-600 mt-1 cursor-pointer shrink-0"
                        />

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className="font-mono text-[11px] text-slate-500 font-semibold">
                                {new Date(item.date).toLocaleDateString('de-DE')}
                              </span>

                              {/* Payee Change */}
                              {item.cleanPayee !== item.originalPayee && (
                                <span className="inline-flex items-center gap-1 text-xs">
                                  <span className="line-through text-slate-400 truncate max-w-[140px]">
                                    {item.originalPayee}
                                  </span>
                                  <span className="text-slate-400">➡️</span>
                                  <span className="font-bold text-slate-900 truncate max-w-[200px]">
                                    {item.cleanPayee}
                                  </span>
                                </span>
                              )}

                              {item.cleanPayee === item.originalPayee && (
                                <span className="font-bold text-slate-900 text-xs truncate max-w-[240px]">
                                  {item.cleanPayee}
                                </span>
                              )}

                              <span
                                className={`text-[10px] font-bold px-2 py-0.2 rounded-md ${
                                  item.type === 'NEW_ASSIGNMENT'
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                                    : item.type === 'CORRECTION'
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200/60'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {item.type === 'NEW_ASSIGNMENT'
                                  ? '🎯 Offen → Neu'
                                  : item.type === 'CORRECTION'
                                  ? '⚠️ Falsch → Korrektur'
                                  : '✨ Name bereinigt'}
                              </span>
                            </div>

                            <div className="font-extrabold text-slate-900 text-xs tabular-nums shrink-0">
                              {formatEuro(item.amount)}
                            </div>
                          </div>

                          {/* Purpose text */}
                          <p className="text-[11px] text-slate-500 truncate" title={item.description}>
                            {item.description}
                          </p>

                          {/* Category Change & Reasoning Row */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-100">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] text-slate-400">Kategorie:</span>
                              {item.currentCategory ? (
                                <span
                                  className="text-[10px] font-bold px-2 py-0.5 rounded-md border"
                                  style={{
                                    backgroundColor: `${item.currentCategory.color}15`,
                                    color: item.currentCategory.color,
                                    borderColor: `${item.currentCategory.color}40`,
                                  }}
                                >
                                  {item.currentCategory.name}
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                                  ⚠️ Unkategorisiert
                                </span>
                              )}

                              <span className="text-slate-400 text-xs">➡️</span>

                              {/* Target Category Select */}
                              <select
                                value={item.suggestedCategory?.id || ''}
                                onChange={(e) => handleOverrideCategory(item.id, e.target.value)}
                                className="px-2.5 py-1 rounded-xl text-xs font-bold border transition cursor-pointer max-w-[220px] truncate"
                                style={{
                                  backgroundColor: item.suggestedCategory
                                    ? `${item.suggestedCategory.color}15`
                                    : '#f8fafc',
                                  color: item.suggestedCategory ? item.suggestedCategory.color : '#475569',
                                  borderColor: item.suggestedCategory
                                    ? `${item.suggestedCategory.color}50`
                                    : '#e2e8f0',
                                }}
                              >
                                <option value="">-- Keine Kategorie --</option>
                                {categories.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                              <span className="text-blue-600 font-bold">💡</span>
                              <span className="italic">{item.reason}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 font-bold text-slate-600 ml-1">
                                {item.confidence}% sicher
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 4: APPLYING */}
          {step === 'APPLYING' && (
            <div className="py-16 text-center space-y-4">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-emerald-600 border-t-transparent" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  Wende {selectedCount} KI-Korrekturen für {displayMonthLabel} an…
                </h3>
                <p className="text-xs text-slate-500">
                  Buchungen werden aktualisiert und Regeln für die Zukunft angelegt…
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'REVIEW' && suggestions.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoCreateRules}
                onChange={(e) => setAutoCreateRules(e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 cursor-pointer"
              />
              <span>🧠 Gleichzeitig automatische Lernregeln für diese Lieferanten erstellen</span>
            </label>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Abbrechen
              </button>
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={handleApplyAll}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                <span>✅</span>
                <span>{selectedCount} ausgewählte Korrekturen anwenden</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
