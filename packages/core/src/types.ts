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
  redactionCounts?: RedactionCounts;
  redactionFindings?: RedactionFinding[];
  removedBase64Images?: number;
  excludedEmptyArticles?: number;
  excludedInactiveArticles?: number;
  excludedMenuPages?: number;
  detectedMenuPages?: number;
  averageInternalLinksPerArticle?: number;
  articlesWithMostlyLinks?: number;
  exportedArticles?: number;
  totalItems?: number;
  qualifiedItems?: number;
  failedItems?: number;
  durationMs?: number;
  averageMsPerItem?: number;
  errors?: string[];
  estimatedTokens?: number;
  warnings: string[];
}

export interface RedactionCounts {
  secret: number;
  certificate: number;
  ip: number;
  internalPath: number;
}

export type RedactionType = keyof RedactionCounts;

export interface RedactionFinding {
  type: RedactionType;
  fieldPath?: string;
  placeholder: string;
  preview: string;
}

export interface ToolResult {
  data?: unknown;
  text?: string;
  documents?: RagDocument[];
  report?: unknown;
  diagnostics: DiagnosticReport;
}

export interface ToolConfig {
  outputMode: OutputMode;
  removeEmptyFields?: boolean;
  normalizeWhitespace?: boolean;
  fixEncoding?: boolean;
  stripHtml?: boolean;
  stripControlChars?: boolean;
  removeBase64Images?: boolean;
  redactSensitive?: boolean;
  redactSecrets?: boolean;
  redactCertificates?: boolean;
  redactIps?: boolean;
  redactInternalPaths?: boolean;
  excludedFields?: string[];
  fieldRenames?: Record<string, string>;
  includeInactive?: boolean;
  minBodyLength?: number;
  includeMenuPages?: boolean;
  includeMenuPagesInCanonical?: boolean;
  enableOpenAIQualification?: boolean;
  concurrency?: number;
  maxRetries?: number;
  contentField?: string;
  titleField?: string;
  categoryField?: string;
  minScore?: number;
  onlyRagCandidates?: boolean;
  keepAuthor?: boolean;
  keepClient?: boolean;
  redactClient?: boolean;
  pretty?: boolean;
}

export interface ToolModule {
  meta: ToolMeta;
  defaultConfig: ToolConfig;
  run(input: ToolInput, config: ToolConfig): Promise<ToolResult>;
}
