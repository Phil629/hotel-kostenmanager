'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LogoutButton from './LogoutButton';
import { usePersistentState } from '../../lib/usePersistentState';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: '📊' },
  { href: '/transactions', label: 'Umsätze', icon: '💳' },
  { href: '/invoices', label: 'Rechnungen', icon: '📄' },
  { href: '/categories', label: 'Kategorien', icon: '🏷️' },
  { href: '/rules', label: 'Regeln', icon: '🧠' },
  { href: '/settings', label: 'Einstellungen', icon: '⚙️' },
];

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

export interface MonthOption {
  value: string;
  label: string;
}

export default function HeaderNav() {
  const pathname = usePathname();
  const [selectedMonth, setSelectedMonth, monthReady] = usePersistentState<string>('filter.period', 'latest');
  const [availableMonths, setAvailableMonths] = usePersistentState<MonthOption[]>('filter.availableMonths', []);

  // Nur echte Monate (YYYY-MM) absteigend sortiert (neuester Monat zuerst)
  const onlyMonthsDesc = useMemo(
    () =>
      availableMonths
        .map((m) => m.value)
        .filter((v) => /^\d{4}-\d{2}$/.test(v))
        .sort((a, b) => b.localeCompare(a)),
    [availableMonths]
  );

  // Alle verfügbaren Jahre (z. B. ['2026', '2025', '2024', '2023'])
  const availableYears = useMemo(() => {
    const set = new Set<string>();
    for (const m of availableMonths) {
      if (/^\d{4}$/.test(m.value)) set.add(m.value);
      else if (/^\d{4}-\d{2}$/.test(m.value)) set.add(m.value.slice(0, 4));
    }
    const arr = Array.from(set).sort((a, b) => b.localeCompare(a));
    return arr.length > 0 ? arr : ['2026', '2025', '2024', '2023'];
  }, [availableMonths]);

  const latestMonthValue = onlyMonthsDesc[0] || '2026-08';

  // Falls "latest" noch nicht aufgelöst ist, auf neuesten Monat setzen
  useEffect(() => {
    if (!monthReady) return;
    if (selectedMonth === 'latest' && onlyMonthsDesc.length > 0) {
      setSelectedMonth(onlyMonthsDesc[0]);
    }
  }, [monthReady, selectedMonth, onlyMonthsDesc, setSelectedMonth]);

  // Falls auf einer Unterseite gestartet wird, availableMonths im Hintergrund laden
  useEffect(() => {
    if (!monthReady || pathname === '/login') return;
    if (availableMonths.length > 0 && selectedMonth !== 'latest') return;

    fetch('/api/stats?month=latest', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.availableMonths) && data.availableMonths.length > 0) {
          setAvailableMonths(data.availableMonths);
        }
        if (selectedMonth === 'latest' && data.resolvedMonth) {
          setSelectedMonth(data.resolvedMonth);
        }
      })
      .catch(() => {});
  }, [monthReady, pathname, availableMonths.length, selectedMonth, setAvailableMonths, setSelectedMonth]);

  if (pathname === '/login') {
    return null;
  }

  // Label für den Hauptbutton in der Leiste
  const formatPeriodLabel = (val: string): string => {
    if (!val || val === 'latest') {
      if (latestMonthValue) {
        const [y, m] = latestMonthValue.split('-');
        return `${GERMAN_MONTHS[m] || m} ${y}`;
      }
      return 'Neuester Monat';
    }
    if (val === 'all') return 'Alle 4 Jahre';
    if (/^\d{4}$/.test(val)) return `Ganzes Jahr ${val}`;
    if (/^\d{4}-\d{2}$/.test(val)) {
      const [y, m] = val.split('-');
      return `${GERMAN_MONTHS[m] || m} ${y}`;
    }
    return val;
  };

  // Pfeil-Navigation (schaltet sauber weiter)
  const handleStepPrev = () => {
    if (/^\d{4}-\d{2}$/.test(selectedMonth)) {
      const idx = onlyMonthsDesc.indexOf(selectedMonth);
      if (idx >= 0 && idx + 1 < onlyMonthsDesc.length) {
        setSelectedMonth(onlyMonthsDesc[idx + 1]);
        return;
      }
    } else if (/^\d{4}$/.test(selectedMonth)) {
      const yIdx = availableYears.indexOf(selectedMonth);
      if (yIdx >= 0 && yIdx + 1 < availableYears.length) {
        setSelectedMonth(availableYears[yIdx + 1]);
        return;
      }
    }
    if (onlyMonthsDesc.length > 0) {
      setSelectedMonth(onlyMonthsDesc[onlyMonthsDesc.length - 1]);
    }
  };

  const handleStepNext = () => {
    if (/^\d{4}-\d{2}$/.test(selectedMonth)) {
      const idx = onlyMonthsDesc.indexOf(selectedMonth);
      if (idx > 0) {
        setSelectedMonth(onlyMonthsDesc[idx - 1]);
        return;
      }
    } else if (/^\d{4}$/.test(selectedMonth)) {
      const yIdx = availableYears.indexOf(selectedMonth);
      if (yIdx > 0) {
        setSelectedMonth(availableYears[yIdx - 1]);
        return;
      }
    }
    if (latestMonthValue) {
      setSelectedMonth(latestMonthValue);
    }
  };

  const isAtOldest =
    /^\d{4}-\d{2}$/.test(selectedMonth) &&
    onlyMonthsDesc.indexOf(selectedMonth) === onlyMonthsDesc.length - 1;
  const isAtNewest =
    /^\d{4}-\d{2}$/.test(selectedMonth) &&
    onlyMonthsDesc.indexOf(selectedMonth) === 0;

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800/80 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-13 flex items-center justify-between gap-3">
        {/* Left: Logo + Globaler Zeitraum-Filter */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link href="/" className="flex items-center gap-2 shrink-0 group">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-sm shadow-xs group-hover:bg-blue-500 transition-colors">
              🏨
            </div>
            <span className="font-bold text-sm tracking-tight text-white hidden sm:inline">
              Kostenmanager
            </span>
          </Link>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          {/* Schlanker, sauberer Zeitraum-Wähler */}
          <div className="inline-flex items-center bg-slate-800/95 hover:bg-slate-800 border border-slate-700 rounded-xl px-1.5 py-1 shadow-2xs transition">
            <button
              type="button"
              disabled={isAtOldest}
              onClick={handleStepPrev}
              className="px-1.5 py-0.5 text-xs text-slate-300 hover:text-white rounded-lg transition disabled:opacity-20 cursor-pointer"
              title="Vorheriger Monat"
            >
              ◀
            </button>

            <div className="relative flex items-center mx-1">
              <span className="text-blue-400 text-xs mr-1 pointer-events-none">📅</span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="bg-transparent text-white text-xs font-bold py-0.5 pr-4 pl-0.5 focus:outline-none cursor-pointer appearance-none"
                title="Zeitraum für Dashboard & Umsätze auswählen"
              >
                <option value={latestMonthValue} className="bg-slate-900 text-white font-bold">
                  ⚡ Letzter Monat ({formatPeriodLabel(latestMonthValue)})
                </option>
                <option value="all" className="bg-slate-900 text-white font-bold">
                  📊 Alle 4 Jahre (Gesamt)
                </option>

                {availableYears.map((year) => {
                  const monthsInYear = onlyMonthsDesc.filter((m) => m.startsWith(`${year}-`));
                  return (
                    <optgroup
                      key={year}
                      label={`── JAHR ${year} ──`}
                      className="bg-slate-900 text-slate-400 font-bold"
                    >
                      <option value={year} className="bg-slate-900 text-white font-bold">
                        📅 Gesamtes Jahr {year}
                      </option>
                      {monthsInYear.map((ym) => {
                        const mNum = ym.split('-')[1];
                        return (
                          <option key={ym} value={ym} className="bg-slate-900 text-slate-200">
                            &nbsp;&nbsp;&nbsp;{GERMAN_MONTHS[mNum] || mNum} {year}
                          </option>
                        );
                      })}
                    </optgroup>
                  );
                })}
              </select>
              <span className="text-[9px] text-slate-400 pointer-events-none absolute right-0">▼</span>
            </div>

            <button
              type="button"
              disabled={isAtNewest}
              onClick={handleStepNext}
              className="px-1.5 py-0.5 text-xs text-slate-300 hover:text-white rounded-lg transition disabled:opacity-20 cursor-pointer"
              title="Nächster Monat"
            >
              ▶
            </button>
          </div>
        </div>

        {/* Right: Navigation Links */}
        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href) || (item.href === '/settings' && pathname.startsWith('/reports'));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                }`}
              >
                <span className="text-xs leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
          <div className="pl-1.5 ml-1 border-l border-slate-800">
            <LogoutButton />
          </div>
        </nav>
      </div>
    </header>
  );
}
