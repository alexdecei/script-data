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
  | "stripControlChars";

const toggleOptions: BooleanConfigOption[] = [
  "removeEmptyFields",
  "normalizeWhitespace",
  "fixEncoding",
  "stripHtml",
  "stripControlChars"
];

const optionLabels: Record<BooleanConfigOption, string> = {
  removeEmptyFields: "Retirer champs vides",
  normalizeWhitespace: "Normaliser espaces",
  fixEncoding: "Corriger encodage",
  stripHtml: "Nettoyer HTML",
  stripControlChars: "Retirer controles"
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
