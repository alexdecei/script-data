import type { RagDocument, ToolConfig } from "../types.js";
import { fixEncoding } from "./encoding-fix.js";
import { cleanForRag } from "./text-cleanup.js";

export interface RecordTransformResult {
  record: Record<string, unknown>;
  encodingFixCount: number;
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function normalizeValue(value: unknown, config: ToolConfig): { value: unknown; encodingFixCount: number } {
  if (typeof value === "string") {
    const fixed = config.fixEncoding ? fixEncoding(value) : { text: value, corrections: 0 };
    const cleaned = cleanForRag(fixed.text, {
      normalizeWhitespace: config.normalizeWhitespace,
      stripHtml: config.stripHtml,
      stripControlChars: config.stripControlChars
    });

    return {
      value: cleaned,
      encodingFixCount: fixed.corrections
    };
  }

  if (Array.isArray(value)) {
    let encodingFixCount = 0;
    const values = value.map((item) => {
      const result = normalizeValue(item, config);
      encodingFixCount += result.encodingFixCount;
      return result.value;
    });

    return { value: values, encodingFixCount };
  }

  if (value instanceof Date) {
    return { value: value.toISOString(), encodingFixCount: 0 };
  }

  if (value && typeof value === "object") {
    let encodingFixCount = 0;
    const entries = Object.entries(value).map(([key, item]) => {
      const result = normalizeValue(item, config);
      encodingFixCount += result.encodingFixCount;
      return [key, result.value] as const;
    });

    return {
      value: Object.fromEntries(entries),
      encodingFixCount
    };
  }

  return { value, encodingFixCount: 0 };
}

export function transformRecord(
  record: Record<string, unknown>,
  config: ToolConfig
): RecordTransformResult {
  const excluded = new Set(config.excludedFields ?? []);
  const renames = config.fieldRenames ?? {};
  let encodingFixCount = 0;
  const transformed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (excluded.has(key)) {
      continue;
    }

    const result = normalizeValue(value, config);
    encodingFixCount += result.encodingFixCount;

    if (config.removeEmptyFields && isEmptyValue(result.value)) {
      continue;
    }

    const targetKey = renames[key] || key;
    transformed[targetKey] = result.value;
  }

  return {
    record: transformed,
    encodingFixCount
  };
}

function toContentValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function toMetadataValue(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string" && value.length <= 80) {
    return value;
  }

  return undefined;
}

export interface RagDocumentOptions {
  sourceFile: string;
  sourceType: string;
  toolId: string;
  rowNumber?: number;
}

export function recordToRagDocument(
  record: Record<string, unknown>,
  options: RagDocumentOptions
): RagDocument {
  const metadata: RagDocument["metadata"] = {
    source_file: options.sourceFile,
    source_type: options.sourceType,
    tool: options.toolId
  };

  if (options.rowNumber !== undefined) {
    metadata.row = options.rowNumber;
  }

  const contentLines: string[] = [];

  for (const [key, value] of Object.entries(record)) {
    const contentValue = toContentValue(value);

    if (contentValue) {
      contentLines.push(`${key}: ${contentValue}`);
    }

    const metadataValue = toMetadataValue(value);

    if (metadataValue !== undefined) {
      metadata[key] = metadataValue;
    }
  }

  return {
    metadata,
    content: contentLines.join("\n")
  };
}

export function documentsToJsonl(documents: RagDocument[]): string {
  return documents.map((document) => JSON.stringify(document)).join("\n");
}
