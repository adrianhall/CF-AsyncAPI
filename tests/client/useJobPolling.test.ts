import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useJobPolling } from "../../src/client/useJobPolling";
import { type PublicJob } from "../../src/lib/jobs/types";

/** Build a JSON response wrapping an array of jobs. */
function jobsResponse(jobs: PublicJob[]): Response {
  return new Response(JSON.stringify({ jobs }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Factory for a minimal PublicJob with sensible defaults. */
function makeJob(overrides: Partial<PublicJob> = {}): PublicJob {
  return {
    id: overrides.id ?? "job-1",
    state: overrides.state ?? "completed",
    originalName: overrides.originalName ?? "photo.png",
    contentType: "image/png",
    sizeBytes: 1024,
    error: overrides.error ?? null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("useJobPolling", () => {
  // --- Tests that use real timers (async state via waitFor) ---

  describe("basic fetch behaviour", () => {
    it("fetches /api/jobs once on mount", async () => {
      const completedJob = makeJob({ state: "completed" });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(jobsResponse([completedJob]));

      const { result } = renderHook(() => useJobPolling());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith("/api/jobs", {
        signal: expect.any(AbortSignal) as AbortSignal,
      });
      expect(result.current.jobs).toEqual([completedJob]);
      expect(result.current.error).toBeNull();
    });

    it("refresh() triggers an immediate fetch", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(jobsResponse([]));

      const { result } = renderHook(() => useJobPolling());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Now return a job on the next call.
      const newJob = makeJob({ id: "new-1", state: "completed" });
      fetchSpy.mockResolvedValue(jobsResponse([newJob]));

      act(() => {
        result.current.refresh();
      });

      await waitFor(() => {
        expect(result.current.jobs).toEqual([newJob]);
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("sets error on fetch failure and retains previous jobs", async () => {
      const existingJob = makeJob({ state: "completed" });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(jobsResponse([existingJob]));

      const { result } = renderHook(() => useJobPolling());

      await waitFor(() => {
        expect(result.current.jobs).toEqual([existingJob]);
      });

      // Next fetch fails.
      fetchSpy.mockRejectedValueOnce(new Error("Network down"));

      act(() => {
        result.current.refresh();
      });

      await waitFor(() => {
        expect(result.current.error).toBe("Network down");
      });

      // Previous jobs are still present.
      expect(result.current.jobs).toEqual([existingJob]);
    });

    it("unmounting aborts the in-flight request", async () => {
      // Create a fetch that never resolves so we can test abort.
      let capturedSignal: AbortSignal | undefined;
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input: string | URL | Request, init?: RequestInit) => {
          capturedSignal = init?.signal as AbortSignal | undefined;
          return new Promise<Response>(() => {
            /* never resolves */
          });
        },
      );

      const { unmount } = renderHook(() => useJobPolling());

      // Let React process the effect.
      await act(async () => {});

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(false);

      unmount();

      expect(capturedSignal!.aborted).toBe(true);
    });
  });

  // --- Tests that use fake timers (interval behaviour) ---

  describe("adaptive polling", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("does not re-fetch when all jobs are terminal", async () => {
      const jobs = [
        makeJob({ id: "j1", state: "completed" }),
        makeJob({ id: "j2", state: "failed", error: "boom" }),
      ];
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(jobsResponse(jobs));

      const { result } = renderHook(() => useJobPolling(3000));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Advance well beyond the polling interval.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      // No additional fetches — polling is idle.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("re-fetches every intervalMs when an active job is present", async () => {
      const pendingJob = makeJob({ state: "pending" });
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(jobsResponse([pendingJob]));

      const { result } = renderHook(() => useJobPolling(3000));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Advance by one interval — should trigger a second fetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      await waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      });

      // Advance by another interval — third fetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      await waitFor(() => {
        expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
