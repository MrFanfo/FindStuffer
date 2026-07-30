import { FormEvent, useRef, useState } from "react";

import { api, Item, ItemDocument } from "../api";

type Props = {
  item: Item;
  documents: ItemDocument[];
  onReload: () => Promise<void>;
  onItemChanged: (item: Item) => Promise<void>;
  notify: (message: string) => void;
};

const DOCUMENT_TYPES: Array<[ItemDocument["document_type"], string]> = [
  ["receipt", "Receipt"],
  ["invoice", "Invoice"],
  ["manual", "Manual"],
  ["certificate", "Certificate"],
  ["warranty", "Warranty"],
  ["other", "Other"],
];

function fileSize(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentSection({
  item,
  documents,
  onReload,
  onItemChanged,
  notify,
}: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] =
    useState<ItemDocument["document_type"]>("receipt");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [warrantyDate, setWarrantyDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await api.uploadDocument(item, file, {
        document_type: documentType,
        title: title || file.name.replace(/\.[^.]+$/, ""),
        purchase_date: purchaseDate || undefined,
        warranty_expires_at: warrantyDate || undefined,
      });
      setFile(null);
      setTitle("");
      setPurchaseDate("");
      setWarrantyDate("");
      if (fileInput.current) fileInput.current.value = "";
      await onReload();
      window.setTimeout(() => void onReload(), 1200);
      notify("Document saved; text extraction is running");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload document");
    } finally {
      setBusy(false);
    }
  }

  async function applyExtraction(document: ItemDocument) {
    setBusy(true);
    try {
      await api.applyDocumentExtraction(document);
      await onItemChanged(await api.item(item.public_id));
      await onReload();
      notify("Extracted serial and dates applied");
    } finally {
      setBusy(false);
    }
  }

  async function remove(document: ItemDocument) {
    if (!window.confirm(`Delete ${document.title}? The stored file will be removed.`)) return;
    setBusy(true);
    try {
      await api.deleteDocument(document);
      await onReload();
      notify("Document deleted");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="detail-section document-section">
      <div className="section-heading">
        <div>
          <h2>Documents & warranties</h2>
          <span>
            {documents.length
              ? `${documents.length} owned document${documents.length === 1 ? "" : "s"}`
              : "Receipts, invoices, manuals, certificates, and warranties"}
          </span>
        </div>
      </div>

      <div className="document-list">
        {documents.map((document) => {
          const extracted = Boolean(
            document.extracted_serial_number ||
            document.extracted_purchase_date ||
            document.extracted_warranty_expires_at,
          );
          return (
            <article className="document-row" key={document.public_id}>
              <div className="document-kind" aria-hidden="true">
                {document.mime_type === "application/pdf" ? "PDF" : "IMG"}
              </div>
              <div>
                <a href={document.content_url} target="_blank" rel="noreferrer">
                  {document.title}
                </a>
                <small>
                  {document.document_type} · {fileSize(document.size_bytes)}
                  {document.warranty_expires_at
                    ? ` · warranty ${document.warranty_expires_at}`
                    : ""}
                </small>
                <span className={`extraction-status ${document.extraction_status}`}>
                  OCR: {document.extraction_status}
                  {document.extraction_error ? ` · ${document.extraction_error}` : ""}
                </span>
                {extracted && (
                  <small>
                    Suggested:
                    {document.extracted_serial_number
                      ? ` serial ${document.extracted_serial_number}`
                      : ""}
                    {document.extracted_purchase_date
                      ? ` · purchased ${document.extracted_purchase_date}`
                      : ""}
                    {document.extracted_warranty_expires_at
                      ? ` · warranty ${document.extracted_warranty_expires_at}`
                      : ""}
                  </small>
                )}
              </div>
              <div className="document-actions">
                {extracted && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => void applyExtraction(document)}
                  >
                    Apply
                  </button>
                )}
                {["failed", "unavailable"].includes(document.extraction_status) && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void api.extractDocument(document).then(onReload)
                    }
                  >
                    Retry OCR
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Delete ${document.title}`}
                  disabled={busy}
                  onClick={() => void remove(document)}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <form className="document-upload-form" onSubmit={upload}>
        <label>
          File
          <input
            ref={fileInput}
            required
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const next = event.target.files?.[0] || null;
              setFile(next);
              if (next && !title) setTitle(next.name.replace(/\.[^.]+$/, ""));
            }}
          />
        </label>
        <div className="form-row">
          <label>
            Type
            <select
              value={documentType}
              onChange={(event) =>
                setDocumentType(event.target.value as ItemDocument["document_type"])
              }
            >
              {DOCUMENT_TYPES.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input
              required
              value={title}
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Store receipt"
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Purchase date
            <input
              type="date"
              value={purchaseDate}
              onChange={(event) => setPurchaseDate(event.target.value)}
            />
          </label>
          <label>
            Warranty expires
            <input
              type="date"
              value={warrantyDate}
              onChange={(event) => setWarrantyDate(event.target.value)}
            />
          </label>
        </div>
        {error && <div className="inline-alert" role="alert">{error}</div>}
        <button className="secondary" disabled={busy || !file || !title.trim()}>
          {busy ? "Saving…" : "Attach document"}
        </button>
      </form>
    </section>
  );
}
