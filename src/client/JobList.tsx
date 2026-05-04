/**
 * Renders the current user's job list with status badges.
 *
 * Handles three guard states (loading, error, empty) before falling
 * through to the card list.
 *
 * @module
 */

import { type PublicJob } from "@lib/jobs";

interface JobListProps {
  jobs: PublicJob[];
  loading: boolean;
  error: string | null;
}

/** Map a {@link PublicJob.state} value to a CSS-friendly class suffix. */
function badgeClass(state: string): string {
  return state.replace(/_/g, "-");
}

/** Human-readable label for a job state. */
function stateLabel(state: string): string {
  switch (state) {
    case "in_progress":
      return "In Progress";
    case "pending":
      return "Pending";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return state;
  }
}

function JobList({ jobs, loading, error }: JobListProps) {
  if (loading && jobs.length === 0) {
    return <p className="loading">Loading jobs...</p>;
  }

  if (error) {
    return <p className="error">Jobs error: {error}</p>;
  }

  if (jobs.length === 0) {
    return <p className="empty">No jobs yet. Upload a PNG to get started.</p>;
  }

  return (
    <ul className="job-list">
      {jobs.map((job) => (
        <li key={job.id} className="job-card">
          <span className="job-name">{job.originalName}</span>
          <span className={`badge badge--${badgeClass(job.state)}`}>{stateLabel(job.state)}</span>
          <span className="job-time">{job.createdAt}</span>
          {job.state === "failed" && job.error && <span className="job-error">{job.error}</span>}
        </li>
      ))}
    </ul>
  );
}

export default JobList;
