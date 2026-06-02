import type { RagDocument, RedactionCounts, RedactionFinding, ToolConfig } from "../types.js";
import { fixEncoding } from "./encoding-fix.js";
import { removeBase64Images } from "./base64-images.js";
import {
  cloneEmptyRedactionCounts,
  mergeRedactionCounts,
  redactSensitiveFieldValue,
  redactSensitiveText
} from "./redact-sensitive.js";
import { cleanForRag } from "./text-cleanup.js";

export interface RecordTransformResult {
  record: Record<string, unknown>;
  encodingFixCount: number;
  redactionCounts: RedactionCounts;
  redactionFindings: RedactionFinding[];
  removedBase64Images: number;
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function normalizeValue(
  value: unknown,
  config: ToolConfig,
  fieldPath = ""
): {
  value: unknown;
  encodingFixCount: number;
  redactionCounts: RedactionCounts;
  redactionFindings: RedactionFinding[];
  removedBase64Images: number;
} {
  if (typeof value === "string") {
    const fixed = config.fixEncoding ? fixEncoding(value) : { text: value, corrections: 0 };
    const withoutImages =
      config.removeBase64Images === false
        ? { text: fixed.text, removedBase64Images: 0 }
        : removeBase64Images(fixed.text);
    const cleaned = cleanForRag(withoutImages.text, {
      normalizeWhitespace: config.normalizeWhitespace,
      stripHtml: config.stripHtml,
      stripControlChars: config.stripControlChars
    });
    const redacted = redactSensitiveText(cleaned, config, fieldPath);

    return {
      value: redacted.text,
      encodingFixCount: fixed.corrections,
      redactionCounts: redacted.counts,
      redactionFindings: redacted.findings,
      removedBase64Images: withoutImages.removedBase64Images
    };
  }

  if (Array.isArray(value)) {
    let encodingFixCount = 0;
    let removedBase64Images = 0;
    const redactionCounts = cloneEmptyRedactionCounts();
    const redactionFindings: RedactionFinding[] = [];
    const values = value.map((item, index) => {
      const result = normalizeValue(item, config, `${fieldPath}[${index}]`);
      encodingFixCount += result.encodingFixCount;
      removedBase64Images += result.removedBase64Images;
      mergeRedactionCounts(redactionCounts, result.redactionCounts);
      redactionFindings.push(...result.redactionFindings);
      return result.value;
    });

    return { value: values, encodingFixCount, redactionCounts, redactionFindings, removedBase64Images };
  }

  if (value instanceof Date) {
    return {
      value: value.toISOString(),
      encodingFixCount: 0,
      redactionCounts: cloneEmptyRedactionCounts(),
      redactionFindings: [],
      removedBase64Images: 0
    };
  }

  if (value && typeof value === "object") {
    let encodingFixCount = 0;
    let removedBase64Images = 0;
    const redactionCounts = cloneEmptyRedactionCounts();
    const redactionFindings: RedactionFinding[] = [];
    const entries = Object.entries(value).map(([key, item]) => {
      const nextPath = fieldPath ? `${fieldPath}.${key}` : key;
      const result = normalizeValue(item, config, nextPath);
      encodingFixCount += result.encodingFixCount;
      removedBase64Images += result.removedBase64Images;
      mergeRedactionCounts(redactionCounts, result.redactionCounts);
      redactionFindings.push(...result.redactionFindings);
      return [key, result.value] as const;
    });

    return {
      value: Object.fromEntries(entries),
      encodingFixCount,
      redactionCounts,
      redactionFindings,
      removedBase64Images
    };
  }

  return {
    value,
    encodingFixCount: 0,
    redactionCounts: cloneEmptyRedactionCounts(),
    redactionFindings: [],
    removedBase64Images: 0
  };
}

export function transformRecord(
  record: Record<string, unknown>,
  config: ToolConfig
): RecordTransformResult {
  const excluded = new Set(config.excludedFields ?? []);
  const renames = config.fieldRenames ?? {};
  let encodingFixCount = 0;
  let removedBase64Images = 0;
  const redactionCounts = cloneEmptyRedactionCounts();
  const redactionFindings: RedactionFinding[] = [];
  const transformed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (excluded.has(key)) {
      continue;
    }

    const result = normalizeValue(value, config, key);
    encodingFixCount += result.encodingFixCount;
    removedBase64Images += result.removedBase64Images;
    mergeRedactionCounts(redactionCounts, result.redactionCounts);
    redactionFindings.push(...result.redactionFindings);
    const keyedRedaction = redactSensitiveFieldValue(key, result.value, config);
    mergeRedactionCounts(redactionCounts, keyedRedaction.counts);
    redactionFindings.push(...keyedRedaction.findings);

    if (config.removeEmptyFields && isEmptyValue(keyedRedaction.value)) {
      continue;
    }

    const targetKey = renames[key] || key;
    transformed[targetKey] = keyedRedaction.value;
  }

  return {
    record: transformed,
    encodingFixCount,
    redactionCounts,
    redactionFindings,
    removedBase64Images
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
