import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import { signDevJwt, JWT_HEADER } from "@lib/cloudflare-auth";
import migrationSql from "../../migrations/0001_create_jobs.sql?raw";

beforeAll(async () => {
  for (const stmt of migrationSql.split(/;\s*$/m).filter((s) => s.trim())) {
    await env.DB.exec(stmt.replace(/\n/g, " "));
  }
});

/** Send an authenticated request via SELF. */
async function authedRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await signDevJwt("user@example.com");
  const headers = new Headers(init?.headers);
  headers.set(JWT_HEADER, token);
  return SELF.fetch(`https://example.com${path}`, { ...init, headers });
}

/** Insert a job row directly into D1, bypassing the upload route. */
async function insertJob(overrides: {
  id: string;
  userEmail?: string;
  state?: string;
  createdAt?: string;
}) {
  const id = overrides.id;
  const userEmail = overrides.userEmail ?? "user@example.com";
  const state = overrides.state ?? "pending";
  const createdAt = overrides.createdAt ?? new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO jobs
       (id, user_email, user_id, state, original_key, processed_key,
        original_name, content_type, size_bytes, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      id,
      userEmail,
      `dev-${userEmail}`,
      state,
      `incoming/${id}.png`,
      `${id}.png`,
      "image/png",
      1024,
      createdAt,
      createdAt,
    )
    .run();
}

describe("GET /api/jobs", () => {
  it("returns user's jobs in DESC createdAt order", async () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();

    await insertJob({ id: id1, createdAt: "2025-01-01T00:00:00.000Z" });
    await insertJob({ id: id2, createdAt: "2025-01-02T00:00:00.000Z" });

    const res = await authedRequest("/api/jobs");

    expect(res.status).toBe(200);
    const data = (await res.json()) as { jobs: { id: string }[] };
    const ids = data.jobs.map((j) => j.id);
    // Newest first
    expect(ids.indexOf(id2)).toBeLessThan(ids.indexOf(id1));
  });

  it("returns { jobs: [] } when user has no jobs", async () => {
    // Use a fresh user with no rows
    const token = await signDevJwt("empty@example.com");
    const headers = new Headers();
    headers.set(JWT_HEADER, token);

    const res = await SELF.fetch("https://example.com/api/jobs", { headers });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { jobs: unknown[] };
    expect(data.jobs).toEqual([]);
  });

  it("does NOT return another user's jobs", async () => {
    const otherId = crypto.randomUUID();
    await insertJob({ id: otherId, userEmail: "secret@example.com" });

    const res = await authedRequest("/api/jobs");

    expect(res.status).toBe(200);
    const data = (await res.json()) as { jobs: { id: string }[] };
    const ids = data.jobs.map((j) => j.id);
    expect(ids).not.toContain(otherId);
  });

  it("does not include originalKey or processedKey in the response", async () => {
    const id = crypto.randomUUID();
    await insertJob({ id });

    const res = await authedRequest("/api/jobs");

    expect(res.status).toBe(200);
    const data = (await res.json()) as { jobs: Record<string, unknown>[] };
    const job = data.jobs.find((j) => j.id === id);
    expect(job).toBeDefined();
    expect(job).not.toHaveProperty("originalKey");
    expect(job).not.toHaveProperty("processedKey");
    expect(job).not.toHaveProperty("userEmail");
    expect(job).not.toHaveProperty("userId");
  });

  it("requires authentication", async () => {
    const res = await SELF.fetch("https://example.com/api/jobs", {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/_auth/login");
  });
});

describe("GET /api/jobs/:jobId", () => {
  it("returns the job for the owner", async () => {
    const id = crypto.randomUUID();
    await insertJob({ id, state: "completed" });

    const res = await authedRequest(`/api/jobs/${id}`);

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      job: { id: string; state: string; originalName: string };
    };
    expect(data.job.id).toBe(id);
    expect(data.job.state).toBe("completed");
    expect(data.job.originalName).toBe(`${id}.png`);
  });

  it("returns 404 for unknown id", async () => {
    const res = await authedRequest("/api/jobs/nonexistent-id");

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("returns 404 when the job belongs to another user (no leak)", async () => {
    const id = crypto.randomUUID();
    await insertJob({ id, userEmail: "victim@example.com" });

    // Request as user@example.com — should get 404, not 403
    const res = await authedRequest(`/api/jobs/${id}`);

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("does not include originalKey or processedKey in the response", async () => {
    const id = crypto.randomUUID();
    await insertJob({ id });

    const res = await authedRequest(`/api/jobs/${id}`);

    expect(res.status).toBe(200);
    const data = (await res.json()) as { job: Record<string, unknown> };
    expect(data.job).not.toHaveProperty("originalKey");
    expect(data.job).not.toHaveProperty("processedKey");
    expect(data.job).not.toHaveProperty("userEmail");
    expect(data.job).not.toHaveProperty("userId");
  });

  it("requires authentication", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/jobs/some-id",
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/_auth/login");
  });
});
