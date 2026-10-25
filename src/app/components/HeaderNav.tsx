'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
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

const SHORT_MONTHS: Record<string, string> = {
  '01': 'Jan',
  '02': 'Feb',
  '03': 'Mär',
  '04': 'Apr',
  '05': 'Mai',
  '06': 'Jun',
  '07': 'Jul',
  '08': 'Aug',
  '09': 'Sep',
  '10': 'Okt',
  '11': 'Nov',
  '12': 'Dez',
};

export interface MonthOption {
  value: string;
  label: string;
}

export default function HeaderNav() {
  const pathname = usePathname();
  const [selectedMonth, setSelectedMonth, monthReady] = usePersistentState<string>('filter.period', 'latest');
  const [availableMonths, setAvailableMonths] = usePersistentState<MonthOption[]>('filter.availableMonths', []);

  const [openDropdown, setOpenDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Klick außerhalb schließt Popover
  useEffect(() => {
    if (!openDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openDropdown]);

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
    if (/^\d{4}$/.test(val)) return `Jahr ${val}`;
    if (/^\d{4}-\d{2}$/.test(val)) {
      const [y, m] = val.split('-');
      return `${GERMAN_MONTHS[m] || m} ${y}`;
    }
    return val;
  };

  // Pfeil-Navigation (schaltet weiter und friert niemals ein)
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

  // 1-Klick Auswahl eines Zeitraums mit sofortigem Schließen
  const selectAndClose = (val: string) => {
    setSelectedMonth(val);
    setOpenDropdown(false);
  };

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800/80 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-13 flex items-center justify-between gap-3">
        {/* Left: Logo + Globaler Zeitraum-Filter */}
        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          <Link href="/" className="flex items-center gap-2 shrink-0 group">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-sm shadow-xs group-hover:bg-blue-500 transition-colors">
              🏨
            </div>
            <span className="font-bold text-sm tracking-tight text-white hidden sm:inline">
              Kostenmanager
            </span>
          </Link>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          {/* Zeitraum-Wähler */}
          <div className="relative" ref={dropdownRef}>
            <div className="inline-flex items-center bg-slate-800/95 border border-slate-700 rounded-xl p-0.5 shadow-2xs">
              <button
                type="button"
                disabled={isAtOldest}
                onClick={handleStepPrev}
                className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700/80 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title="Vorheriger Monat"
              >
                ◀
              </button>

              <button
                type="button"
                onClick={() => setOpenDropdown((prev) => !prev)}
                className="px-2.5 py-1 text-xs font-bold text-white hover:bg-slate-700/80 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                title="Zeitraum auswählen"
              >
                <span className="text-blue-400">📅</span>
                <span>{formatPeriodLabel(selectedMonth)}</span>
                {latestMonthValue && selectedMonth === latestMonthValue && (
                  <span className="hidden md:inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-400/20">
                    Aktuell
                  </span>
                )}
                <span className="text-[10px] text-slate-400 ml-0.5">{openDropdown ? '▲' : '▼'}</span>
              </button>

              <button
                type="button"
                disabled={isAtNewest}
                onClick={handleStepNext}
                className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700/80 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title="Nächster Monat"
              >
                ▶
              </button>
            </div>

            {/* Popover-Menü mit 1-Klick-Auswahl */}
            {openDropdown && (
              <div className="absolute left-0 mt-2 w-84 sm:w-96 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 z-50 space-y-3.5 animate-in fade-in zoom-in-95 duration-100 max-h-[85vh] overflow-y-auto">
                {/* 1. Schnellauswahl oben */}
                <div className="grid grid-cols-2 gap-2 pb-2.5 border-b border-slate-800">
                  <button
                    type="button"
                    onClick={() => selectAndClose(latestMonthValue)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedMonth === latestMonthValue
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <span>⚡</span>
                    <span>Letzter Monat</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => selectAndClose('all')}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedMonth === 'all'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span>📊</span>
                    <span>Alle 4 Jahre</span>
                  </button>
                </div>

                {/* 2. Ganze Jahre (1-Klick-Auswahl) */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Ganzes Jahr wählen (1 Klick):
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {availableYears.map((y) => {
                      const isSelected = selectedMonth === y;
                      return (
                        <button
                          key={y}
                          type="button"
                          onClick={() => selectAndClose(y)}
                          className={`py-2 rounded-xl text-xs font-bold transition cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                            isSelected
                              ? 'bg-blue-600 text-white ring-2 ring-blue-400 shadow-md'
                              : 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white border border-slate-700'
                          }`}
                        >
                          <span>{y}</span>
                          {y === '2026' && (
                            <span className="text-[9px] font-normal text-blue-300">Aktuell</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3. Monate nach Jahren gruppiert */}
                <div className="space-y-3 pt-1 border-t border-slate-800">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Oder Einzelmonat wählen:
                  </div>

                  {availableYears.map((y) => {
                    const monthsInYear = onlyMonthsDesc
                      .filter((ym) => ym.startsWith(`${y}-`))
                      .sort((a, b) => a.localeCompare(b)); // Jan -> Dez

                    if (monthsInYear.length === 0) return null;

                    return (
                      <div key={y} className="bg-slate-850/60 p-2.5 rounded-xl border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                          <span>Jahr {y}</span>
                          <button
                            type="button"
                            onClick={() => selectAndClose(y)}
                            className={`text-[11px] px-2 py-0.5 rounded font-semibold transition cursor-pointer ${
                              selectedMonth === y
                                ? 'bg-blue-600 text-white'
                                : 'text-blue-400 hover:bg-slate-800'
                            }`}
                          >
                            Ganzes Jahr {y}
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-1">
                          {monthsInYear.map((ym) => {
                            const mNum = ym.split('-')[1];
                            const isSelected = selectedMonth === ym;
                            const isLatest = ym === latestMonthValue;

                            return (
                              <button
                                key={ym}
                                type="button"
                                onClick={() => selectAndClose(ym)}
                                className={`py-1.5 px-1 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 cursor-pointer ${
                                  isSelected
                                    ? 'bg-blue-600 text-white font-bold shadow-xs'
                                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                }`}
                              >
                                <span>{SHORT_MONTHS[mNum] || mNum}</span>
                                {isLatest && !isSelected && (
                                  <span className="w-1 h-1 rounded-full bg-blue-400" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 4. Einfache Auswahlliste als Fallback */}
                {availableMonths.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 shrink-0">Liste:</span>
                    <select
                      value={selectedMonth}
                      onChange={(e) => selectAndClose(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-slate-800 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="all">📊 Alle 4 Jahre (Gesamt)</option>
                      {availableYears.map((y) => (
                        <option key={y} value={y}>
                          📅 Gesamtes Jahr {y}
                        </option>
                      ))}
                      <option disabled>──────────────</option>
                      {availableMonths
                        .filter((m) => /^\d{4}-\d{2}$/.test(m.value))
                        .map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label.trim()}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            )}
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
