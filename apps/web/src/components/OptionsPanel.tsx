import type { OutputMode, ToolConfig, ToolModule } from "@rag-data-toolkit/core";

interface OptionsPanelProps {
  tool: ToolModule;
  files: File[];
  config: ToolConfig;
  excludedFields: string;
  fieldRenames: string;
  isRunning: boolean;
  onConfigChange: (config: ToolConfig) => void;
  onExcludedFieldsChange: (value: string) => void;
  onFieldRenamesChange: (value: string) => void;
  onFilesChange: (files: File[]) => void;
  onRun: () => void;
  onReset: () => void;
}

type BooleanConfigOption =
  | "removeEmptyFields"
  | "normalizeWhitespace"
  | "fixEncoding"
  | "stripHtml"
  | "stripControlChars"
  | "removeBase64Images"
  | "redactSensitive";

const toggleOptions: BooleanConfigOption[] = [
  "removeEmptyFields",
  "normalizeWhitespace",
  "fixEncoding",
  "stripHtml",
  "stripControlChars",
  "removeBase64Images",
  "redactSensitive"
];

const optionLabels: Record<BooleanConfigOption, string> = {
  removeEmptyFields: "Retirer champs vides",
  normalizeWhitespace: "Normaliser espaces",
  fixEncoding: "Corriger encodage",
  stripHtml: "Nettoyer HTML",
  stripControlChars: "Retirer controles",
  removeBase64Images: "Retirer images base64",
  redactSensitive: "Censure"
};

export function OptionsPanel({
  tool,
  files,
  config,
  excludedFields,
  fieldRenames,
  isRunning,
  onConfigChange,
  onExcludedFieldsChange,
  onFieldRenamesChange,
  onFilesChange,
  onRun,
  onReset
}: OptionsPanelProps) {
  const acceptedExtensions = tool.meta.inputExtensions.map((extension) => `.${extension}`).join(",");

  return (
    <main className="work-panel">
      <header className="panel-heading">
        <div>
          <p>{tool.meta.kind}</p>
          <h2>{tool.meta.name}</h2>
        </div>
        <span>{tool.meta.inputExtensions.map((extension) => `.${extension}`).join(" ")}</span>
      </header>

      <section className="control-section">
        <label className="file-picker">
          <span>Fichiers</span>
          <input
            accept={acceptedExtensions}
            multiple={tool.meta.multiFile}
            onChange={(event) => onFilesChange(Array.from(event.currentTarget.files ?? []))}
            type="file"
          />
        </label>
        <div className="file-list">
          {files.length > 0 ? files.map((file) => <span key={`${file.name}-${file.size}`}>{file.name}</span>) : "Aucun fichier selectionne"}
        </div>
      </section>

      <section className="control-section">
        <label className="field">
          <span>Sortie</span>
          <select
            onChange={(event) =>
              onConfigChange({
                ...config,
                outputMode: event.currentTarget.value as OutputMode
              })
            }
            value={config.outputMode}
          >
            {tool.meta.outputModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>

        <div className="toggle-grid">
          {toggleOptions.map((option) => (
            <label className="toggle" key={option}>
              <input
                checked={Boolean(config[option])}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    [option]: event.currentTarget.checked
                  })
                }
                type="checkbox"
              />
              <span>{optionLabels[option]}</span>
            </label>
          ))}
        </div>
      </section>

      {(config.includeInactive !== undefined ||
        config.minBodyLength !== undefined ||
        config.includeMenuPages !== undefined ||
        config.includeMenuPagesInCanonical !== undefined) && (
        <section className="control-section two-col">
          {config.includeInactive !== undefined && (
            <label className="toggle">
              <input
                checked={Boolean(config.includeInactive)}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    includeInactive: event.currentTarget.checked
                  })
                }
                type="checkbox"
              />
              <span>Inclure inactifs</span>
            </label>
          )}
          {config.includeMenuPages !== undefined && (
            <label className="toggle">
              <input
                checked={Boolean(config.includeMenuPages)}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    includeMenuPages: event.currentTarget.checked
                  })
                }
                type="checkbox"
              />
              <span>Inclure pages menu en RAG</span>
            </label>
          )}
          {config.includeMenuPagesInCanonical !== undefined && (
            <label className="toggle">
              <input
                checked={Boolean(config.includeMenuPagesInCanonical)}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    includeMenuPagesInCanonical: event.currentTarget.checked
                  })
                }
                type="checkbox"
              />
              <span>Inclure pages menu en canonical</span>
            </label>
          )}
          {config.minBodyLength !== undefined && (
            <label className="field">
              <span>Longueur minimale du contenu</span>
              <input
                min={0}
                onChange={(event) =>
                  onConfigChange({
                    ...config,
                    minBodyLength: Number(event.currentTarget.value)
                  })
                }
                type="number"
                value={config.minBodyLength}
              />
            </label>
          )}
        </section>
      )}

      <section className="control-section two-col">
        <label className="field">
          <span>Champs exclus</span>
          <input
            onChange={(event) => onExcludedFieldsChange(event.currentTarget.value)}
            placeholder="id_interne, brouillon"
            value={excludedFields}
          />
        </label>
        <label className="field">
          <span>Renommages</span>
          <input
            onChange={(event) => onFieldRenamesChange(event.currentTarget.value)}
            placeholder="ancien:nouveau"
            value={fieldRenames}
          />
        </label>
      </section>

      <div className="action-row">
        <button disabled={files.length === 0 || isRunning} onClick={onRun} type="button">
          {isRunning ? "Execution..." : "Executer"}
        </button>
        <button className="secondary" onClick={onReset} type="button">
          Reinitialiser
        </button>
      </div>
    </main>
  );
}
