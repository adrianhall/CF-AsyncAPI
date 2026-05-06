import { describe, it, expect, beforeAll } from "vitest";
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { signDevJwt, JWT_HEADER } from "@lib/cloudflare-auth";
import type { SessionEntry } from "../../src/worker/session-tracker";
import worker from "../../src/worker/index";
import migrationSql from "../../migrations/0001_create_jobs.sql?raw";

beforeAll(async () => {
  for (const stmt of migrationSql.split(/;\s*$/m).filter((s) => s.trim())) {
    await env.DB.exec(stmt.replace(/\n/g, " "));
  }
});

/** Call the worker fetch handler directly and await all waitUntil work. */
async function workerFetch(
  path: string,
  email: string,
): Promise<Response> {
  const token = await signDevJwt(email);
  const request = new Request(`https://example.com${path}`, {
    headers: { [JWT_HEADER]: token },
  });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("session tracker middleware", () => {
  it("writes a session entry to KV on an API call", async () => {
    const email = "tracker@example.com";
    const userSub = `dev-${email}`;

    await workerFetch("/api/version", email);

    const raw = await env.SESSIONS.get(userSub);
    expect(raw).not.toBeNull();

    const entry = JSON.parse(raw!) as SessionEntry;
    expect(entry.email).toBe(email);
    expect(entry.action).toBe("/api/version");
    expect(entry.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("overwrites the previous entry on subsequent calls", async () => {
    const email = "overwrite@example.com";
    const userSub = `dev-${email}`;

    await workerFetch("/api/version", email);
    const first = JSON.parse(
      (await env.SESSIONS.get(userSub))!,
    ) as SessionEntry;
    expect(first.action).toBe("/api/version");

    await workerFetch("/api/me", email);
    const second = JSON.parse(
      (await env.SESSIONS.get(userSub))!,
    ) as SessionEntry;
    expect(second.action).toBe("/api/me");
    expect(second.timestamp >= first.timestamp).toBe(true);
  });

  it("records the full request path including parameters", async () => {
    const email = "pathcheck@example.com";
    const userSub = `dev-${email}`;

    await workerFetch("/api/jobs/nonexistent-id-123", email);

    const entry = JSON.parse(
      (await env.SESSIONS.get(userSub))!,
    ) as SessionEntry;
    expect(entry.action).toBe("/api/jobs/nonexistent-id-123");
  });

  it("records even when the API returns an error status", async () => {
    const email = "errorcase@example.com";
    const userSub = `dev-${email}`;

    // /api/jobs/:jobId returns 404 for unknown IDs
    const res = await workerFetch("/api/jobs/does-not-exist", email);
    expect(res.status).toBe(404);

    const raw = await env.SESSIONS.get(userSub);
    expect(raw).not.toBeNull();

    const entry = JSON.parse(raw!) as SessionEntry;
    expect(entry.email).toBe(email);
    expect(entry.action).toBe("/api/jobs/does-not-exist");
  });
});
