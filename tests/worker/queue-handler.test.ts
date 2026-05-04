import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { decode, encode } from "fast-png";
import { createJob, getJob } from "@lib/jobs";
import migrationSql from "../../migrations/0001_create_jobs.sql?raw";

// ---------------------------------------------------------------------------
// Silence the module-level logger in queue-handler.ts.
//
// The cloudflare-auth tests use the same pattern — a silentLogger object
// with vi.fn() stubs — but inject it via constructor options.  Here the
// logger is created at module scope via createLogger(), so we intercept
// the factory instead.
// ---------------------------------------------------------------------------
vi.mock("@lib/cloudflare-logging", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { type JobMessage } from "../../src/worker/queue-handler";

// Import the runtime value *after* the mock is registered so the
// module-level createLogger() call inside queue-handler.ts picks it up.
const { handleQueue } = await import("../../src/worker/queue-handler");

beforeAll(async () => {
  for (const stmt of migrationSql.split(/;\s*$/m).filter((s) => s.trim())) {
    await env.DB.exec(stmt.replace(/\n/g, " "));
  }
});

/** Build a minimal 1x1 red PNG as a Uint8Array. */
function makeTestPng(): Uint8Array {
  const data = new Uint8Array([255, 0, 0, 255]); // RGBA red pixel
  return encode({ width: 1, height: 1, data, channels: 4, depth: 8 });
}

/**
 * Convert a Uint8Array to a standalone ArrayBuffer (handles Node Buffer
 * pool offsets).
 */
function toBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(
    arr.byteOffset,
    arr.byteOffset + arr.byteLength,
  ) as ArrayBuffer;
}

/** Build a fake MessageBatch with a single message. */
function makeBatch(jobId: string) {
  const message = {
    id: "msg-1",
    timestamp: new Date(),
    body: { jobId } as JobMessage,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
  const batch = {
    queue: "async-api-jobs",
    messages: [message],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  };
  return { batch, message };
}

/** Insert a pending job and upload its PNG to R2. */
async function seedJob(jobId: string): Promise<void> {
  const pngBytes = makeTestPng();
  const originalKey = `incoming/${jobId}.png`;

  await env.IMAGES_BUCKET.put(originalKey, toBuffer(pngBytes), {
    httpMetadata: { contentType: "image/png" },
  });

  await createJob(env.DB, {
    id: jobId,
    userEmail: "user@example.com",
    userId: "user-sub-123",
    originalKey,
    originalName: "test.png",
    contentType: "image/png",
    sizeBytes: pngBytes.length,
  });
}

// Mock scheduler.wait so tests don't actually wait 20 seconds.
beforeEach(() => {
  vi.stubGlobal(
    "scheduler",
    Object.assign(globalThis.scheduler ?? {}, {
      wait: vi.fn().mockResolvedValue(undefined),
    }),
  );
});

describe("handleQueue", () => {
  it("processes a valid job end-to-end: pending → in_progress → completed", async () => {
    const jobId = crypto.randomUUID();
    await seedJob(jobId);
    const { batch, message } = makeBatch(jobId);

    await handleQueue(
      batch as unknown as MessageBatch<JobMessage>,
      env as unknown as Env,
    );

    // Message should be acknowledged
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();

    // Job should be completed
    const job = await getJob(env.DB, jobId);
    expect(job).not.toBeNull();
    expect(job!.state).toBe("completed");
    expect(job!.processedKey).toBe(`processed/${jobId}.png`);
    expect(job!.error).toBeNull();

    // Processed image should exist in R2
    const processed = await env.IMAGES_BUCKET.get(`processed/${jobId}.png`);
    expect(processed).not.toBeNull();

    // Verify the output is a valid grayscale PNG
    const outputBytes = new Uint8Array(await processed!.arrayBuffer());
    const png = decode(outputBytes);
    // The red pixel should have been converted to grayscale (luma ~76)
    expect(png.data[0]).toBe(76); // R
    expect(png.data[1]).toBe(76); // G
    expect(png.data[2]).toBe(76); // B
    expect(png.data[3]).toBe(255); // A preserved
  });

  it("calls scheduler.wait twice for the deliberate delays", async () => {
    const jobId = crypto.randomUUID();
    await seedJob(jobId);
    const { batch } = makeBatch(jobId);

    await handleQueue(
      batch as unknown as MessageBatch<JobMessage>,
      env as unknown as Env,
    );

    expect(scheduler.wait).toHaveBeenCalledTimes(2);
    expect(scheduler.wait).toHaveBeenCalledWith(10_000);
  });

  it("fails and retries when R2 object is missing", async () => {
    const jobId = crypto.randomUUID();
    const originalKey = `incoming/${jobId}.png`;

    // Create the job row but do NOT upload the PNG to R2
    await createJob(env.DB, {
      id: jobId,
      userEmail: "user@example.com",
      userId: "user-sub-123",
      originalKey,
      originalName: "missing.png",
      contentType: "image/png",
      sizeBytes: 100,
    });

    const { batch, message } = makeBatch(jobId);

    await handleQueue(
      batch as unknown as MessageBatch<JobMessage>,
      env as unknown as Env,
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();

    // Job should be marked as failed with an error
    const job = await getJob(env.DB, jobId);
    expect(job!.state).toBe("failed");
    expect(job!.error).toContain("Original object missing");
  });

  it("fails and retries when job row does not exist", async () => {
    const jobId = crypto.randomUUID();
    // No job row, no R2 object — just a queue message
    const { batch, message } = makeBatch(jobId);

    await handleQueue(
      batch as unknown as MessageBatch<JobMessage>,
      env as unknown as Env,
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("fails and retries when the PNG is corrupted", async () => {
    const jobId = crypto.randomUUID();
    const originalKey = `incoming/${jobId}.png`;

    // Upload garbage bytes that are not a valid PNG
    await env.IMAGES_BUCKET.put(
      originalKey,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00]),
    );

    await createJob(env.DB, {
      id: jobId,
      userEmail: "user@example.com",
      userId: "user-sub-123",
      originalKey,
      originalName: "corrupt.png",
      contentType: "image/png",
      sizeBytes: 7,
    });

    const { batch, message } = makeBatch(jobId);

    await handleQueue(
      batch as unknown as MessageBatch<JobMessage>,
      env as unknown as Env,
    );

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();

    const job = await getJob(env.DB, jobId);
    expect(job!.state).toBe("failed");
    expect(job!.error).toBeTruthy();
  });
});
