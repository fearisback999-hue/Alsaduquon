"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseApiDataOptions {
  /** Auto-refresh interval in ms. 0 = disabled. */
  refreshInterval?: number;
  /** Pause auto-refresh when tab is hidden. Default true. */
  pauseWhenHidden?: boolean;
  /** Skip initial fetch until this is true. Default true. */
  enabled?: boolean;
}

interface UseApiDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useApiData<T>(
  url: string | null,
  options: UseApiDataOptions = {},
): UseApiDataResult<T> {
  const { refreshInterval = 0, pauseWhenHidden = true, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!url || !enabled) return;
    try {
      const res = await fetch(url);
      if (!mountedRef.current) return;
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Request failed (${res.status})`);
        setLoading(false);
        return;
      }
      const json = await res.json();
      if (!mountedRef.current) return;
      setData(json);
      setError(null);
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Network error");
      setLoading(false);
    }
  }, [url, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData, enabled]);

  useEffect(() => {
    if (!refreshInterval || !enabled) return;
    const interval = setInterval(() => {
      if (pauseWhenHidden && document.hidden) return;
      fetchData();
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, pauseWhenHidden, enabled, fetchData]);

  return { data, loading, error, refetch: fetchData };
}
