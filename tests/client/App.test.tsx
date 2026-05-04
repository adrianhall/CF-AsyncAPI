import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../src/client/App";

/** Build a successful JSON response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const VERSION_RESPONSE = { name: "AsyncAPI", version: "0.0.1" };
const USER_RESPONSE = { email: "player@example.com", id: "user-123" };
const JOBS_EMPTY = { jobs: [] };

/** Default fetch mock that handles /api/version, /api/me, and /api/jobs. */
function defaultFetchMock(
  input: string | URL | Request,
  _init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.includes("/api/me")) return Promise.resolve(jsonResponse(USER_RESPONSE));
  if (url.includes("/api/jobs")) return Promise.resolve(jsonResponse(JOBS_EMPTY));
  return Promise.resolve(jsonResponse(VERSION_RESPONSE));
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(defaultFetchMock);
});

describe("App", () => {
  it("renders the page heading", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 1 }),
    ).toHaveTextContent("AsyncAPI");
  });

  it("shows connected state after successful fetch", async () => {
    render(<App />);
    expect(
      await screen.findByText(/Connected to AsyncAPI v0\.0\.1/),
    ).toBeInTheDocument();
  });

  it("shows error message when version fetch rejects with an Error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network failure"),
    );

    render(<App />);
    expect(
      await screen.findByText("API error: Network failure"),
    ).toBeInTheDocument();
  });

  it("shows 'Unknown error' when fetch rejects with a non-Error value", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("something went wrong");

    render(<App />);
    expect(
      await screen.findByText("API error: Unknown error"),
    ).toBeInTheDocument();
  });

  it("shows error when version API responds with non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes("/api/me"))
          return Promise.resolve(jsonResponse(USER_RESPONSE));
        if (url.includes("/api/jobs"))
          return Promise.resolve(jsonResponse(JOBS_EMPTY));
        return Promise.resolve(new Response(null, { status: 500 }));
      },
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/API error:/)).toBeInTheDocument();
    });
    expect(
      screen.getByText("API error: API responded with 500"),
    ).toBeInTheDocument();
  });

  it("displays the user email and ID", async () => {
    render(<App />);
    expect(
      await screen.findByText("player@example.com"),
    ).toBeInTheDocument();
    expect(screen.getByText("user-123")).toBeInTheDocument();
  });

  it("shows error when user API responds with non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes("/api/me"))
          return Promise.resolve(new Response(null, { status: 403 }));
        if (url.includes("/api/jobs"))
          return Promise.resolve(jsonResponse(JOBS_EMPTY));
        return Promise.resolve(jsonResponse(VERSION_RESPONSE));
      },
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/API error:/)).toBeInTheDocument();
    });
    expect(
      screen.getByText("API error: User API responded with 403"),
    ).toBeInTheDocument();
  });

  it("shows the empty job list initially", async () => {
    render(<App />);
    expect(
      await screen.findByText("No jobs yet. Upload a PNG to get started."),
    ).toBeInTheDocument();
  });

  it("shows jobs returned by /api/jobs", async () => {
    const job = {
      id: "j-1",
      state: "pending",
      originalName: "sunset.png",
      contentType: "image/png",
      sizeBytes: 2048,
      error: null,
      createdAt: "2025-06-01T12:00:00.000Z",
      updatedAt: "2025-06-01T12:00:00.000Z",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes("/api/me"))
          return Promise.resolve(jsonResponse(USER_RESPONSE));
        if (url.includes("/api/jobs"))
          return Promise.resolve(jsonResponse({ jobs: [job] }));
        return Promise.resolve(jsonResponse(VERSION_RESPONSE));
      },
    );

    render(<App />);
    expect(await screen.findByText("sunset.png")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("refreshes job list after a successful upload", async () => {
    // First call to /api/jobs returns empty; subsequent calls return the new job.
    let jobsFetchCount = 0;
    const newJob = {
      id: "uploaded-1",
      state: "pending",
      originalName: "cat.png",
      contentType: "image/png",
      sizeBytes: 4096,
      error: null,
      createdAt: "2025-06-01T13:00:00.000Z",
      updatedAt: "2025-06-01T13:00:00.000Z",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes("/api/me"))
          return Promise.resolve(jsonResponse(USER_RESPONSE));
        if (url.includes("/api/upload"))
          return Promise.resolve(
            jsonResponse({ jobId: "uploaded-1" }, 201),
          );
        if (url.includes("/api/jobs")) {
          jobsFetchCount++;
          if (jobsFetchCount <= 1)
            return Promise.resolve(jsonResponse(JOBS_EMPTY));
          return Promise.resolve(jsonResponse({ jobs: [newJob] }));
        }
        return Promise.resolve(jsonResponse(VERSION_RESPONSE));
      },
    );

    const user = userEvent.setup();
    render(<App />);

    // Wait for initial load — should be empty.
    expect(
      await screen.findByText("No jobs yet. Upload a PNG to get started."),
    ).toBeInTheDocument();

    // Wait for the upload form to appear (requires user to be loaded).
    const uploadButton = await screen.findByRole("button", {
      name: "Upload",
    });

    // Select a file and upload.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const file = new File([pngBytes], "cat.png", { type: "image/png" });
    const fileInput = uploadButton
      .closest("form")!
      .querySelector("input[type='file']") as HTMLInputElement;
    await user.upload(fileInput, file);
    await user.click(uploadButton);

    // After upload, refresh is called and the new job appears.
    expect(await screen.findByText("cat.png")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });
});
