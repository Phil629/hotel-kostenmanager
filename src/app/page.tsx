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
} from 'recharts';

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
  pieChartData: Array<{
    id: string;
    name: string;
    amount: number;
    color: string;
    count: number;
    percentage: number;
  }>;
  barChartData: Array<{
    monthKey: string;
    month: string;
    total: number;
  }>;
}

export default function Dashboard() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');
  const [seedLoading, setSeedLoading] = useState(false);

  const fetchStats = async (monthVal = selectedMonth) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stats?month=${monthVal}&_t=${Date.now()}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Error fetching stats:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats(selectedMonth);

    // Auto-refresh when tab or page regains focus
    const handleFocus = () => fetchStats(selectedMonth);
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [selectedMonth]);

  const handleSeedSample = async () => {
    setSeedLoading(true);
    try {
      await fetch('/api/seed-sample', { method: 'POST' });
      await fetchStats(selectedMonth);
    } catch (e) {
      console.error(e);
    } finally {
      setSeedLoading(false);
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
          <button
            onClick={handleSeedSample}
            disabled={seedLoading}
            className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-sm font-medium rounded-xl transition border border-indigo-200 flex items-center gap-2"
          >
            {seedLoading ? 'Lade Daten...' : '🧪 Demo-Daten laden'}
          </button>

          <Link
            href="/transactions"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl shadow-xs transition flex items-center gap-2"
          >
            ➕ Kontoauszug hochladen
          </Link>
        </div>
      </div>

      {/* Prominent Month Selector Tabs */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm">
          <span>📅 Zeitfenster / Monatsfilter:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedMonth('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
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
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition ${
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
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
                <span>F&B (Gastronomie)</span>
                <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg text-lg">🍷</span>
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-3">
                {formatEuro(data.summary.fnbTotal)}
              </div>
              <div className="text-xs text-emerald-600 mt-1 font-medium">
                Lebensmittel & Getränke
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 text-sm font-medium">
                <span>OTA Provisionen</span>
                <span className="p-2 bg-cyan-50 text-cyan-600 rounded-lg text-lg">🏨</span>
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-3">
                {formatEuro(data.summary.otaTotal)}
              </div>
              <div className="text-xs text-cyan-600 mt-1 font-medium">
                Booking, Expedia & HRS
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
                {data.pieChartData.slice(0, 8).map((item) => (
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
                        formatter={(val: any) => formatEuro(Number(val))}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)' }}
                      />
                      <Bar dataKey="total" fill="#2563eb" radius={[6, 6, 0, 0]} name="Gesamtkosten" />
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

          {/* Detailed Category Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Kategorie-Aufschlüsselung im Detail</h3>
                <p className="text-xs text-slate-500">Alle Kategorien für den gewählten Zeitraum</p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {data.pieChartData.map((cat) => (
                <div key={cat.name} className="p-4 sm:px-6 flex items-center justify-between hover:bg-slate-50/80 transition">
                  <div className="flex items-center gap-4 w-1/3">
                    <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <div>
                      <span className="font-semibold text-slate-900 text-sm block">{cat.name}</span>
                      <span className="text-xs text-slate-400">{cat.count} Buchungen</span>
                    </div>
                  </div>

                  <div className="w-1/3 hidden sm:block">
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

                  <div className="text-right">
                    <span className="font-bold text-slate-900 text-sm block">{formatEuro(cat.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
