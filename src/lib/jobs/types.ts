export type JobState = "pending" | "in_progress" | "completed" | "failed";

export interface Job {
  id: string;
  userEmail: string;
  userId: string;
  state: JobState;
  originalKey: string;
  processedKey: string | null;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobInput {
  id: string;
  userEmail: string;
  userId: string;
  originalKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Public-facing job shape returned by the API.
 *
 * Omits internal fields (`userEmail`, `userId`, `originalKey`,
 * `processedKey`) so R2 keys and ownership details are never leaked.
 */
export interface PublicJob {
  id: string;
  state: JobState;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
