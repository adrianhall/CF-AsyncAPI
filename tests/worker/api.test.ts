import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";
import { signDevJwt, JWT_HEADER } from "@lib/cloudflare-auth";

describe("API routes", () => {
  it("GET /api/version returns name and version", async () => {
    const token = await signDevJwt("test@example.com");
    const response = await SELF.fetch("https://example.com/api/version", {
      headers: { [JWT_HEADER]: token }
    });
    expect(response.status).toBe(200);

    const data = (await response.json()) as { name: string; version: string };
    expect(data).toEqual({ name: "AsyncAPI", version: "0.0.1" });
  });

  it("unauthenticated requests are redirected to login", async () => {
    const response = await SELF.fetch("https://example.com/api/me", { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/_auth/login");
  });

  it("GET /api/me returns user email and id when authenticated", async () => {
    const token = await signDevJwt("test@example.com");
    const response = await SELF.fetch("https://example.com/api/me", {
      headers: { [JWT_HEADER]: token }
    });
    expect(response.status).toBe(200);

    const data = (await response.json()) as { email: string; id: string };
    expect(data.email).toBe("test@example.com");
    expect(data.id).toBe("dev-test@example.com");
  });
});
