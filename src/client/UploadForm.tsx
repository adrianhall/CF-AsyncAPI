/**
 * Upload form component for submitting PNG images.
 *
 * Provides a controlled file input restricted to PNG images, handles
 * the multipart upload to `/api/upload`, and reports the resulting
 * job ID back to the parent via the `onUploaded` callback.
 *
 * @module
 */

import { type FormEvent, useRef, useState } from "react";

/** Props accepted by {@link UploadForm}. */
interface UploadFormProps {
  onUploaded: (jobId: string) => void;
}

/** Controlled PNG upload form. */
function UploadForm({ onUploaded }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { jobId } = (await res.json()) as { jobId: string };
      onUploaded(jobId);
      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="upload-form" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button type="submit" disabled={!file || uploading}>
        {uploading ? "Uploading\u2026" : "Upload"}
      </button>
      {error && <p className="upload-error">{error}</p>}
    </form>
  );
}

export default UploadForm;
