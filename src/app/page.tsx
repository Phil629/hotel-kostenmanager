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
  Tooltip,
  Legend,
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
  // Kategorie, in der die Buchung ursprünglich stand (dort bleibt sie als Platzhalter sichtbar)
  originCat: { id: string; name: string; color: string };
  // Aktuelle neue Kategorie
  toCatId: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function Dashboard() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Zeitraum wird seitenübergreifend gemerkt (gleicher Schlüssel wie auf der Umsätze-Seite)
  const [selectedMonth, setSelectedMonth, monthReady] = usePersistentState<string>('filter.month', 'all');

  // Aufgeklappte Kategorien werden ebenfalls gemerkt
  const [expandedCatList, setExpandedCatList] = usePersistentState<string[]>('dashboard.expandedCats', []);
  const expandedCatIds = useMemo(() => new Set(expandedCatList), [expandedCatList]);

  // Sortierung der Einzelbuchungen innerhalb aufgeklappter Kategorien
  const [txSortBy, setTxSortBy] = usePersistentState<'amount_desc' | 'amount_asc' | 'date_desc' | 'date_asc'>(
    'dashboard.txSort',
    'amount_desc'
  );

  // Aufgeklappte Einzelbuchungs-Texte (damit lange PayPal-/Banktexte komplett lesbar sind)
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

  // Eingefrorene Reihenfolge der Kategorien: Beim Umbuchen springt nichts mehr hin und her.
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);

  // Umgebuchte Buchungen bleiben in ihrer alten Kategorie als Platzhalter stehen (mit "Rückgängig")
  const [movedTx, setMovedTx] = useState<Record<string, MovedTxInfo>>({});

  // Anzahl laufender Umbuchungs-Requests (Refresh erst, wenn alle fertig sind)
  const pendingRequests = useRef(0);

  // Jahr ergibt sich direkt aus dem gewählten Zeitraum
  const activeFilterYear = selectedMonth === 'all' ? 'all' : selectedMonth.slice(0, 4);

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

  // Toast / Notification Message
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Interactive Year Filter for Bar Chart
  const [activeChartYears, setActiveChartYears] = useState<string[]>([]);

  useEffect(() => {
    if (data?.availableYears && activeChartYears.length === 0) {
      setActiveChartYears(data.availableYears);
    }
  }, [data]);

  const toggleChartYear = (year: string) => {
    setActiveChartYears((prev) => {
      if (prev.includes(year)) {
        if (prev.length === 1) return prev; // Keep at least one
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
    '2026': '#2563eb', // Blue
    '2025': '#475569', // Slate / Dark
    '2024': '#0284c7', // Sky blue
    '2023': '#10b981', // Emerald green
  };

  const getYearAverages = () => {
    if (!data?.barChartData) return {};
    const yearsToConsider = activeChartYears.length > 0 ? activeChartYears : data.availableYears || [];
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

  const yearAverages = getYearAverages();

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
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/stats?month=${monthVal}&_t=${Date.now()}`, {
        cache: 'no-store',
      });
      const json: StatsResponse = await res.json();
      // Während noch Umbuchungen laufen, keine (veralteten) Daten übernehmen
      if (silent && pendingRequests.current > 0) return;
      setData(json);

      const freshIds = (json.pieChartData || []).map((c) => c.id);
      if (!silent) {
        // Neuer Zeitraum: Reihenfolge nach Betrag neu festlegen, Platzhalter verwerfen
        setCategoryOrder(freshIds);
        setMovedTx({});
      } else {
        // Hintergrund-Aktualisierung: Reihenfolge beibehalten, neue Kategorien hinten anhängen
        setCategoryOrder((prev) => [...prev, ...freshIds.filter((id) => !prev.includes(id))]);
      }
    } catch (e) {
      console.error('Error fetching stats:', e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!monthReady) return; // erst laden, wenn der gemerkte Zeitraum bekannt ist
    fetchStats(selectedMonth);
    fetchCategories();

    // Auto-refresh when tab or page regains focus
    const handleFocus = () => fetchStats(selectedMonth, true);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [selectedMonth, monthReady]);

  const toggleCategoryExpand = (catId: string) => {
    const isOpen = expandedCatList.includes(catId);
    setExpandedCatList((prev) => (isOpen ? prev.filter((id) => id !== catId) : [...prev, catId]));
    if (isOpen) {
      // Beim Zuklappen die Platzhalter dieser Kategorie aufräumen
      setMovedTx((prev) => {
        const next: Record<string, MovedTxInfo> = {};
        for (const [id, info] of Object.entries(prev)) {
          if (info.originCat.id !== catId) next[id] = info;
        }
        return next;
      });
    }
  };

  // Buchung lokal (sofort) von einer Kategorie in eine andere verschieben – ohne Neuladen
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

    // Aktuelle Kategorie + Buchung finden
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

    // Platzhalter in der Ursprungskategorie pflegen
    const fromCat = currentCat;
    const fromTx = currentTx;
    setMovedTx((prev) => {
      const existing = prev[txId];
      const origin = existing ? existing.originCat : { id: fromCat.id, name: fromCat.name, color: fromCat.color };
      const next = { ...prev };
      if (origin.id === newCategoryId) {
        delete next[txId]; // zurück an den Ursprung -> kein Platzhalter mehr nötig
      } else {
        next[txId] = { tx: fromTx, originCat: origin, toCatId: newCategoryId };
      }
      return next;
    });

    // Sofortige lokale Aktualisierung (kein Ladeflackern, Reihenfolge bleibt)
    setData((prev) => (prev ? moveTxLocally(prev, txId, newCategoryId) : prev));
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
      // Im Hintergrund mit dem Server abgleichen, sobald alle Umbuchungen gespeichert sind
      if (pendingRequests.current === 0) fetchStats(selectedMonth, true);
    }
  };

  // Kategorien in eingefrorener Reihenfolge anzeigen (inkl. Kategorien, die gerade leer geworden sind)
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

  // Ist die angezeigte Reihenfolge nicht mehr nach Betrag sortiert?
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

  // Für Diagramm & Legende immer nach Betrag sortiert
  const pieSorted = useMemo(
    () => (data ? [...data.pieChartData].filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount) : []),
    [data]
  );

  const formatEuro = (num: number) => {
    return num.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  };

  return (
    <div className="space-y-8">
      {/* Header & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Hotel Kosten- & Statistik-Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">
            Finanzübersicht & Auswertung des City Hotel Schottenhof (Echtzeit-Aktualisierung)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/transactions"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl shadow-xs transition flex items-center gap-2"
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

      {/* Sleek Hierarchical Time & Year/Month Filter */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        {/* Step 1: Quick Year Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
            <span>📅 Zeitraum auswählen:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setSelectedMonth('all');
              }}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                activeFilterYear === 'all' && selectedMonth === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <span>📊</span>
              <span>Alle 4 Jahre</span>
            </button>

            {data?.availableYears?.map((year) => {
              const isYearActive = activeFilterYear === year;
              return (
                <button
                  key={year}
                  onClick={() => {
                    setSelectedMonth(year);
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                    isYearActive
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <span>📅</span>
                  <span>{year}</span>
                  {year === '2026' && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${isYearActive ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                      Aktuell
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Specific Month Selector for the active year */}
        {activeFilterYear !== 'all' ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 text-slate-500 font-medium text-xs">
              <span>Monate im Jahr <b>{activeFilterYear}</b>:</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setSelectedMonth(activeFilterYear)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  selectedMonth === activeFilterYear
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60'
                }`}
              >
                📌 Ganzes Jahr {activeFilterYear}
              </button>

              {data?.availableMonths
                ?.filter((m) => m.value.startsWith(`${activeFilterYear}-`))
                .sort((a, b) => a.value.localeCompare(b.value))
                .map((m) => {
                  const isSelected = selectedMonth === m.value;
                  const monthNum = m.value.split('-')[1];
                  const monthName = shortGermanMonths[monthNum] || monthNum;
                  return (
                    <button
                      key={m.value}
                      onClick={() => setSelectedMonth(m.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-2xs font-bold'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-200 border border-slate-200/60'
                      }`}
                    >
                      {monthName}
                    </button>
                  );
                })}
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500 flex items-center justify-between pt-1">
            <span>💡 <i>Wählen Sie oben ein einzelnes Jahr aus (z. B. 2026), um die einzelnen Monate aufzurufen.</i></span>
            <span className="font-semibold text-slate-700">Gesamtauswertung aller Buchungen (2023–2026)</span>
          </div>
        )}
      </div>

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
                <Link href="/transactions?status=UNCATEGORIZED" className="hover:underline">
                  Jetzt zuordnen →
                </Link>
              </div>
            </div>
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Donut Chart - Expenses per Category */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-lg font-bold text-slate-900">Kostenverteilung nach Kategorien</h3>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-semibold">
                    {selectedMonth === 'all' ? 'Alle Monate' : selectedMonth}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-4">Prozentualer Anteil an den Gesamtausgaben</p>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieSorted}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={105}
                        paddingAngle={3}
                        dataKey="amount"
                        isAnimationActive={false}
                      >
                        {pieSorted.map((entry) => (
                          <Cell key={`cell-${entry.id}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(val: any) => formatEuro(Number(val))}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Legend Grid */}
              <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-100 text-xs">
                {pieSorted.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-slate-50">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-slate-700 font-medium truncate">{item.name}</span>
                    </div>
                    <span className="font-bold text-slate-900">{item.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bar Chart - Monthly Comparison with Interactive Year Selection & Dashed Average Line */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 mb-0.5">Monatlicher Ausgabenvergleich</h3>
                    <p className="text-xs text-slate-500">Vergleich der Gesamtkosten pro Monat (Jan–Dez)</p>
                  </div>
                  {/* Dynamic year-specific average chips */}
                  <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto">
                    {Object.entries(yearAverages).map(([year, avgVal]) => {
                      const color = yearColors[year] || '#64748b';
                      return (
                        <div
                          key={`chip-${year}`}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold shadow-2xs"
                        >
                          <span className="w-2.5 h-0.5 border-t-2 border-dashed" style={{ borderColor: color }}></span>
                          <span className="text-slate-600">Ø {year}:</span>
                          <b style={{ color }}>{formatEuro(avgVal)}</b>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Interactive Year Selector Pills */}
                <div className="flex flex-wrap items-center gap-1.5 mb-4 pb-3 border-b border-slate-100 text-xs">
                  <span className="text-slate-500 font-medium mr-1 text-[11px]">Jahre filtern:</span>
                  <button
                    onClick={selectAllChartYears}
                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer ${
                      activeChartYears.length === (data.availableYears?.length || 0)
                        ? 'bg-slate-900 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Alle
                  </button>
                  {data.availableYears?.map((year) => {
                    const isSelected = activeChartYears.includes(year);
                    const color = yearColors[year] || '#64748b';
                    return (
                      <button
                        key={year}
                        onClick={() => toggleChartYear(year)}
                        style={{
                          backgroundColor: isSelected ? color : '#f1f5f9',
                          color: isSelected ? '#ffffff' : '#64748b',
                        }}
                        className={`px-3 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer flex items-center gap-1.5 shadow-2xs hover:opacity-90`}
                        title={`Klicken zum Ein-/Ausblenden von ${year}`}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: isSelected ? '#ffffff' : color }}
                        />
                        <span>{year}</span>
                        {isSelected && <span className="text-[10px] opacity-80">✓</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.barChartData}
                      margin={{ top: 15, right: 10, left: -15, bottom: 0 }}
                      className="cursor-pointer"
                      onClick={(e: any) => {
                        if (e && e.activeLabel) {
                          const mIdx = shortMonthNames.indexOf(e.activeLabel);
                          if (mIdx !== -1) {
                            const mStr = String(mIdx + 1).padStart(2, '0');
                            const targetYear = activeChartYears.includes('2026') ? '2026' : (activeChartYears[0] || '2026');
                            handleSelectMonthDirect(`${targetYear}-${mStr}`);
                          }
                        }
                      }}
                    >
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k€`} />
                      <Tooltip
                        content={({ active, payload, label }: any) => {
                          if (active && payload && payload.length) {
                            return (
                              <div className="bg-slate-900 text-white p-3.5 rounded-xl shadow-2xl text-xs space-y-2 border border-slate-700 min-w-[210px]">
                                <div className="font-bold text-slate-100 border-b border-slate-700 pb-1.5 flex items-center justify-between">
                                  <span>📅 {label} (Ausgaben)</span>
                                  <span className="text-[10px] text-blue-400 font-normal">Klick öffnet Monat ↗</span>
                                </div>
                                <div className="space-y-1.5">
                                  {payload.map((entry: any) => {
                                    const year = entry.dataKey;
                                    const val = Number(entry.value || 0);
                                    const avg = yearAverages[year];
                                    const diff = avg && val > 0 ? val - avg : 0;
                                    return (
                                      <div key={year} className="flex items-center justify-between gap-3 text-xs">
                                        <div className="flex items-center gap-1.5">
                                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                                          <span className="font-semibold text-slate-300">Jahr {year}:</span>
                                        </div>
                                        <div className="text-right">
                                          <span className="font-bold text-white">{formatEuro(val)}</span>
                                          {avg > 0 && val > 0 && (
                                            <span className={`block text-[10px] ${diff > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                              {diff > 0 ? `+${formatEuro(diff)} vs Ø` : `${formatEuro(diff)} vs Ø`}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Legend />
                      {/* Clean dashed lines for each active year (no overlapping text across bars) */}
                      {Object.entries(yearAverages).map(([year, avgVal]) => {
                        const color = yearColors[year] || '#64748b';
                        return (
                          <ReferenceLine
                            key={`ref-${year}`}
                            y={avgVal}
                            stroke={color}
                            strokeDasharray="5 5"
                            strokeWidth={2}
                          />
                        );
                      })}
                      {data.availableYears
                        ?.filter((year) => activeChartYears.includes(year))
                        .map((year) => {
                          const color = yearColors[year] || '#64748b';
                          return (
                            <Bar 
                              key={year} 
                              dataKey={year} 
                              fill={color} 
                              radius={[4, 4, 0, 0]} 
                              name={year} 
                            />
                          );
                        })}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl text-xs text-slate-600 flex items-center justify-between border border-slate-100">
                <span>💡 <b>Berichtsfunktion:</b> Monatliche Zusammenfassungen automatisiert per Telegram oder E-Mail senden.</span>
                <Link href="/reports" className="text-blue-600 font-bold hover:underline shrink-0">
                  Konfigurieren →
                </Link>
              </div>
            </div>
          </div>

          {/* Interactive Expandable Category Table with Direct Recategorization */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Kategorie-Aufschlüsselung im Detail</h3>
                <p className="text-xs text-slate-500">
                  Klicken Sie auf eine Kategorie, um alle zugehörigen Buchungen aufzuklappen und direkt anzupassen.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 font-medium">Einzelbuchungen:</span>
                  <select
                    value={txSortBy}
                    onChange={(e) => setTxSortBy(e.target.value as any)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    <option value="amount_desc">💰 Umsatzgröße (größte zuerst)</option>
                    <option value="amount_asc">💰 Umsatzgröße (kleinste zuerst)</option>
                    <option value="date_desc">📅 Datum (neueste zuerst)</option>
                    <option value="date_asc">📅 Datum (älteste zuerst)</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandAllTxTexts((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer border ${
                    expandAllTxTexts
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                  title="Alle Verwendungszwecke vollständig mehrzeilig anzeigen"
                >
                  {expandAllTxTexts ? '📖 Alle Umsatztexte ausgeklappt' : '📄 Alle Umsatztexte ausklappen'}
                </button>
                {isOrderStale && (
                  <button
                    type="button"
                    onClick={resortCategories}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
                    title="Reihenfolge bleibt beim Umbuchen stabil – hier nach Betrag neu sortieren"
                  >
                    ↕ Kategorien neu sortieren
                  </button>
                )}
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {displayCategories.map((cat) => {
                const isExpanded = expandedCatIds.has(cat.id);

                // Echte Buchungen + Platzhalter für hier weg-verschobene Buchungen
                type Row = { tx: TransactionItem; moved?: MovedTxInfo };
                const ghostRows: Row[] = Object.values(movedTx)
                  .filter((info) => info.originCat.id === cat.id)
                  .map((info) => ({ tx: info.tx, moved: info }));
                const rows: Row[] = [...cat.transactions.map((tx) => ({ tx })), ...ghostRows].sort((a, b) => {
                  if (txSortBy === 'amount_asc') return Math.abs(a.tx.amount) - Math.abs(b.tx.amount);
                  if (txSortBy === 'date_desc') return new Date(b.tx.date).getTime() - new Date(a.tx.date).getTime();
                  if (txSortBy === 'date_asc') return new Date(a.tx.date).getTime() - new Date(b.tx.date).getTime();
                  return Math.abs(b.tx.amount) - Math.abs(a.tx.amount);
                });

                return (
                  <div key={cat.id || cat.name} className="transition">
                    {/* Category Row Header (Clickable Accordion) */}
                    <button
                      type="button"
                      onClick={() => toggleCategoryExpand(cat.id)}
                      className="w-full p-4 sm:px-6 flex items-center justify-between hover:bg-slate-50 text-left transition cursor-pointer"
                    >
                      <div className="flex items-center gap-4 w-5/12">
                        <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        <div>
                          <span className="font-bold text-slate-900 text-sm flex items-center gap-2">
                            {cat.name}
                            <span className="text-xs font-normal text-slate-400">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          </span>
                          <span className="text-xs text-slate-400">{cat.count} Buchungen</span>
                        </div>
                      </div>

                      <div className="w-4/12 hidden sm:block">
                        <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                          <span>Anteil</span>
                          <span className="font-bold text-slate-700">{cat.percentage}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${cat.percentage}%`, backgroundColor: cat.color }}
                          />
                        </div>
                      </div>

                      <div className="text-right flex items-center justify-end gap-4">
                        <span className="font-bold text-slate-900 text-sm block tabular-nums">{formatEuro(cat.amount)}</span>
                        <span className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition">
                          {isExpanded ? 'Zuklappen ▲' : 'Aufklappen ▼'}
                        </span>
                      </div>
                    </button>

                    {/* Expanded Transactions List */}
                    {isExpanded && (
                      <div className="bg-slate-50/70 p-4 sm:px-8 border-t border-b border-slate-200/80 space-y-3">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-2">
                          <span>📑 Einzelbuchungen der Kategorie "{cat.name}" ({cat.transactions.length}):</span>
                          <span className="text-slate-400 font-normal">
                            {ghostRows.length > 0
                              ? 'Verschobene Buchungen verschwinden beim Zuklappen'
                              : 'Direkte Kategorie-Anpassung möglich'}
                          </span>
                        </div>

                        {rows.length === 0 ? (
                          <div className="p-4 text-center text-xs text-slate-400">
                            Keine Buchungen in dieser Kategorie.
                          </div>
                        ) : (
                          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-2xs">
                            {rows.map(({ tx, moved }) => {
                              const isGhost = !!moved;
                              const justArrived = !isGhost && movedTx[tx.id]?.toCatId === cat.id;
                              const targetCat = moved
                                ? moved.toCatId === 'uncategorized'
                                  ? { name: 'Unkategorisiert', color: '#94a3b8' }
                                  : categories.find((c) => c.id === moved.toCatId) || { name: 'Neue Kategorie', color: '#94a3b8' }
                                : null;
                              return (
                                <div
                                  key={`${isGhost ? 'ghost' : 'tx'}-${tx.id}`}
                                  className={`p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition ${
                                    isGhost
                                      ? 'bg-slate-50/80'
                                      : justArrived
                                      ? 'bg-emerald-50/60 border-l-4 border-emerald-400'
                                      : 'hover:bg-slate-50'
                                  }`}
                                >
                                  <div
                                    onClick={() => toggleTxTextExpand(tx.id)}
                                    title="Klicken, um den gesamten Umsatztext ein- oder auszuklappen"
                                    className={`space-y-1 flex-1 min-w-0 cursor-pointer select-text ${isGhost ? 'opacity-50' : ''}`}
                                  >
                                    <div className="font-bold text-slate-900 text-sm flex flex-wrap items-center gap-2">
                                      <span className={isGhost ? 'line-through' : ''}>{tx.payee || 'Unbekannter Empfänger'}</span>
                                      {tx.iban && (
                                        <span className="font-mono text-[11px] text-slate-400 font-normal">
                                          ({tx.iban})
                                        </span>
                                      )}
                                      {tx.description.length > 70 && !expandAllTxTexts && (
                                        <span className="text-[11px] font-semibold text-blue-600 hover:underline">
                                          {expandedTxIds.has(tx.id) ? '▲ Text einklappen' : '▼ Ganzen Text anzeigen'}
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      className={`text-slate-600 text-xs leading-relaxed ${
                                        expandAllTxTexts || expandedTxIds.has(tx.id)
                                          ? 'whitespace-normal break-words bg-slate-50 p-2 rounded-lg border border-slate-200/80 text-slate-800'
                                          : 'truncate'
                                      }`}
                                    >
                                      {tx.description}
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-mono">
                                      Datum: {new Date(tx.date).toLocaleDateString('de-DE')}
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                                    {isGhost && targetCat && (
                                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-600">
                                        → <span className="w-2 h-2 rounded-full" style={{ backgroundColor: targetCat.color }} />
                                        {targetCat.name}
                                      </span>
                                    )}
                                    {justArrived && (
                                      <span className="text-[11px] font-semibold text-emerald-700">✓ neu zugeordnet</span>
                                    )}
                                    <span className={`font-extrabold text-sm text-slate-900 tabular-nums ${isGhost ? 'opacity-50' : ''}`}>
                                      {formatEuro(tx.amount)}
                                    </span>

                                    {isGhost ? (
                                      <button
                                        type="button"
                                        onClick={() => handleRecategorizeTransaction(tx.id, cat.id)}
                                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                                      >
                                        ↩ Rückgängig
                                      </button>
                                    ) : (
                                      <select
                                        value={tx.categoryId || 'uncategorized'}
                                        onChange={(e) => handleRecategorizeTransaction(tx.id, e.target.value)}
                                        className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:border-blue-500 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                                      >
                                        <option value="uncategorized">❓ Unkategorisiert</option>
                                        {categories.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
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
