import { useCallback, useEffect, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload(): void;
  setData(value: T): void;
}

/** Kör en asynkron funktion när beroendena ändras. Enkel ersättare för ett datahämtningsbibliotek. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Datahämtning är just en synk mot ett externt system; beroendena skickas in av anroparen.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true;
    // oxlint-disable-next-line react/set-state-in-effect
    setLoading(true);
    setError(null);
    fn().then(
      (d) => {
        if (!active) return;
        setData(d);
        setLoading(false);
      },
      (e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
