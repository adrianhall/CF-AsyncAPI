/**
 * API route definitions.
 *
 * Exports a Hono sub-router that is mounted at `/api` by the Worker
 * entry point.
 *
 * @module
 */

import { Hono } from "hono";
import type { AuthVariables } from "@lib/cloudflare-auth";
import { createLogger } from "@lib/cloudflare-logging";
import { createJob, getJob, getJobsByUser, toPublicJob } from "@lib/jobs";

const log = createLogger("api.upload");

/** PNG magic header: the first 8 bytes of every valid PNG file. */
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Maximum allowed upload size (10 MB). */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Sub-router mounted at `/api`. */
const api = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

/**
 * GET /api/version
 *
 * Returns basic application metadata.
 */
api.get("/version", (c) => {
  return c.json({ name: "AsyncAPI", version: "0.0.1" });
});

/**
 * GET /api/me
 *
 * Returns the authenticated user's email and unique identifier.
 */
api.get("/me", (c) => {
  return c.json({ email: c.get("userEmail"), id: c.get("userSub") });
});

/**
 * GET /api/jobs
 *
 * Returns all jobs belonging to the authenticated user, newest first.
 * The response uses the public shape (no internal R2 keys).
 */
api.get("/jobs", async (c) => {
  const jobs = await getJobsByUser(c.env.DB, c.get("userEmail"));
  return c.json({ jobs: jobs.map(toPublicJob) });
});

/**
 * GET /api/jobs/:jobId
 *
 * Returns a single job by ID. Returns 404 if the job does not exist
 * or belongs to another user (leak-safe: no 403).
 */
api.get("/jobs/:jobId", async (c) => {
  const job = await getJob(c.env.DB, c.req.param("jobId"));

  if (!job || job.userEmail !== c.get("userEmail")) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json({ job: toPublicJob(job) });
});

/**
 * POST /api/upload
 *
 * Accepts a multipart form with a `file` field containing a PNG image.
 * Stores the file in R2, creates a `pending` job row in D1, and
 * enqueues a processing message. Returns `{ jobId }` with status 201.
 */
api.post("/upload", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body.file;

    // --- Validation ---

    if (!(file instanceof File)) {
      return c.json({ error: "Missing or invalid file field" }, 400);
    }

    if (file.size <= 0) {
      return c.json({ error: "File is empty" }, 400);
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "File exceeds 10 MB limit" }, 400);
    }

    if (file.type !== "image/png") {
      return c.json({ error: "File must be a PNG image" }, 400);
    }

    const fileBytes = new Uint8Array(await file.arrayBuffer());

    if (fileBytes.length < PNG_MAGIC.length) {
      return c.json({ error: "File is not a valid PNG" }, 400);
    }

    const header = fileBytes.slice(0, PNG_MAGIC.length);
    if (!header.every((byte, i) => byte === PNG_MAGIC[i])) {
      return c.json({ error: "File is not a valid PNG" }, 400);
    }

    // --- Store & enqueue ---

    const id = crypto.randomUUID();
    const originalKey = `incoming/${id}.png`;
    const userEmail = c.get("userEmail");
    const userId = c.get("userSub");

    await c.env.IMAGES_BUCKET.put(originalKey, fileBytes, {
      httpMetadata: { contentType: "image/png" }
    });

    await createJob(c.env.DB, {
      id,
      userEmail,
      userId,
      originalKey,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size
    });

    await c.env.JOB_QUEUE.send({ jobId: id });

    return c.json({ jobId: id }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    log.error("Upload failed", { error: message });
    return c.json({ error: "Internal server error" }, 500);
  }
});

export { api };
