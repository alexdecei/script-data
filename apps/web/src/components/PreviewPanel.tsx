import type { DiagnosticReport, RedactionFinding, ToolResult } from "@rag-data-toolkit/core";
import type { FilePreviewState, PreviewTable } from "../hooks/useFilePreview.js";

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
    ["Secrets censures", diagnostics.redactionCounts?.secret ?? 0],
    ["Certificats censures", diagnostics.redactionCounts?.certificate ?? 0],
    ["IP censurees", diagnostics.redactionCounts?.ip ?? 0],
    ["Chemins censures", diagnostics.redactionCounts?.internalPath ?? 0],
    ["Images base64 retirees", diagnostics.removedBase64Images ?? 0],
    ["Articles inactifs exclus", diagnostics.excludedInactiveArticles ?? 0],
    ["Articles vides exclus", diagnostics.excludedEmptyArticles ?? 0],
    ["Pages menu detectees", diagnostics.detectedMenuPages ?? 0],
    ["Pages menu exclues", diagnostics.excludedMenuPages ?? 0],
    ["Articles surtout liens", diagnostics.articlesWithMostlyLinks ?? 0],
    ["Liens internes moyens", diagnostics.averageInternalLinksPerArticle ?? 0],
    ["Articles exportes", diagnostics.exportedArticles ?? 0],
    ["Tokens estimes", diagnostics.estimatedTokens ?? "-"]
  ];

  return (
    <div className="diagnostics">
      {rows.map(([label, value]) => (
        <div className="diagnostic-row" key={label}>
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
      {diagnostics.redactionFindings && diagnostics.redactionFindings.length > 0 && (
        <RedactionFindingsList findings={diagnostics.redactionFindings} />
      )}
    </div>
  );
}

const findingLabels: Record<RedactionFinding["type"], string> = {
  secret: "Secret",
  certificate: "Certificat",
  ip: "IP",
  internalPath: "Chemin interne"
};

function RedactionFindingsList({ findings }: { findings: RedactionFinding[] }) {
  return (
    <div className="redaction-findings">
      <h3>Elements detectes pour censure</h3>
      <div className="finding-list">
        {findings.slice(0, 100).map((finding, index) => (
          <label className="finding-item" key={`${finding.type}-${finding.fieldPath ?? "text"}-${index}`}>
            <input defaultChecked type="checkbox" />
            <span className="finding-content">
              <strong>{findingLabels[finding.type]}</strong>
              {finding.fieldPath ? <em>{finding.fieldPath}</em> : null}
              <code>{finding.preview}</code>
            </span>
          </label>
        ))}
      </div>
      {findings.length > 100 && <p className="preview-note">Liste limitee aux 100 premieres detections.</p>}
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

function TablePreview({ table }: { table: PreviewTable }) {
  return (
    <div className="table-preview-wrap">
      <table className="preview-table">
        <thead>
          <tr>
            {table.headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
        ) : inputPreview.table ? (
          <>
            {(inputPreview.truncated || inputPreview.note) && (
              <p className="preview-note">
                {inputPreview.truncated ? "Apercu tronque pour proteger les performances. " : ""}
                {inputPreview.note}
              </p>
            )}
            <TablePreview table={inputPreview.table} />
          </>
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
