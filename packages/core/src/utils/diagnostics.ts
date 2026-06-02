import type { DiagnosticReport, RagDocument, RedactionCounts, RedactionFinding } from "../types.js";
import { cloneEmptyRedactionCounts } from "./redact-sensitive.js";

export function estimateTokens(text: string): number {
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.ceil(wordCount * 1.3);
}

export function countEmptyFields(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countEmptyFields(item), 0);
  }

  if (value && typeof value === "object") {
    return Object.values(value).reduce((total, item) => total + countEmptyFields(item), 0);
  }

  if (value === null || value === undefined) {
    return 1;
  }

  if (typeof value === "string" && value.trim() === "") {
    return 1;
  }

  return 0;
}

export function stringifyForDiagnostics(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value) ?? "";
}

export interface DiagnosticInput {
  inputFiles: string[];
  rowCount?: number;
  documentCount?: number;
  documents?: RagDocument[];
  data?: unknown;
  text?: string;
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
  warnings?: string[];
}

export function createDiagnostics(input: DiagnosticInput): DiagnosticReport {
  const textForTokens =
    input.text ??
    (input.documents ? input.documents.map((document) => document.content).join("\n\n") : undefined) ??
    stringifyForDiagnostics(input.data);

  const diagnostics: DiagnosticReport = {
    inputFiles: input.inputFiles,
    warnings: input.warnings ?? [],
    emptyFieldCount: countEmptyFields(input.data ?? input.documents ?? input.text),
    encodingFixCount: input.encodingFixCount ?? 0,
    redactionCounts: input.redactionCounts ?? cloneEmptyRedactionCounts(),
    redactionFindings: input.redactionFindings ?? [],
    removedBase64Images: input.removedBase64Images ?? 0,
    excludedEmptyArticles: input.excludedEmptyArticles ?? 0,
    excludedInactiveArticles: input.excludedInactiveArticles ?? 0,
    excludedMenuPages: input.excludedMenuPages ?? 0,
    detectedMenuPages: input.detectedMenuPages ?? 0,
    averageInternalLinksPerArticle: input.averageInternalLinksPerArticle ?? 0,
    articlesWithMostlyLinks: input.articlesWithMostlyLinks ?? 0,
    exportedArticles: input.exportedArticles ?? 0,
    totalItems: input.totalItems ?? 0,
    qualifiedItems: input.qualifiedItems ?? 0,
    failedItems: input.failedItems ?? 0,
    durationMs: input.durationMs ?? 0,
    averageMsPerItem: input.averageMsPerItem ?? 0,
    errors: input.errors ?? [],
    estimatedTokens: estimateTokens(textForTokens)
  };

  if (input.rowCount !== undefined) {
    diagnostics.rowCount = input.rowCount;
  }

  if (input.documents) {
    diagnostics.documentCount = input.documents.length;
  } else if (input.documentCount !== undefined) {
    diagnostics.documentCount = input.documentCount;
  }

  return diagnostics;
}
