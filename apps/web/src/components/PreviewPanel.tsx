import type { DiagnosticReport, ToolResult } from "@rag-data-toolkit/core";
import type { FilePreviewState } from "../hooks/useFilePreview.js";

interface PreviewState {
  text: string;
  truncated: boolean;
  note: string;
}

interface PreviewPanelProps {
  inputPreview: FilePreviewState;
  inputPreviewError: string;
  outputPreview: PreviewState;
  result?: ToolResult;
  error: string;
  onDownload: () => void;
}

function DiagnosticsView({ diagnostics }: { diagnostics?: DiagnosticReport }) {
  if (!diagnostics) {
    return <p className="muted">Aucun diagnostic.</p>;
  }

  const rows: Array<[string, string | number]> = [
    ["Fichiers", diagnostics.inputFiles.join(", ")],
    ["Lignes", diagnostics.rowCount ?? "-"],
    ["Documents", diagnostics.documentCount ?? "-"],
    ["Champs vides", diagnostics.emptyFieldCount ?? "-"],
    ["Corrections encodage", diagnostics.encodingFixCount ?? "-"],
    ["Tokens estimes", diagnostics.estimatedTokens ?? "-"]
  ];

  return (
    <div className="diagnostics">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      {diagnostics.warnings.length > 0 && (
        <ul>
          {diagnostics.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormattedPreview({
  emptyText,
  preview
}: {
  emptyText: string;
  preview: PreviewState;
}) {
  return (
    <>
      {(preview.truncated || preview.note) && (
        <p className="preview-note">
          {preview.truncated ? "Apercu tronque pour proteger les performances. " : ""}
          {preview.note}
        </p>
      )}
      <pre className="formatted-preview">{preview.text || emptyText}</pre>
    </>
  );
}

export function PreviewPanel({
  inputPreview,
  inputPreviewError,
  outputPreview,
  result,
  error,
  onDownload
}: PreviewPanelProps) {
  return (
    <section className="preview-panel" aria-label="Previews et diagnostics">
      <section className="preview-section">
        <div className="section-heading">
          <h2>Apercu entree</h2>
        </div>
        {inputPreviewError ? (
          <p className="error-text">{inputPreviewError}</p>
        ) : (
          <FormattedPreview emptyText="Aucun apercu." preview={inputPreview} />
        )}
      </section>

      <section className="preview-section output-section">
        <div className="section-heading">
          <h2>Apercu sortie</h2>
          <button disabled={!result} onClick={onDownload} type="button">
            Telecharger
          </button>
        </div>
        {error ? (
          <p className="error-text">{error}</p>
        ) : (
          <FormattedPreview emptyText="Aucune sortie." preview={outputPreview} />
        )}
      </section>

      <section className="preview-section diagnostics-section">
        <div className="section-heading">
          <h2>Diagnostics</h2>
        </div>
        <DiagnosticsView diagnostics={result?.diagnostics} />
      </section>
    </section>
  );
}
