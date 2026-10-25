'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { usePersistentState } from '../lib/usePersistentState';
import Link from 'next/link';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';

interface Category {
  id: string;
  name: string;
  color: string;
}

interface TransactionItem {
  id: string;
  date: string;
  payee: string | null;
  iban: string | null;
  description: string;
  amount: number;
  categoryId: string | null;
}

interface PieCategoryData {
  id: string;
  name: string;
  amount: number;
  color: string;
  count: number;
  percentage: number;
  transactions: TransactionItem[];
}

interface StatsResponse {
  summary: {
    totalExpense: number;
    transactionCount: number;
    fnbTotal: number;
    energyTotal: number;
    otaTotal: number;
    uncategorizedAmount: number;
  };
  availableMonths: Array<{ value: string; label: string }>;
  pieChartData: PieCategoryData[];
  barChartData: Array<{
    month: string;
    [key: string]: string | number;
  }>;
  availableYears: string[];
}

interface MovedTxInfo {
  tx: TransactionItem;
  originCat: { id: string; name: string; color: string };
  toCatId: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function Dashboard() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Client-Cache für bereits geladene Zeiträume (0ms Wechsel zwischen Monaten/Jahren)
  const statsCacheRef = useRef<Record<string, StatsResponse>>({});
  const lastFetchTimeRef = useRef<number>(0);

  // Limit für aufgeklappte Buchungen pro Kategorie
  const [catRowLimits, setCatRowLimits] = useState<Record<string, number>>({});

  // Zeitraum wird seitenübergreifend gemerkt (mit HeaderNav geteilt)
  const [selectedMonth, setSelectedMonth, monthReady] = usePersistentState<string>('filter.period', 'latest');
  const [, setAvailableMonths] = usePersistentState<Array<{ value: string; label: string }>>('filter.availableMonths', []);

  // Aufgeklappte Kategorien
  const [expandedCatList, setExpandedCatList] = usePersistentState<string[]>('dashboard.expandedCats', []);
  const expandedCatIds = useMemo(() => new Set(expandedCatList), [expandedCatList]);

  // Sortierung der Einzelbuchungen innerhalb aufgeklappter Kategorien
  const [txSortBy, setTxSortBy] = usePersistentState<'amount_desc' | 'amount_asc' | 'date_desc' | 'date_asc'>(
    'dashboard.txSort',
    'amount_desc'
  );

  // Aufgeklappte Einzelbuchungs-Texte
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set());
  const [expandAllTxTexts, setExpandAllTxTexts] = usePersistentState<boolean>('dashboard.expandAllTxTexts', false);

  const toggleTxTextExpand = (txId: string) => {
    setExpandedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [movedTx, setMovedTx] = useState<Record<string, MovedTxInfo>>({});
  const pendingRequests = useRef(0);

  const shortGermanMonths: Record<string, string> = {
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

  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [activeChartYears, setActiveChartYears] = useState<string[]>([]);
  const [hoveredChartYear, setHoveredChartYear] = useState<string | null>(null);
  const [showAvgLines, setShowAvgLines] = useState<boolean>(true);

  useEffect(() => {
    if (data?.availableYears && activeChartYears.length === 0) {
      setActiveChartYears(data.availableYears);
    }
  }, [data]);

  const toggleChartYear = (year: string) => {
    setActiveChartYears((prev) => {
      if (prev.includes(year)) {
        if (prev.length === 1) return prev;
        return prev.filter((y) => y !== year);
      } else {
        return [...prev, year].sort().reverse();
      }
    });
  };

  const selectAllChartYears = () => {
    if (data?.availableYears) {
      setActiveChartYears(data.availableYears);
    }
  };

  const yearColors: Record<string, string> = {
    '2026': '#2563eb',
    '2025': '#334155',
    '2024': '#0ea5e9',
    '2023': '#10b981',
  };

  const getAllYearAverages = () => {
    if (!data?.barChartData) return {};
    const yearsToConsider = data.availableYears || [];
    const averages: Record<string, number> = {};

    for (const y of yearsToConsider) {
      let total = 0;
      let count = 0;
      for (const dataPoint of data.barChartData) {
        const val = dataPoint[y];
        if (typeof val === 'number' && val > 0) {
          total += val;
          count++;
        }
      }
      if (count > 0) {
        averages[y] = Math.round(total / count);
      }
    }
    return averages;
  };

  const shortMonthNames = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  const handleSelectMonthDirect = (val: string) => {
    setSelectedMonth(val);
  };

  const yearAverages = getAllYearAverages();

  const formatEuroWhole = (num: number) => {
    return Math.round(num).toLocaleString('de-DE') + ' €';
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/categories');
      const json = await res.json();
      setCategories(json.categories || []);
    } catch (e) {
      console.error('Error fetching categories:', e);
    }
  };

  const fetchStats = async (monthVal = selectedMonth, silent = false) => {
    const cached = statsCacheRef.current[monthVal];
    if (!silent) {
      if (cached) {
        setData(cached);
        setCategoryOrder((cached.pieChartData || []).map((c) => c.id));
        setMovedTx({});
        setLoading(false);
        setIsRefreshing(true);
      } else if (data) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
    } else {
      setIsRefreshing(true);
    }

    try {
      const res = await fetch(`/api/stats?month=${monthVal}`, {
        cache: 'no-store',
      });
      const json: StatsResponse = await res.json();
      if (silent && pendingRequests.current > 0) return;

      statsCacheRef.current[monthVal] = json;
      lastFetchTimeRef.current = Date.now();
      setData(json);

      if (json.availableMonths) {
        setAvailableMonths(json.availableMonths);
      }
      if (monthVal === 'latest' && (json as any).resolvedMonth) {
        setSelectedMonth((json as any).resolvedMonth);
      }

      const freshIds = (json.pieChartData || []).map((c) => c.id);
      if (!silent) {
        setCategoryOrder(freshIds);
        setMovedTx({});
        setCatRowLimits({});
      } else {
        setCategoryOrder((prev) => [...prev, ...freshIds.filter((id) => !prev.includes(id))]);
      }
    } catch (e) {
      console.error('Error fetching stats:', e);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (!monthReady) return;
    fetchStats(selectedMonth);

    const handleFocus = () => {
      if (Date.now() - lastFetchTimeRef.current > 30000) {
        fetchStats(selectedMonth, true);
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [selectedMonth, monthReady]);

  const toggleCategoryExpand = (catId: string) => {
    const isOpen = expandedCatList.includes(catId);
    setExpandedCatList((prev) => (isOpen ? prev.filter((id) => id !== catId) : [...prev, catId]));
    if (isOpen) {
      setMovedTx((prev) => {
        const next: Record<string, MovedTxInfo> = {};
        for (const [id, info] of Object.entries(prev)) {
          if (info.originCat.id !== catId) next[id] = info;
        }
        return next;
      });
    }
  };

  const moveTxLocally = (prev: StatsResponse, txId: string, toCatId: string): StatsResponse => {
    let fromCatId: string | null = null;
    let movedItem: TransactionItem | null = null;
    for (const c of prev.pieChartData) {
      const found = c.transactions.find((t) => t.id === txId);
      if (found) {
        fromCatId = c.id;
        movedItem = found;
        break;
      }
    }
    if (!movedItem || fromCatId === null || fromCatId === toCatId) return prev;

    const abs = Math.abs(movedItem.amount);
    const updatedTx: TransactionItem = {
      ...movedItem,
      categoryId: toCatId === 'uncategorized' ? null : toCatId,
    };

    let pie = prev.pieChartData.map((c) =>
      c.id === fromCatId
        ? {
            ...c,
            transactions: c.transactions.filter((t) => t.id !== txId),
            amount: round2(c.amount - abs),
            count: c.count - 1,
          }
        : c
    );

    if (pie.some((c) => c.id === toCatId)) {
      pie = pie.map((c) =>
        c.id === toCatId
          ? { ...c, transactions: [...c.transactions, updatedTx], amount: round2(c.amount + abs), count: c.count + 1 }
          : c
      );
    } else {
      const meta = categories.find((c) => c.id === toCatId);
      pie.push({
        id: toCatId,
        name: meta?.name || 'Unkategorisiert',
        color: meta?.color || '#94a3b8',
        amount: round2(abs),
        count: 1,
        percentage: 0,
        transactions: [updatedTx],
      });
    }

    const total = prev.summary.totalExpense;
    pie = pie
      .filter((c) => c.count > 0)
      .map((c) => ({ ...c, percentage: total > 0 ? Math.round((c.amount / total) * 1000) / 10 : 0 }));

    const uncategorizedAmount = pie.find((c) => c.id === 'uncategorized')?.amount || 0;

    return { ...prev, pieChartData: pie, summary: { ...prev.summary, uncategorizedAmount } };
  };

  const handleRecategorizeTransaction = async (txId: string, newCategoryId: string) => {
    if (!data) return;

    let currentCat: PieCategoryData | null = null;
    let currentTx: TransactionItem | null = null;
    for (const cat of data.pieChartData) {
      const found = cat.transactions.find((t) => t.id === txId);
      if (found) {
        currentCat = cat;
        currentTx = found;
        break;
      }
    }
    if (!currentCat || !currentTx || currentCat.id === newCategoryId) return;

    const fromCat = currentCat;
    const fromTx = currentTx;
    setMovedTx((prev) => {
      const existing = prev[txId];
      const origin = existing ? existing.originCat : { id: fromCat.id, name: fromCat.name, color: fromCat.color };
      const next = { ...prev };
      if (origin.id === newCategoryId) {
        delete next[txId];
      } else {
        next[txId] = { tx: fromTx, originCat: origin, toCatId: newCategoryId };
      }
      return next;
    });

    setData((prev) => {
      if (!prev) return prev;
      const updated = moveTxLocally(prev, txId, newCategoryId);
      statsCacheRef.current[selectedMonth] = updated;
      return updated;
    });
    setCategoryOrder((prev) => (prev.includes(newCategoryId) ? prev : [...prev, newCategoryId]));

    const newCatName =
      newCategoryId === 'uncategorized'
        ? 'Unkategorisiert'
        : categories.find((c) => c.id === newCategoryId)?.name || 'neue Kategorie';
    setToastMsg(`✅ ${fromTx.payee || fromTx.description.substring(0, 20)} → ${newCatName}`);

    pendingRequests.current += 1;
    try {
      await fetch('/api/transactions/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: txId,
          categoryId: newCategoryId,
        }),
      });
    } catch (e) {
      console.error('Error recategorizing transaction:', e);
      setToastMsg('❌ Speichern fehlgeschlagen – Daten werden neu geladen.');
    } finally {
      pendingRequests.current -= 1;
      if (pendingRequests.current === 0) fetchStats(selectedMonth, true);
    }
  };

  const displayCategories = useMemo<PieCategoryData[]>(() => {
    if (!data) return [];
    const byId = new Map(data.pieChartData.map((c) => [c.id, c]));
    const originMeta = new Map<string, MovedTxInfo['originCat']>();
    for (const info of Object.values(movedTx)) originMeta.set(info.originCat.id, info.originCat);

    const result: PieCategoryData[] = [];
    for (const id of categoryOrder) {
      const c = byId.get(id);
      if (c) {
        result.push(c);
        byId.delete(id);
      } else if (originMeta.has(id)) {
        const meta = originMeta.get(id)!;
        result.push({ id, name: meta.name, color: meta.color, amount: 0, count: 0, percentage: 0, transactions: [] });
      }
    }
    for (const c of byId.values()) result.push(c);
    return result;
  }, [data, categoryOrder, movedTx]);

  const isOrderStale = useMemo(() => {
    const visible = displayCategories.filter((c) => c.amount > 0);
    for (let i = 1; i < visible.length; i++) {
      if (visible[i].amount > visible[i - 1].amount) return true;
    }
    return displayCategories.length !== visible.length;
  }, [displayCategories]);

  const resortCategories = () => {
    if (!data) return;
    setCategoryOrder([...data.pieChartData].sort((a, b) => b.amount - a.amount).map((c) => c.id));
    setMovedTx({});
  };

  const pieSorted = useMemo(
    () => (data ? [...data.pieChartData].filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount) : []),
    [data]
  );

  const formatEuro = (num: number) => {
    return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  const formatPeriodLabel = (val: string): string => {
    if (!val || val === 'latest') return 'Letzter Monat';
    if (val === 'all') return 'Alle 4 Jahre';
    if (/^\d{4}$/.test(val)) return `Ganzes Jahr ${val}`;
    if (/^\d{4}-\d{2}$/.test(val)) {
      const [y, m] = val.split('-');
      return `${shortGermanMonths[m] || m} ${y}`;
    }
    return val;
  };

  return (
    <div className="space-y-6">
      {/* Header & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Hotel Kosten- & Statistik-Dashboard</h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-white text-slate-800 border border-slate-200 shadow-2xs">
              <span className="text-blue-600">📅</span>
              <span>{formatPeriodLabel(selectedMonth)}</span>
            </span>
            {isRefreshing && (
              <span className="text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200/60 px-2 py-0.5 rounded-full animate-pulse">
                Aktualisiere…
              </span>
            )}
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Finanzübersicht & Auswertung des City Hotel Schottenhof • Zeitraum oben in der Leiste änderbar
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/transactions"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-xs transition flex items-center gap-2"
          >
            ➕ Kontoauszug hochladen
          </Link>
        </div>
      </div>

      {toastMsg && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm flex items-center justify-between shadow-xs animate-in fade-in duration-150">
          <span>{toastMsg}</span>
          <button onClick={() => setToastMsg(null)} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400 border border-slate-200">
          Lade Ausgaben-Statistiken...
        </div>
      ) : !data || data.summary.transactionCount === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 space-y-4">
          <div className="text-5xl">📊</div>
          <h3 className="text-lg font-bold text-slate-800">Keine Umsätze für diesen Zeitraum vorhanden</h3>
          <p className="text-slate-500 max-w-md mx-auto text-sm">
            Wählen Sie einen anderen Monat oder laden Sie weitere Kontoauszüge hoch.
          </p>
        </div>
      ) : (
        <>
          {/* KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-sm font-medium">
                <span>Gesamtausgaben</span>
                <span className="p-2 bg-blue-50 text-blue-600 rounded-lg text-lg">💰</span>
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-3">
                {formatEuro(data.summary.totalExpense)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {data.summary.transactionCount} Transaktionen ({selectedMonth === 'all' ? 'Alle Monate' : selectedMonth})
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-sm font-medium">
                <span>Offene Zuordnungen</span>
                <span className="p-2 bg-purple-50 text-purple-600 rounded-lg text-lg">🔍</span>
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-3">
                {formatEuro(data.summary.uncategorizedAmount)}
              </div>
              <div className="text-xs text-purple-600 mt-1 font-medium">
                {data.summary.uncategorizedAmount > 0 ? (
                  <Link href="/transactions?status=UNCATEGORIZED" className="hover:underline flex items-center gap-1">
                    <span>Jetzt offene Buchungen zuordnen →</span>
                  </Link>
                ) : (
                  <span>✅ Alle Buchungen für diesen Zeitraum zugeordnet</span>
                )}
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left: Donut Chart with integrated Legend */}
            <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-slate-900">Ausgaben nach Kostenstellen</h3>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {pieSorted.length} Kategorien
                  </span>
                </div>

                <div className="h-64 w-full relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieSorted}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="amount"
                      >
                        {pieSorted.map((entry) => (
                          <Cell key={`cell-${entry.id}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any) => [`${formatEuro(Number(value))}`, 'Betrag']}
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderRadius: '12px',
                          color: '#fff',
                          border: 'none',
                          fontSize: '12px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs text-slate-400 font-medium">Summe</span>
                    <span className="text-sm font-extrabold text-slate-800">
                      {formatEuro(data.summary.totalExpense)}
                    </span>
                  </div>
                </div>

                {/* Legend List */}
                <div className="mt-4 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                  {pieSorted.map((cat) => (
                    <div
                      key={cat.id}
                      onClick={() => toggleCategoryExpand(cat.id)}
                      className="flex items-center justify-between text-xs p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer transition"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="text-slate-700 font-medium truncate">{cat.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-slate-900 font-bold tabular-nums">
                          {formatEuro(cat.amount)}
                        </span>
                        <span className="text-slate-400 text-[10px] tabular-nums w-9 text-right">
                          {cat.percentage}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Year Comparison Bar Chart */}
            <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Monatsverlauf & 4-Jahres-Vergleich (2023–2026)
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Klicken Sie auf einen Monat im Balkendiagramm, um ihn direkt auszuwählen.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowAvgLines((prev) => !prev)}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition cursor-pointer ${
                        showAvgLines
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                      title="Monats-Durchschnittslinien im Diagramm ein-/ausblenden"
                    >
                      📈 Ø Linien
                    </button>
                    {activeChartYears.length < (data.availableYears?.length || 4) && (
                      <button
                        type="button"
                        onClick={selectAllChartYears}
                        className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold transition cursor-pointer"
                      >
                        Alle Jahre
                      </button>
                    )}
                  </div>
                </div>

                {/* Year Legend */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
                  {data.availableYears?.map((year) => {
                    const isSelected = activeChartYears.includes(year);
                    const color = yearColors[year] || '#64748b';
                    const avgVal = yearAverages[year] || 0;
                    const isHovered = hoveredChartYear === year;

                    return (
                      <button
                        key={year}
                        type="button"
                        onClick={() => toggleChartYear(year)}
                        onMouseEnter={() => setHoveredChartYear(year)}
                        onMouseLeave={() => setHoveredChartYear(null)}
                        className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                          isSelected
                            ? 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300'
                            : 'bg-slate-50/70 border-slate-100 opacity-50 hover:opacity-80'
                        }`}
                        style={{
                          borderLeftWidth: '4px',
                          borderLeftColor: isSelected ? color : '#cbd5e1',
                          transform: isHovered && isSelected ? 'translateY(-1px)' : 'none',
                        }}
                        title={`Jahr ${year} im Diagramm ${isSelected ? 'ausblenden' : 'einblenden'}`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: isSelected ? color : '#94a3b8' }}
                            />
                            <span className="text-xs font-extrabold text-slate-900">{year}</span>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                              isSelected ? 'text-slate-600 bg-slate-100' : 'text-slate-400'
                            }`}
                          >
                            {isSelected ? 'Aktiv' : 'Aus'}
                          </span>
                        </div>

                        <div className="mt-1.5 flex items-baseline justify-between">
                          <span className="text-[10px] text-slate-400 font-medium">Ø / Mon.</span>
                          <span
                            className="text-xs font-bold tabular-nums tracking-tight"
                            style={{ color: isSelected ? color : '#64748b' }}
                          >
                            {avgVal > 0 ? formatEuroWhole(avgVal) : '–'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Clean Financial BarChart */}
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.barChartData}
                      margin={{ top: 10, right: 8, left: -12, bottom: 0 }}
                      barGap={2}
                      barCategoryGap="20%"
                      className="cursor-pointer"
                      onClick={(e: any) => {
                        if (e && e.activeLabel) {
                          const mIdx = shortMonthNames.indexOf(e.activeLabel);
                          if (mIdx !== -1) {
                            const mStr = String(mIdx + 1).padStart(2, '0');
                            const monthRow = data.barChartData?.[mIdx];
                            const sortedActive = [...activeChartYears].sort().reverse();
                            const yearWithData = sortedActive.find(
                              (y) => monthRow && Number(monthRow[y] || 0) > 0
                            );
                            const targetYear = yearWithData || sortedActive[0] || '2026';
                            handleSelectMonthDirect(`${targetYear}-${mStr}`);
                          }
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="month"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(val) => `${Math.round(val / 1000)}k€`}
                      />
                      <Tooltip
                        formatter={(value: any, name: any) => [formatEuro(Number(value)), `Jahr ${name}`]}
                        labelFormatter={(label) => `Monat: ${label}`}
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderRadius: '12px',
                          color: '#fff',
                          border: 'none',
                          fontSize: '12px',
                        }}
                      />

                      {showAvgLines &&
                        activeChartYears.map((year) => {
                          const avg = yearAverages[year];
                          if (!avg || avg <= 0) return null;
                          const color = yearColors[year] || '#64748b';
                          return (
                            <ReferenceLine
                              key={`avg-${year}`}
                              y={avg}
                              stroke={color}
                              strokeDasharray="4 4"
                              strokeWidth={1.5}
                              strokeOpacity={0.6}
                            />
                          );
                        })}

                      {activeChartYears.map((year) => (
                        <Bar
                          key={year}
                          dataKey={year}
                          fill={yearColors[year] || '#64748b'}
                          radius={[4, 4, 0, 0]}
                          opacity={hoveredChartYear ? (hoveredChartYear === year ? 1 : 0.35) : 0.9}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Collapsible Category Breakdown List */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Kostenstellen-Aufschlüsselung & Einzelbuchungen
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Klicken Sie auf eine Kategorie, um alle darin enthaltenen Buchungen anzuzeigen und bei Bedarf sofort umzubuchen.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {isOrderStale && (
                  <button
                    type="button"
                    onClick={resortCategories}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-xl transition cursor-pointer flex items-center gap-1.5"
                    title="Kategorien nach aktuellem Betrag sortieren"
                  >
                    <span>🔄</span>
                    <span>Nach Betrag ordnen</span>
                  </button>
                )}

                <select
                  value={txSortBy}
                  onChange={(e) => setTxSortBy(e.target.value as any)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none cursor-pointer"
                  title="Sortierung der Buchungen innerhalb der Kategorien"
                >
                  <option value="amount_desc">💰 Höchste Beträge zuerst</option>
                  <option value="amount_asc">💰 Kleinste Beträge zuerst</option>
                  <option value="date_desc">🕒 Neueste Buchungen zuerst</option>
                  <option value="date_asc">🕒 Älteste Buchungen zuerst</option>
                </select>

                <button
                  type="button"
                  onClick={() => setExpandAllTxTexts((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    expandAllTxTexts
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                  title="Alle Buchungstexte vollständig anzeigen oder einkürzen"
                >
                  {expandAllTxTexts ? '📄 Texte kurz' : '📄 Texte lang'}
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {displayCategories.map((cat) => {
                const isExpanded = expandedCatIds.has(cat.id);
                const movedHere = Object.entries(movedTx).filter(([, info]) => info.originCat.id === cat.id);
                const rowLimit = catRowLimits[cat.id] || 40;

                const sortedTx = [...cat.transactions].sort((a, b) => {
                  if (txSortBy === 'amount_desc') return Math.abs(b.amount) - Math.abs(a.amount);
                  if (txSortBy === 'amount_asc') return Math.abs(a.amount) - Math.abs(b.amount);
                  if (txSortBy === 'date_asc') return new Date(a.date).getTime() - new Date(b.date).getTime();
                  return new Date(b.date).getTime() - new Date(a.date).getTime();
                });

                const visibleTx = sortedTx.slice(0, rowLimit);
                const hasMore = sortedTx.length > rowLimit;

                return (
                  <div key={cat.id} className="transition-colors">
                    <div
                      onClick={() => toggleCategoryExpand(cat.id)}
                      className="p-4 sm:p-5 flex items-center justify-between hover:bg-slate-50/80 cursor-pointer transition select-none"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <span
                          className="w-4 h-4 rounded-full shrink-0 shadow-xs"
                          style={{ backgroundColor: cat.color }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm truncate">{cat.name}</span>
                            <span className="text-[11px] text-slate-400 font-medium shrink-0">
                              ({cat.count} {cat.count === 1 ? 'Buchung' : 'Buchungen'})
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <div className="font-extrabold text-slate-900 text-sm tabular-nums">
                            {formatEuro(cat.amount)}
                          </div>
                          <div className="text-[11px] text-slate-400 font-semibold tabular-nums">
                            {cat.percentage}%
                          </div>
                        </div>
                        <span className="text-slate-400 text-xs w-4 text-center">
                          {isExpanded ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="bg-slate-50/60 p-4 sm:p-6 border-t border-slate-100 space-y-3">
                        {movedHere.map(([txId, info]) => {
                          const targetCatName =
                            info.toCatId === 'uncategorized'
                              ? 'Unkategorisiert'
                              : categories.find((c) => c.id === info.toCatId)?.name || 'andere Kategorie';

                          return (
                            <div
                              key={`moved-${txId}`}
                              className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-amber-900 shrink-0">↪️ Umgebucht:</span>
                                <span className="text-amber-800 truncate">
                                  {info.tx.payee || info.tx.description} ({formatEuro(info.tx.amount)})
                                </span>
                                <span className="text-amber-700 shrink-0 font-medium">
                                  → nach <b>{targetCatName}</b>
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRecategorizeTransaction(txId, info.originCat.id)}
                                className="px-2.5 py-1 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold rounded-lg transition shrink-0 cursor-pointer text-[11px]"
                              >
                                ↩️ Rückgängig machen
                              </button>
                            </div>
                          );
                        })}

                        {cat.transactions.length === 0 ? (
                          <div className="text-center py-6 text-xs text-slate-400">
                            Keine Buchungen in dieser Kategorie vorhanden.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {visibleTx.map((tx) => {
                              const isTextExpanded = expandAllTxTexts || expandedTxIds.has(tx.id);
                              return (
                                <div
                                  key={tx.id}
                                  className="p-3 bg-white rounded-xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                >
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-slate-900 text-xs">
                                        {tx.payee || 'Unbekannter Empfänger'}
                                      </span>
                                      <span className="text-[10px] font-mono text-slate-400">
                                        {new Date(tx.date).toLocaleDateString('de-DE')}
                                      </span>
                                    </div>
                                    <p
                                      onClick={() => toggleTxTextExpand(tx.id)}
                                      className={`text-xs text-slate-600 cursor-pointer ${
                                        isTextExpanded ? 'break-words' : 'truncate'
                                      }`}
                                      title={tx.description}
                                    >
                                      {tx.description}
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                                    <span className="font-extrabold text-slate-900 text-xs tabular-nums">
                                      {formatEuro(tx.amount)}
                                    </span>

                                    <select
                                      value={cat.id}
                                      onChange={(e) => handleRecategorizeTransaction(tx.id, e.target.value)}
                                      className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-white cursor-pointer focus:outline-none"
                                    >
                                      <option value="uncategorized">⚠️ Unkategorisiert</option>
                                      {categories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              );
                            })}

                            {hasMore && (
                              <div className="text-center pt-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCatRowLimits((prev) => ({
                                      ...prev,
                                      [cat.id]: (prev[cat.id] || 40) + 60,
                                    }))
                                  }
                                  className="px-4 py-2 bg-slate-200/80 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition cursor-pointer"
                                >
                                  Weitere {sortedTx.length - rowLimit} Buchungen in dieser Kategorie laden
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
