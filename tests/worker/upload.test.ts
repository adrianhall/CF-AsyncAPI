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

/**
 * Convert a Uint8Array to a standalone ArrayBuffer (handles Node Buffer
 * pool offsets and satisfies the workers-types BlobPart constraint).
 */
function toBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(
    arr.byteOffset,
    arr.byteOffset + arr.byteLength,
  ) as ArrayBuffer;
}

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

/** Build a multipart FormData containing the given file. */
function uploadForm(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

describe("POST /api/upload", () => {
  it("returns 201 with jobId for a valid PNG", async () => {
    const pngBytes = makeTestPng();
    const file = new File([toBuffer(pngBytes)], "test.png", { type: "image/png" });

    const res = await authedRequest("/api/upload", {
      method: "POST",
      body: uploadForm(file),
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as { jobId: string };
    expect(data.jobId).toBeTruthy();
    expect(typeof data.jobId).toBe("string");
  });

  it("stores the file in R2 at incoming/{jobId}.png", async () => {
    const pngBytes = makeTestPng();
    const file = new File([toBuffer(pngBytes)], "test.png", { type: "image/png" });

    const res = await authedRequest("/api/upload", {
      method: "POST",
      body: uploadForm(file),
    });
    const { jobId } = (await res.json()) as { jobId: string };

    const r2Object = await env.IMAGES_BUCKET.get(`incoming/${jobId}.png`);
    expect(r2Object).not.toBeNull();

    const storedBytes = new Uint8Array(await r2Object!.arrayBuffer());
    expect(storedBytes).toEqual(pngBytes);
  });

  it("creates a pending D1 row with matching userEmail", async () => {
    const pngBytes = makeTestPng();
    const file = new File([toBuffer(pngBytes)], "photo.png", { type: "image/png" });

    const res = await authedRequest("/api/upload", {
      method: "POST",
      body: uploadForm(file),
    });
    const { jobId } = (await res.json()) as { jobId: string };

    const row = await env.DB.prepare("SELECT * FROM jobs WHERE id = ?")
      .bind(jobId)
      .first();

    expect(row).not.toBeNull();
    expect(row!.state).toBe("pending");
    expect(row!.user_email).toBe("user@example.com");
    expect(row!.original_name).toBe("photo.png");
    expect(row!.content_type).toBe("image/png");
    expect(row!.original_key).toBe(`incoming/${jobId}.png`);
  });

  it("returns 400 when no file is attached", async () => {
    const res = await authedRequest("/api/upload", {
      method: "POST",
      body: new FormData(),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBeTruthy();
  });

  it("returns 400 when the file is not a PNG", async () => {
    // A JPEG-typed file (content doesn't matter — MIME check comes first)
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const file = new File([toBuffer(jpegBytes)], "photo.jpg", {
      type: "image/jpeg",
    });

    const res = await authedRequest("/api/upload", {
      method: "POST",
      body: uploadForm(file),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("PNG");
  });

  it("returns 400 when the file exceeds 10 MB", async () => {
    const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
    // Set PNG magic bytes so it passes type checks up to the size check
    const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    magic.forEach((b, i) => (oversized[i] = b));

    const file = new File([toBuffer(oversized)], "huge.png", { type: "image/png" });

    const res = await authedRequest("/api/upload", {
      method: "POST",
      body: uploadForm(file),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("10 MB");
  });

  it("returns 400 when the file has PNG MIME but invalid magic bytes", async () => {
    // Claim image/png but the content is garbage
    const fakeBytes = new Uint8Array([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
    ]);
    const file = new File([toBuffer(fakeBytes)], "fake.png", { type: "image/png" });

    const res = await authedRequest("/api/upload", {
      method: "POST",
      body: uploadForm(file),
    });

    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("valid PNG");
  });

  it("redirects to login when unauthenticated", async () => {
    const pngBytes = makeTestPng();
    const file = new File([toBuffer(pngBytes)], "test.png", { type: "image/png" });

    const res = await SELF.fetch("https://example.com/api/upload", {
      method: "POST",
      body: uploadForm(file),
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/_auth/login");
  });
});
