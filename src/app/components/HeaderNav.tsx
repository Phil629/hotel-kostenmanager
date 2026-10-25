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

const SHORT_GERMAN_MONTHS: Record<string, string> = {
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
  const [activeTabYear, setActiveTabYear] = useState<string>('');
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

  // Alle verfügbaren Jahre (YYYY) absteigend sortiert
  const availableYears = useMemo(() => {
    const set = new Set<string>();
    for (const m of availableMonths) {
      if (/^\d{4}$/.test(m.value)) set.add(m.value);
      else if (/^\d{4}-\d{2}$/.test(m.value)) set.add(m.value.slice(0, 4));
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [availableMonths]);

  const latestMonthValue = onlyMonthsDesc[0] || null;

  // Falls "latest" noch nicht aufgelöst ist, sobald availableMonths vorliegt auf den neuesten Monat setzen
  useEffect(() => {
    if (!monthReady) return;
    if (selectedMonth === 'latest' && latestMonthValue) {
      setSelectedMonth(latestMonthValue);
    }
  }, [monthReady, selectedMonth, latestMonthValue, setSelectedMonth]);

  // Falls der Nutzer auf einer Unterseite startet, die selbst keine availableMonths lädt, einmalig abrufen
  useEffect(() => {
    if (!monthReady || pathname === '/login') return;
    if (availableMonths.length > 0 && selectedMonth !== 'latest') return;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/stats?month=latest', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.availableMonths) && data.availableMonths.length > 0) {
          setAvailableMonths(data.availableMonths);
        }
        if (selectedMonth === 'latest' && data.resolvedMonth) {
          setSelectedMonth(data.resolvedMonth);
        }
      } catch {
        // ignore
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [monthReady, pathname, availableMonths.length, selectedMonth, setAvailableMonths, setSelectedMonth]);

  // Aktives Jahr im Popover synchron halten
  useEffect(() => {
    if (selectedMonth && /^\d{4}/.test(selectedMonth)) {
      setActiveTabYear(selectedMonth.slice(0, 4));
    } else if (availableYears.length > 0 && !activeTabYear) {
      setActiveTabYear(availableYears[0]);
    }
  }, [selectedMonth, availableYears, activeTabYear]);

  // Klick außerhalb schließt das Popover
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

  // Formatierte Anzeige des aktuell gewählten Zeitraums
  const formatPeriodLabel = (val: string): string => {
    if (!val || val === 'latest') {
      if (latestMonthValue) {
        const [y, m] = latestMonthValue.split('-');
        return `${GERMAN_MONTHS[m] || m} ${y}`;
      }
      return 'Letzter Monat';
    }
    if (val === 'all') return 'Alle 4 Jahre';
    if (/^\d{4}$/.test(val)) return `Ganzes Jahr ${val}`;
    if (/^\d{4}-\d{2}$/.test(val)) {
      const [y, m] = val.split('-');
      return `${GERMAN_MONTHS[m] || m} ${y}`;
    }
    return val;
  };

  // Vorheriger / Nächster Monat Navigation (chronologisch)
  const currentMonthIdx = onlyMonthsDesc.indexOf(
    selectedMonth === 'latest' && latestMonthValue ? latestMonthValue : selectedMonth
  );
  // In onlyMonthsDesc ist Index 0 der neueste Monat, Index + 1 ist der chronologisch vorherige (ältere) Monat
  const prevChronologicalMonth =
    currentMonthIdx >= 0 && currentMonthIdx + 1 < onlyMonthsDesc.length
      ? onlyMonthsDesc[currentMonthIdx + 1]
      : null;
  const nextChronologicalMonth =
    currentMonthIdx > 0 ? onlyMonthsDesc[currentMonthIdx - 1] : null;

  const monthsInActiveTabYear = onlyMonthsDesc
    .filter((ym) => ym.startsWith(`${activeTabYear}-`))
    .sort((a, b) => a.localeCompare(b)); // Jan -> Dez innerhalb des Jahres

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800/80 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-13 flex items-center justify-between gap-3">
        {/* Left: Logo + Globaler Zeitraum-Filter */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <Link href="/" className="flex items-center gap-2 shrink-0 group">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-sm shadow-xs group-hover:bg-blue-500 transition-colors">
              🏨
            </div>
            <span className="font-bold text-sm tracking-tight text-white hidden sm:inline">
              Kostenmanager
            </span>
          </Link>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          {/* Globaler Zeitraum-Wähler in der oberen Leiste */}
          <div className="relative" ref={dropdownRef}>
            <div className="inline-flex items-center bg-slate-800/90 border border-slate-700/80 rounded-xl p-0.5 shadow-2xs">
              <button
                type="button"
                disabled={!prevChronologicalMonth}
                onClick={() => prevChronologicalMonth && setSelectedMonth(prevChronologicalMonth)}
                className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700/70 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title={
                  prevChronologicalMonth
                    ? `Vorheriger Monat (${formatPeriodLabel(prevChronologicalMonth)})`
                    : 'Ältester Monat erreicht'
                }
              >
                ◀
              </button>

              <button
                type="button"
                onClick={() => setOpenDropdown((prev) => !prev)}
                className="px-2.5 py-1 text-xs font-bold text-white hover:bg-slate-700/70 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                title="Zeitraum für Dashboard & Umsätze auswählen"
              >
                <span className="text-blue-400">📅</span>
                <span>{formatPeriodLabel(selectedMonth)}</span>
                {latestMonthValue && selectedMonth === latestMonthValue && (
                  <span className="hidden md:inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-400/20">
                    Aktuell
                  </span>
                )}
                <span className="text-[10px] text-slate-400 ml-0.5">{openDropdown ? '▴' : '▾'}</span>
              </button>

              <button
                type="button"
                disabled={!nextChronologicalMonth}
                onClick={() => nextChronologicalMonth && setSelectedMonth(nextChronologicalMonth)}
                className="px-2 py-1 text-xs text-slate-300 hover:text-white hover:bg-slate-700/70 rounded-lg transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                title={
                  nextChronologicalMonth
                    ? `Nächster Monat (${formatPeriodLabel(nextChronologicalMonth)})`
                    : 'Neuester Monat erreicht'
                }
              >
                ▶
              </button>
            </div>

            {/* Popover-Menü für Jahr & Monat */}
            {openDropdown && (
              <div className="absolute left-0 mt-2 w-80 sm:w-96 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 z-50 space-y-3.5 animate-in fade-in duration-100">
                {/* Schnellauswahl: Letzter Monat vs. Alle Jahre */}
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  {latestMonthValue && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMonth(latestMonthValue);
                        setOpenDropdown(false);
                      }}
                      className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                        selectedMonth === latestMonthValue
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                      }`}
                    >
                      <span>⚡</span>
                      <span>Letzter Monat ({formatPeriodLabel(latestMonthValue)})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMonth('all');
                      setOpenDropdown(false);
                    }}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      selectedMonth === 'all'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span>📊</span>
                    <span>Alle Jahre</span>
                  </button>
                </div>

                {/* Jahres-Tabs */}
                {availableYears.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Jahr wählen
                      </span>
                      {activeTabYear && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMonth(activeTabYear);
                            setOpenDropdown(false);
                          }}
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-lg transition cursor-pointer ${
                            selectedMonth === activeTabYear
                              ? 'bg-blue-600 text-white'
                              : 'text-blue-400 hover:bg-slate-800'
                          }`}
                        >
                          📌 Ganzes Jahr {activeTabYear} zeigen
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-4 gap-1.5">
                      {availableYears.map((y) => {
                        const isTabActive = activeTabYear === y;
                        const isWholeYearSelected = selectedMonth === y;
                        return (
                          <button
                            key={y}
                            type="button"
                            onClick={() => setActiveTabYear(y)}
                            className={`py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                              isWholeYearSelected
                                ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                                : isTabActive
                                ? 'bg-slate-700 text-white'
                                : 'bg-slate-800/70 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                            }`}
                          >
                            {y}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Monats-Grid des aktiven Jahres */}
                {activeTabYear && (
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Monate in {activeTabYear}
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {monthsInActiveTabYear.map((ym) => {
                        const mNum = ym.split('-')[1];
                        const isSelected = selectedMonth === ym;
                        const isLatest = ym === latestMonthValue;
                        return (
                          <button
                            key={ym}
                            type="button"
                            onClick={() => {
                              setSelectedMonth(ym);
                              setOpenDropdown(false);
                            }}
                            className={`px-2.5 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-between cursor-pointer ${
                              isSelected
                                ? 'bg-blue-600 text-white font-bold shadow-xs'
                                : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
                            }`}
                          >
                            <span>{SHORT_GERMAN_MONTHS[mNum] || mNum} {activeTabYear.slice(2)}</span>
                            {isLatest && !isSelected && (
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" title="Neuester Monat" />
                            )}
                          </button>
                        );
                      })}
                    </div>
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
