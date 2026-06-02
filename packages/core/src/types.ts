export type OutputMode = "canonical" | "document" | "rag" | "jsonl";

export type ToolKind = "converter" | "processor" | "qualifier";

export interface ToolMeta {
  id: string;
  name: string;
  description: string;
  kind: ToolKind;
  inputExtensions: string[];
  outputModes: OutputMode[];
  multiFile?: boolean;
}

export interface ToolInputFile {
  name: string;
  extension: string;
  buffer: ArrayBuffer | Uint8Array;
}

export interface ToolInput {
  files?: ToolInputFile[];
  text?: string;
  json?: unknown;
}

export interface RagDocument {
  metadata: Record<string, string | number | boolean | null>;
  content: string;
}

export interface DiagnosticReport {
  inputFiles: string[];
  rowCount?: number;
  documentCount?: number;
  emptyFieldCount?: number;
  encodingFixCount?: number;
  estimatedTokens?: number;
  warnings: string[];
}

export interface ToolResult {
  data?: unknown;
  text?: string;
  documents?: RagDocument[];
  diagnostics: DiagnosticReport;
}

export interface ToolConfig {
  outputMode: OutputMode;
  removeEmptyFields?: boolean;
  normalizeWhitespace?: boolean;
  fixEncoding?: boolean;
  stripHtml?: boolean;
  stripControlChars?: boolean;
  excludedFields?: string[];
  fieldRenames?: Record<string, string>;
}

export interface ToolModule {
  meta: ToolMeta;
  defaultConfig: ToolConfig;
  run(input: ToolInput, config: ToolConfig): Promise<ToolResult>;
}
