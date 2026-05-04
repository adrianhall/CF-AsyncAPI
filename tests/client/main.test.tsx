import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";

/** Build a JSON response. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/api/me"))
        return Promise.resolve(
          jsonResponse({ email: "test@example.com", id: "u1" }),
        );
      if (url.includes("/api/jobs"))
        return Promise.resolve(jsonResponse({ jobs: [] }));
      return Promise.resolve(
        jsonResponse({ name: "AsyncAPI", version: "0.0.1" }),
      );
    },
  );
});

describe("main entry point", () => {
  it("renders the app into the #root element", async () => {
    document.body.innerHTML = '<div id="root"></div>';

    // main.tsx is a side-effect module -- importing it boots the React app.
    // resetModules must come after the fetch mock is in place so the spy
    // on globalThis.fetch survives, but the module cache is fresh.
    vi.resetModules();
    await import("../../src/client/main");

    // createRoot().render() is async -- wait for React to flush.
    await waitFor(() => {
      expect(document.querySelector("#root h1")).toHaveTextContent("AsyncAPI");
    });
  });

  it("throws when #root element is missing", async () => {
    document.body.innerHTML = "";

    vi.resetModules();
    await expect(import("../../src/client/main")).rejects.toThrow(
      "Root element #root not found"
    );
  });
});
