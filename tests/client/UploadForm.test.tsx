import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UploadForm from "../../src/client/UploadForm";

/** Build a successful JSON response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Create a minimal PNG file for testing. */
function makePngFile(name = "test.png"): File {
  // Minimal valid 1x1 white PNG
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return new File([bytes], name, { type: "image/png" });
}

describe("UploadForm", () => {
  const onUploaded = vi.fn();

  beforeEach(() => {
    onUploaded.mockClear();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ jobId: "abc-123" }, 201),
    );
  });

  it("renders a file input and a disabled button initially", () => {
    render(<UploadForm onUploaded={onUploaded} />);
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Upload" }),
    ).toBeInTheDocument();
  });

  it("enables the button after selecting a file", async () => {
    const user = userEvent.setup();
    render(<UploadForm onUploaded={onUploaded} />);

    const input = screen.getByRole("button", { name: "Upload" })
      .closest("form")!
      .querySelector("input[type='file']") as HTMLInputElement;
    const file = makePngFile();
    await user.upload(input, file);

    expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
  });

  it("submits the file via fetch and calls onUploaded with the jobId", async () => {
    const user = userEvent.setup();
    render(<UploadForm onUploaded={onUploaded} />);

    const input = screen.getByRole("button", { name: "Upload" })
      .closest("form")!
      .querySelector("input[type='file']") as HTMLInputElement;
    await user.upload(input, makePngFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith("abc-123");
    });

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/upload", {
      method: "POST",
      body: expect.any(FormData) as FormData,
    });
  });

  it("resets state after a successful upload", async () => {
    const user = userEvent.setup();
    render(<UploadForm onUploaded={onUploaded} />);

    const input = screen.getByRole("button", { name: "Upload" })
      .closest("form")!
      .querySelector("input[type='file']") as HTMLInputElement;
    await user.upload(input, makePngFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalled();
    });

    // Button disabled again after reset
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
  });

  it("shows an error on a non-OK response and re-enables the button", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 400 }),
    );

    const user = userEvent.setup();
    render(<UploadForm onUploaded={onUploaded} />);

    const input = screen.getByRole("button", { name: "Upload" })
      .closest("form")!
      .querySelector("input[type='file']") as HTMLInputElement;
    await user.upload(input, makePngFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(
      await screen.findByText("Upload failed: 400"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("shows an error when fetch rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network failure"),
    );

    const user = userEvent.setup();
    render(<UploadForm onUploaded={onUploaded} />);

    const input = screen.getByRole("button", { name: "Upload" })
      .closest("form")!
      .querySelector("input[type='file']") as HTMLInputElement;
    await user.upload(input, makePngFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Network failure")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("shows 'Unknown error' when fetch rejects with a non-Error value", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue("oops");

    const user = userEvent.setup();
    render(<UploadForm onUploaded={onUploaded} />);

    const input = screen.getByRole("button", { name: "Upload" })
      .closest("form")!
      .querySelector("input[type='file']") as HTMLInputElement;
    await user.upload(input, makePngFile());
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText("Unknown error")).toBeInTheDocument();
  });
});
