'use client';

import { useEffect, useState } from 'react';

/**
 * useState, dessen Wert im sessionStorage gespeichert wird.
 * Dadurch bleiben Filter (Monat, Kategorie, Sortierung, ...) erhalten,
 * wenn man zwischen den Seiten wechselt oder die Seite neu lädt.
 *
 * `ready` ist erst true, nachdem der gespeicherte Wert geladen wurde –
 * so kann man das erste Laden der Daten bis dahin zurückhalten
 * (verhindert doppeltes Laden mit dem Standardwert).
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T
): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [value, setValue] = useState<T>(initialValue);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw !== null) {
        setValue(JSON.parse(raw) as T);
      }
    } catch {
      // ignore corrupt / unavailable storage
    }
    setReady(true);
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota / unavailable storage
    }
  }, [key, value, ready]);

  return [value, setValue, ready];
}
