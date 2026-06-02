import {
  getToolById,
  groupToolsByKind,
  type OutputMode,
  type ToolConfig,
  type ToolInput,
  type ToolResult
} from "@rag-data-toolkit/core";
import { useMemo, useState } from "react";
import { OptionsPanel } from "./components/OptionsPanel.js";
import { PreviewPanel } from "./components/PreviewPanel.js";
import { ToolSidebar } from "./components/ToolSidebar.js";
import { useFilePreview } from "./hooks/useFilePreview.js";

const OUTPUT_PREVIEW_CHARS = 20000;

interface ResultPreview {
  text: string;
  truncated: boolean;
  note: string;
}

function getExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot === -1 ? "" : fileName.slice(lastDot + 1).toLowerCase();
}

function parseList(value: string): string[] | undefined {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

function parseRenames(value: string): Record<string, string> | undefined {
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [source, target] = item.split(":").map((part) => part.trim());

      if (!source || !target) {
        throw new Error(`Renommage invalide: ${item}`);
      }

      return [source, target] as const;
    });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function filesToInput(files: File[]): Promise<ToolInput> {
  const inputFiles = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      extension: getExtension(file.name),
      buffer: await file.arrayBuffer()
    }))
  );
  const input: ToolInput = { files: inputFiles };

  if (files[0] && getExtension(files[0].name) === "json") {
    input.text = await files[0].text();
  }

  return input;
}

function resultToPreview(result?: ToolResult): ResultPreview {
  if (!result) {
    return { text: "", truncated: false, note: "" };
  }

  let text: string;

  if (result.text !== undefined) {
    text = result.text;
  } else {
    const data = result.documents ?? result.data;
    text = JSON.stringify(data ?? null, null, 2) ?? "";
  }

  const truncated = text.length > OUTPUT_PREVIEW_CHARS;

  return {
    text: truncated ? text.slice(0, OUTPUT_PREVIEW_CHARS) : text,
    truncated,
    note: truncated ? `Sortie formatee limitee a ${OUTPUT_PREVIEW_CHARS.toLocaleString("fr-FR")} caracteres.` : ""
  };
}

function outputExtension(mode: OutputMode): string {
  if (mode === "document") {
    return "md";
  }

  if (mode === "jsonl") {
    return "jsonl";
  }

  return "json";
}

function serializeResult(result: ToolResult): string {
  if (result.text !== undefined) {
    return result.text;
  }

  return JSON.stringify(result.documents ?? result.data ?? null, null, 2);
}

export default function App() {
  const groups = useMemo(() => groupToolsByKind(), []);
  const [selectedToolId, setSelectedToolId] = useState("csv-xlsx-to-json");
  const selectedTool = (getToolById(selectedToolId) ?? getToolById("csv-xlsx-to-json"))!;

  const [files, setFiles] = useState<File[]>([]);
  const [config, setConfig] = useState<ToolConfig>(selectedTool.defaultConfig);
  const [excludedFields, setExcludedFields] = useState("");
  const [fieldRenames, setFieldRenames] = useState("");
  const [result, setResult] = useState<ToolResult | undefined>();
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const { preview: inputPreview, error: inputPreviewError } = useFilePreview(files);

  function selectTool(toolId: string) {
    const tool = getToolById(toolId);

    if (!tool) {
      return;
    }

    setSelectedToolId(toolId);
    setConfig(tool.defaultConfig);
    setFiles([]);
    setResult(undefined);
    setError("");
    setExcludedFields("");
    setFieldRenames("");
  }

  function resetCurrentTool() {
    setConfig(selectedTool.defaultConfig);
    setFiles([]);
    setResult(undefined);
    setError("");
    setExcludedFields("");
    setFieldRenames("");
  }

  async function runTool() {
    setIsRunning(true);
    setError("");

    try {
      const input = await filesToInput(files);
      const nextConfig: ToolConfig = {
        ...config,
        excludedFields: parseList(excludedFields),
        fieldRenames: parseRenames(fieldRenames)
      };
      const nextResult = await selectedTool.run(input, nextConfig);
      setResult(nextResult);
    } catch (runError) {
      setResult(undefined);
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsRunning(false);
    }
  }

  function downloadResult() {
    if (!result) {
      return;
    }

    const baseName = files[0]?.name.replace(/\.[^.]+$/, "") || selectedTool.meta.id;
    const blob = new Blob([serializeResult(result)], {
      type: config.outputMode === "document" ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}.${outputExtension(config.outputMode)}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <ToolSidebar groups={groups} onSelectTool={selectTool} selectedToolId={selectedToolId} />
      <div className="content-area">
        <OptionsPanel
          config={config}
          excludedFields={excludedFields}
          fieldRenames={fieldRenames}
          files={files}
          isRunning={isRunning}
          onConfigChange={setConfig}
          onExcludedFieldsChange={setExcludedFields}
          onFieldRenamesChange={setFieldRenames}
          onFilesChange={setFiles}
          onReset={resetCurrentTool}
          onRun={runTool}
          tool={selectedTool}
        />
        <PreviewPanel
          error={error}
          inputPreview={inputPreview}
          inputPreviewError={inputPreviewError}
          onDownload={downloadResult}
          outputPreview={resultToPreview(result)}
          result={result}
        />
      </div>
    </div>
  );
}
