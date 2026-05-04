import { type Job, type PublicJob, type JobState, type CreateJobInput } from "./types";

/** Maps a snake_case D1 row to a camelCase `Job` object. */
function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    userEmail: row.user_email as string,
    userId: row.user_id as string,
    state: row.state as JobState,
    originalKey: row.original_key as string,
    processedKey: (row.processed_key as string) ?? null,
    originalName: row.original_name as string,
    contentType: row.content_type as string,
    sizeBytes: row.size_bytes as number,
    error: (row.error as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}

/**
 * Inserts a new job row with `state = 'pending'` and returns the
 * full `Job` object as stored in D1.
 */
export async function createJob(db: D1Database, input: CreateJobInput): Promise<Job> {
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO jobs
         (id, user_email, user_id, state, original_key, processed_key,
          original_name, content_type, size_bytes, error, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, NULL, ?, ?, ?, NULL, ?, ?)`
    )
    .bind(
      input.id,
      input.userEmail,
      input.userId,
      input.originalKey,
      input.originalName,
      input.contentType,
      input.sizeBytes,
      now,
      now
    )
    .run();

  const job = await getJob(db, input.id);
  if (!job) {
    throw new Error(`Failed to read back job ${input.id} after insert`);
  }
  return job;
}

/** Returns a single job by primary key, or `null` if not found. */
export async function getJob(db: D1Database, id: string): Promise<Job | null> {
  const row = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();

  return row ? rowToJob(row) : null;
}

/**
 * Returns all jobs belonging to `userEmail`, ordered by
 * `created_at DESC` (newest first).
 */
export async function getJobsByUser(db: D1Database, userEmail: string): Promise<Job[]> {
  const { results } = await db
    .prepare("SELECT * FROM jobs WHERE user_email = ? ORDER BY created_at DESC")
    .bind(userEmail)
    .all();

  return results.map((r) => rowToJob(r as Record<string, unknown>));
}

/**
 * Transitions a job to a new state and bumps `updated_at`.
 *
 * Optional fields (`processedKey`, `error`) are written when provided.
 */
export async function updateJobState(
  db: D1Database,
  id: string,
  state: JobState,
  opts?: { processedKey?: string; error?: string }
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare(
      `UPDATE jobs
          SET state = ?,
              processed_key = COALESCE(?, processed_key),
              error = COALESCE(?, error),
              updated_at = ?
        WHERE id = ?`
    )
    .bind(state, opts?.processedKey ?? null, opts?.error ?? null, now, id)
    .run();
}

/** Strips internal fields from a `Job`, returning only the public shape. */
export function toPublicJob(job: Job): PublicJob {
  return {
    id: job.id,
    state: job.state,
    originalName: job.originalName,
    contentType: job.contentType,
    sizeBytes: job.sizeBytes,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
