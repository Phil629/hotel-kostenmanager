'use client';

import { useState, useEffect } from 'react';
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

export default function Dashboard() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  
  // Accordion state for expanded categories
  const [expandedCatIds, setExpandedCatIds] = useState<Set<string>>(new Set());

  // Toast / Notification Message
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Error fetching stats:', e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(selectedMonth);
    fetchCategories();

    // Auto-refresh when tab or page regains focus
    const handleFocus = () => fetchStats(selectedMonth, true);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [selectedMonth]);

  const toggleCategoryExpand = (catId: string) => {
    setExpandedCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  };

  const handleRecategorizeTransaction = async (txId: string, newCategoryId: string) => {
    if (!data) return;

    // Find current category and transaction name for toast
    let txName = 'Buchung';
    for (const cat of data.pieChartData) {
      const found = cat.transactions.find((t) => t.id === txId);
      if (found) {
        txName = found.payee || found.description.substring(0, 20);
        break;
      }
    }

    setToastMsg(`✅ ${txName} neu zugeordnet!`);

    try {
      const res = await fetch('/api/transactions/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: txId,
          categoryId: newCategoryId,
        }),
      });

      if (res.ok) {
        // Silently update dashboard stats to re-calculate amounts
        fetchStats(selectedMonth, true);
      }
    } catch (e) {
      console.error('Error recategorizing transaction:', e);
    }
  };

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

      {/* Prominent Month Selector Tabs */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm">
          <span>📅 Zeitfenster / Monatsfilter:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedMonth('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              selectedMonth === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            📊 Alle Monate (Gesamt)
          </button>

          {data?.availableMonths?.map((m) => (
            <button
              key={m.value}
              onClick={() => setSelectedMonth(m.value)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                selectedMonth === m.value
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
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
                        data={data.pieChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={105}
                        paddingAngle={3}
                        dataKey="amount"
                      >
                        {data.pieChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
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
                {data.pieChartData.map((item) => (
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

            {/* Bar Chart - Monthly Comparison */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Monatlicher Ausgabenvergleich</h3>
                <p className="text-xs text-slate-500 mb-4">Vergleich der Gesamtkosten pro Monat</p>

                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.barChartData}>
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k€`} />
                      <Tooltip
                        formatter={(val: any, name: any) => [formatEuro(Number(val)), `Jahr ${name}`]}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)' }}
                      />
                      <Legend />
                      {data.availableYears?.map((year, i) => {
                        const colors = ['#2563eb', '#64748b', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6'];
                        return (
                          <Bar 
                            key={year} 
                            dataKey={year} 
                            fill={colors[i % colors.length]} 
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
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Kategorie-Aufschlüsselung im Detail</h3>
                <p className="text-xs text-slate-500">
                  Klicken Sie auf eine Kategorie, um alle zugehörigen Buchungen aufzuklappen und direkt anzupassen.
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {data.pieChartData.map((cat) => {
                const isExpanded = expandedCatIds.has(cat.id);
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
                        <span className="font-bold text-slate-900 text-sm block">{formatEuro(cat.amount)}</span>
                        <span className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition">
                          {isExpanded ? 'Zuklappen ▲' : 'Aufklappen ▼'}
                        </span>
                      </div>
                    </button>

                    {/* Expanded Transactions List */}
                    {isExpanded && (
                      <div className="bg-slate-50/70 p-4 sm:px-8 border-t border-b border-slate-200/80 space-y-3 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-2">
                          <span>📑 Einzelbuchungen der Kategorie "{cat.name}" ({cat.transactions.length}):</span>
                          <span className="text-slate-400 font-normal">Direkte Kategorie-Anpassung möglich</span>
                        </div>

                        {cat.transactions.length === 0 ? (
                          <div className="p-4 text-center text-xs text-slate-400">
                            Keine Buchungen in dieser Kategorie.
                          </div>
                        ) : (
                          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 shadow-2xs">
                            {[...cat.transactions].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).map((tx) => (
                              <div
                                key={tx.id}
                                className="p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-50 transition"
                              >
                                <div className="space-y-0.5 max-w-lg">
                                  <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                                    <span>{tx.payee || 'Unbekannter Empfänger'}</span>
                                    {tx.iban && (
                                      <span className="font-mono text-[11px] text-slate-400 font-normal">
                                        ({tx.iban})
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-slate-600 text-xs leading-relaxed truncate">
                                    {tx.description}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-mono">
                                    Datum: {new Date(tx.date).toLocaleDateString('de-DE')}
                                  </div>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                                  <span className="font-extrabold text-sm text-slate-900">
                                    {formatEuro(tx.amount)}
                                  </span>

                                  {/* Direct Category Dropdown */}
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
                                </div>
                              </div>
                            ))}
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
