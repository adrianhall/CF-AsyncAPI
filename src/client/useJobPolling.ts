/**
 * Custom hook that polls `GET /api/jobs` for the current user's jobs.
 *
 * Polling is adaptive: it runs every {@link intervalMs} milliseconds
 * while at least one job is `pending` or `in_progress`, and stops when
 * all jobs have reached a terminal state (`completed` or `failed`).
 *
 * @module
 */

import { useCallback, useEffect, useState } from "react";
import { type PublicJob } from "@lib/jobs";

export interface UseJobPollingResult {
  jobs: PublicJob[];
  loading: boolean;
  error: string | null;
  /** Trigger an immediate fetch (e.g. after uploading a new file). */
  refresh: () => void;
}

/** Returns `true` when at least one job is not yet terminal. */
function hasActiveJobs(jobs: PublicJob[]): boolean {
  return jobs.some((j) => j.state === "pending" || j.state === "in_progress");
}

export function useJobPolling(intervalMs = 3000): UseJobPollingResult {
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Incrementing this counter triggers the fetch effect.  Both the
   * initial mount (trigger = 0) and explicit refresh / interval ticks
   * bump the counter, keeping the effect as the sole fetch owner.
   */
  const [trigger, setTrigger] = useState(0);

  /** Bump the trigger to schedule a re-fetch. */
  const refresh = useCallback(() => {
    setTrigger((c) => c + 1);
  }, []);

  // Fetch jobs whenever `trigger` changes (including the initial mount).
  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/jobs", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.status}`);
        return res.json() as Promise<{ jobs: PublicJob[] }>;
      })
      .then((data) => {
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [trigger]);

  // Adaptive polling: schedule ticks only while active jobs exist.
  useEffect(() => {
    if (!hasActiveJobs(jobs)) return;

    const id = setInterval(() => {
      setTrigger((c) => c + 1);
    }, intervalMs);

    return () => clearInterval(id);
  }, [jobs, intervalMs]);

  return { jobs, loading, error, refresh };
}
