"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { extractionSchema } from "@/lib/extraction";
import type { Extraction } from "@/lib/extraction";
import EmissionCalculation from "@/components/EmissionCalculation";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export default function DocumentUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Extraction | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";

    setFile(null);
    setDraft(null);
    setError("");

    if (!selected) return;

    if (!ALLOWED_TYPES.includes(selected.type)) {
      setError("Choose a PDF, JPG, or PNG.");
      return;
    }

    if (selected.size === 0 || selected.size > MAX_BYTES) {
      setError("Choose a non-empty file no larger than 10 MB.");
      return;
    }

    setFile(selected);
  }

  async function extract() {
    if (!file || loading) return;

    setLoading(true);
    setError("");
    setDraft(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/extract", {
        method: "POST",
        body: form,
      });

      // The browser sets the multipart Content-Type automatically.
      const text = await response.text();

      if (!text.trim()) {
        throw new Error(`Empty server response (HTTP ${response.status}).`);
      }

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `Invalid server response (HTTP ${response.status}). Check the terminal.`
        );
      }

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : `Extraction failed (HTTP ${response.status}).`
        );
      }

      const parsed = extractionSchema.safeParse(data?.extraction);

      if (!parsed.success) {
        throw new Error("The server returned an unexpected extraction.");
      }

      setDraft(parsed.data);
    } catch (error: unknown) {
      setError(
        error instanceof Error ? error.message : "Extraction failed."
      );
    } finally {
      setLoading(false);
    }
  }

  function editItem(
    index: number,
    changes: Partial<Extraction["items"][number]>
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, position) =>
              position === index ? { ...item, ...changes } : item
            ),
          }
        : current
    );
  }

  return (
    <section className="card section-spacing" id="upload">
      <p className="eyebrow">START WITH THE SOURCE</p>
      <h2>Upload and review a utility bill</h2>

      <div className="upload-zone">
        <label htmlFor="bill-file" className="upload-label">
          Choose a PDF, JPG, or PNG · Maximum 10 MB
        </label>
        <input
          id="bill-file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          disabled={loading}
          onChange={selectFile}
        />
      </div>

      {file && (
        <div className="file-review">
          <div className="section-heading">
            <div>
              <h3 className="file-name">{file.name}</h3>
              <p className="muted">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>

            <button
              type="button"
              className="remove-file"
              disabled={loading}
              onClick={() => {
                setFile(null);
                setDraft(null);
                setError("");
              }}
            >
              Remove file
            </button>
          </div>

          {previewUrl &&
            (file.type === "application/pdf" ? (
              <iframe
                src={previewUrl}
                title="Selected bill preview"
                className="document-preview"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Selected bill preview"
                className="image-preview"
              />
            ))}

          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="preview-link"
            >
              Open document preview ↗
            </a>
          )}

          <p className="info-note">
            Clicking Extract sends this document to Google Gemini.
            Use a sample bill for your first test.
          </p>

          <button
            type="button"
            className="button extract-button"
            disabled={loading}
            onClick={extract}
          >
            {loading ? "Extracting…" : "Extract with Gemini"}
          </button>
        </div>
      )}

      <div aria-live="polite" aria-busy={loading}>
        {loading && (
          <p className="muted">Reading the document. This may take a moment.</p>
        )}
      </div>

      {error && (
        <p className="copilot-error" role="alert">{error}</p>
      )}

      {draft && (
        <div className="extraction-review">
          <h2>Review extracted data</h2>
          <p className="muted">
            Unverified draft. Compare every field with the source.
            Edits stay in this page and are lost on refresh.
          </p>

          <div className="review-fields">
            <label>
              Supplier
              <input
                value={draft.supplier ?? ""}
                placeholder="Not found"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    supplier: event.target.value || null,
                  })
                }
              />
            </label>

            <label>
              Billing period
              <input
                value={draft.billingPeriod ?? ""}
                placeholder="Not found"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    billingPeriod: event.target.value || null,
                  })
                }
              />
            </label>
          </div>

          {draft.warnings.length > 0 && (
            <div className="alert">
              <strong>Extraction warnings</strong>
              <ul>
                {draft.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {draft.items.length === 0 && (
            <p className="info-note">
              No activity quantities were found. Check that this is a
              readable utility bill or fuel receipt.
            </p>
          )}

          {draft.items.map((item, index) => (
            <div className="extracted-item" key={index}>
              <h3>Activity {index + 1}</h3>

              <div className="review-fields">
                <label>
                  Activity type
                  <select
                    value={item.activity}
                    onChange={(event) =>
                      editItem(index, {
                        activity: event.target.value as typeof item.activity,
                      })
                    }
                  >
                    <option value="electricity">Electricity</option>
                    <option value="natural_gas">Natural gas</option>
                    <option value="diesel">Diesel</option>
                    <option value="petrol">Petrol</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <label>
                  Quantity
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={item.quantity ?? ""}
                    placeholder="Not found"
                    onChange={(event) => {
                      const number = event.target.valueAsNumber;
                      editItem(index, {
                        quantity:
                          Number.isFinite(number) && number >= 0
                            ? number
                            : null,
                      });
                    }}
                  />
                </label>

                <label>
                  Original unit
                  <input
                    value={item.unit ?? ""}
                    placeholder="Not found"
                    onChange={(event) =>
                      editItem(index, {
                        unit: event.target.value || null,
                      })
                    }
                  />
                </label>
              </div>

              <p className="info-note">
                <strong>Gemini’s source reference:</strong>{" "}
                {item.evidence}
              </p>
            </div>
          ))}
             <EmissionCalculation
               key={JSON.stringify(draft)}
               items={draft.items}
             />
          <p className="info-note">
            Nothing has been saved to a database or added to emissions totals.
          </p>
        </div>
      )}
    </section>
  );
}