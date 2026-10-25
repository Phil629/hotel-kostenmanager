'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

const SYNC_EVENT = 'persistent-state-sync';

/**
 * useState, dessen Wert im sessionStorage gespeichert wird und über ein CustomEvent
 * in Echtzeit zwischen allen gleichzeitig gemounteten Komponenten (z. B. HeaderNav,
 * Dashboard, Umsätze) synchronisiert wird.
 */
export function usePersistentState<T>(
  key: string,
  initialValue: T
): [T, React.Dispatch<React.SetStateAction<T>>, boolean] {
  const [value, setValueState] = useState<T>(initialValue);
  const [ready, setReady] = useState(false);
  const valueRef = useRef<T>(value);
  valueRef.current = value;

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        setValueState(parsed);
        valueRef.current = parsed;
      }
    } catch {
      // ignore corrupt / unavailable storage
    }
    setReady(true);
  }, [key]);

  useEffect(() => {
    const handleSync = (e: Event) => {
      const custom = e as CustomEvent<{ key: string; value: T }>;
      if (custom.detail && custom.detail.key === key) {
        setValueState(custom.detail.value);
        valueRef.current = custom.detail.value;
      }
    };
    window.addEventListener(SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  }, [key]);

  const setValue: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (updater) => {
      const nextValue =
        typeof updater === 'function'
          ? (updater as (prev: T) => T)(valueRef.current)
          : updater;

      valueRef.current = nextValue;
      setValueState(nextValue);

      try {
        window.sessionStorage.setItem(key, JSON.stringify(nextValue));
        window.dispatchEvent(
          new CustomEvent(SYNC_EVENT, { detail: { key, value: nextValue } })
        );
      } catch {
        // ignore quota / unavailable storage
      }
    },
    [key]
  );

  return [value, setValue, ready];
}
