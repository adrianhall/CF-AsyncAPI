import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import JobList from "../../src/client/JobList";
import { type PublicJob } from "../../src/lib/jobs/types";

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

describe("JobList", () => {
  it("shows loading state when loading with no jobs", () => {
    render(<JobList jobs={[]} loading={true} error={null} />);
    expect(screen.getByText("Loading jobs...")).toBeInTheDocument();
  });

  it("shows empty state when not loading and no jobs", () => {
    render(<JobList jobs={[]} loading={false} error={null} />);
    expect(
      screen.getByText("No jobs yet. Upload a PNG to get started."),
    ).toBeInTheDocument();
  });

  it("shows error message when error is set", () => {
    render(<JobList jobs={[]} loading={false} error="Something broke" />);
    expect(
      screen.getByText("Jobs error: Something broke"),
    ).toBeInTheDocument();
  });

  it("renders one card per job", () => {
    const jobs = [
      makeJob({ id: "j1", originalName: "a.png" }),
      makeJob({ id: "j2", originalName: "b.png" }),
      makeJob({ id: "j3", originalName: "c.png" }),
    ];
    render(<JobList jobs={jobs} loading={false} error={null} />);

    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
    expect(screen.getByText("c.png")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it.each([
    { state: "pending", cssClass: "badge--pending", label: "Pending" },
    {
      state: "in_progress",
      cssClass: "badge--in-progress",
      label: "In Progress",
    },
    { state: "completed", cssClass: "badge--completed", label: "Completed" },
    { state: "failed", cssClass: "badge--failed", label: "Failed" },
  ] as const)(
    "renders the correct badge class for $state",
    ({ state, cssClass, label }) => {
      const job = makeJob({ state, error: state === "failed" ? "err" : null });
      render(<JobList jobs={[job]} loading={false} error={null} />);

      const badge = screen.getByText(label);
      expect(badge).toBeInTheDocument();
      expect(badge.className).toContain("badge");
      expect(badge.className).toContain(cssClass);
    },
  );

  it("shows the error message for failed jobs", () => {
    const job = makeJob({
      state: "failed",
      error: "PNG header invalid",
    });
    render(<JobList jobs={[job]} loading={false} error={null} />);

    expect(screen.getByText("PNG header invalid")).toBeInTheDocument();
  });

  it("does not show an error span for non-failed jobs", () => {
    const job = makeJob({ state: "completed" });
    render(<JobList jobs={[job]} loading={false} error={null} />);

    // The job-error class should not be present.
    expect(
      screen.getByRole("listitem").querySelector(".job-error"),
    ).toBeNull();
  });

  it("shows jobs over loading state when jobs are already present", () => {
    const jobs = [makeJob({ originalName: "existing.png" })];
    render(<JobList jobs={jobs} loading={true} error={null} />);

    // Should render the job list, not the loading message.
    expect(screen.getByText("existing.png")).toBeInTheDocument();
    expect(screen.queryByText("Loading jobs...")).not.toBeInTheDocument();
  });
});
