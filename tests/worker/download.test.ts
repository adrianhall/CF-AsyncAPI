import { describe, it, expect, beforeAll } from "vitest";
import { SELF, env } from "cloudflare:test";
import { encode } from "fast-png";
import { signDevJwt, JWT_HEADER } from "@lib/cloudflare-auth";
import migrationSql from "../../migrations/0001_create_jobs.sql?raw";

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

/**
 * Insert a job row directly into D1.
 *
 * Accepts optional `processedKey` and `state` so we can seed completed
 * jobs for download tests.
 */
async function insertJob(overrides: {
  id: string;
  userEmail?: string;
  state?: string;
  processedKey?: string | null;
  originalName?: string;
}) {
  const id = overrides.id;
  const userEmail = overrides.userEmail ?? "user@example.com";
  const state = overrides.state ?? "pending";
  const processedKey = overrides.processedKey ?? null;
  const originalName = overrides.originalName ?? `${id}.png`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO jobs
       (id, user_email, user_id, state, original_key, processed_key,
        original_name, content_type, size_bytes, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  )
    .bind(
      id,
      userEmail,
      `dev-${userEmail}`,
      state,
      `incoming/${id}.png`,
      processedKey,
      originalName,
      "image/png",
      1024,
      now,
      now,
    )
    .run();
}

describe("GET /api/jobs/:jobId/download", () => {
  it("returns the processed image for a completed job owned by the user", async () => {
    const id = crypto.randomUUID();
    const processedKey = `processed/${id}.png`;
    const pngBytes = makeTestPng();

    await insertJob({ id, state: "completed", processedKey });
    await env.IMAGES_BUCKET.put(processedKey, pngBytes, {
      httpMetadata: { contentType: "image/png" },
    });

    const res = await authedRequest(`/api/jobs/${id}/download`);

    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(pngBytes);
  });

  it("returns correct Content-Type and Content-Disposition headers", async () => {
    const id = crypto.randomUUID();
    const processedKey = `processed/${id}.png`;
    const pngBytes = makeTestPng();

    await insertJob({
      id,
      state: "completed",
      processedKey,
      originalName: "sunset.png",
    });
    await env.IMAGES_BUCKET.put(processedKey, pngBytes, {
      httpMetadata: { contentType: "image/png" },
    });

    const res = await authedRequest(`/api/jobs/${id}/download`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="sunset-grayscale.png"',
    );
    expect(res.headers.get("Content-Length")).toBe(String(pngBytes.length));
  });

  it("returns 409 for a pending job", async () => {
    const id = crypto.randomUUID();
    await insertJob({ id, state: "pending" });

    const res = await authedRequest(`/api/jobs/${id}/download`);

    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("not completed");
  });

  it("returns 409 for an in_progress job", async () => {
    const id = crypto.randomUUID();
    await insertJob({ id, state: "in_progress" });

    const res = await authedRequest(`/api/jobs/${id}/download`);

    expect(res.status).toBe(409);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("not completed");
  });

  it("returns 404 for a non-existent job", async () => {
    const res = await authedRequest("/api/jobs/nonexistent-id/download");

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("returns 404 for a job belonging to another user", async () => {
    const id = crypto.randomUUID();
    const processedKey = `processed/${id}.png`;
    const pngBytes = makeTestPng();

    await insertJob({
      id,
      state: "completed",
      processedKey,
      userEmail: "other@example.com",
    });
    await env.IMAGES_BUCKET.put(processedKey, pngBytes, {
      httpMetadata: { contentType: "image/png" },
    });

    const res = await authedRequest(`/api/jobs/${id}/download`);

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("returns 404 when R2 object is missing despite completed state", async () => {
    const id = crypto.randomUUID();
    const processedKey = `processed/${id}.png`;

    // Insert a completed job but do NOT put anything in R2
    await insertJob({ id, state: "completed", processedKey });

    const res = await authedRequest(`/api/jobs/${id}/download`);

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("missing");
  });

  it("requires authentication", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/jobs/some-id/download",
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/_auth/login");
  });
});
