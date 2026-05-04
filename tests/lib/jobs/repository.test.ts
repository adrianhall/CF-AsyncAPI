import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import {
  createJob,
  getJob,
  getJobsByUser,
  updateJobState,
  type CreateJobInput,
} from "@lib/jobs";
import migrationSql from "../../../migrations/0001_create_jobs.sql?raw";

beforeAll(async () => {
  for (const stmt of migrationSql.split(/;\s*$/m).filter((s) => s.trim())) {
    await env.DB.exec(stmt.replace(/\n/g, " "));
  }
});

function makeInput(overrides?: Partial<CreateJobInput>): CreateJobInput {
  return {
    id: crypto.randomUUID(),
    userEmail: "alice@example.com",
    userId: "dev-alice@example.com",
    originalKey: `incoming/${crypto.randomUUID()}.png`,
    originalName: "photo.png",
    contentType: "image/png",
    sizeBytes: 1024,
    ...overrides,
  };
}

describe("createJob", () => {
  it("inserts and returns the full Job", async () => {
    const input = makeInput();
    const job = await createJob(env.DB, input);

    expect(job.id).toBe(input.id);
    expect(job.userEmail).toBe(input.userEmail);
    expect(job.userId).toBe(input.userId);
    expect(job.originalKey).toBe(input.originalKey);
    expect(job.originalName).toBe(input.originalName);
    expect(job.contentType).toBe(input.contentType);
    expect(job.sizeBytes).toBe(input.sizeBytes);
    expect(job.createdAt).toBeTruthy();
    expect(job.updatedAt).toBeTruthy();
  });

  it("defaults to state = 'pending' and processedKey = null", async () => {
    const input = makeInput();
    const job = await createJob(env.DB, input);

    expect(job.state).toBe("pending");
    expect(job.processedKey).toBeNull();
    expect(job.error).toBeNull();
  });
});

describe("getJob", () => {
  it("returns null for unknown id", async () => {
    const result = await getJob(env.DB, "nonexistent-id");
    expect(result).toBeNull();
  });
});

describe("getJobsByUser", () => {
  it("returns only that user's rows, newest first", async () => {
    const email = `user-${crypto.randomUUID()}@example.com`;

    const first = makeInput({ userEmail: email });
    const second = makeInput({ userEmail: email });
    const other = makeInput({ userEmail: "other@example.com" });

    await createJob(env.DB, first);
    // Small delay so created_at differs
    await new Promise((r) => setTimeout(r, 10));
    await createJob(env.DB, second);
    await createJob(env.DB, other);

    const jobs = await getJobsByUser(env.DB, email);

    expect(jobs).toHaveLength(2);
    // Newest first
    expect(jobs[0].id).toBe(second.id);
    expect(jobs[1].id).toBe(first.id);
  });

  it("returns empty array for unknown user", async () => {
    const jobs = await getJobsByUser(env.DB, "nobody@example.com");
    expect(jobs).toEqual([]);
  });
});

describe("updateJobState", () => {
  it("updates state and updatedAt", async () => {
    const input = makeInput();
    const original = await createJob(env.DB, input);

    await new Promise((r) => setTimeout(r, 10));
    await updateJobState(env.DB, input.id, "in_progress");

    const updated = await getJob(env.DB, input.id);
    expect(updated).not.toBeNull();
    expect(updated!.state).toBe("in_progress");
    expect(updated!.updatedAt).not.toBe(original.updatedAt);
  });

  it("writes processedKey and error when provided", async () => {
    const input = makeInput();
    await createJob(env.DB, input);

    await updateJobState(env.DB, input.id, "completed", {
      processedKey: "processed/test.png",
    });

    const completed = await getJob(env.DB, input.id);
    expect(completed!.state).toBe("completed");
    expect(completed!.processedKey).toBe("processed/test.png");

    // Now test error path with a fresh job
    const input2 = makeInput();
    await createJob(env.DB, input2);

    await updateJobState(env.DB, input2.id, "failed", {
      error: "Something broke",
    });

    const failed = await getJob(env.DB, input2.id);
    expect(failed!.state).toBe("failed");
    expect(failed!.error).toBe("Something broke");
  });
});
