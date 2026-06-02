import type { RedactionFinding, ToolModule } from "../types.js";
import { createDiagnostics } from "../utils/diagnostics.js";
import { cloneEmptyRedactionCounts, mergeRedactionCounts } from "../utils/redact-sensitive.js";
import {
  documentsToJsonl,
  recordToRagDocument,
  transformRecord
} from "../utils/record-transform.js";

function parseInputJson(inputJson: unknown, text: string | undefined): unknown {
  if (inputJson !== undefined) {
    return inputJson;
  }

  if (!text) {
    throw new Error("JSON cleaner expects parsed JSON or input text.");
  }

  return JSON.parse(text);
}

function toRecords(value: unknown): Record<string, unknown>[] {
  const items = Array.isArray(value) ? value : [value];

  return items.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return item as Record<string, unknown>;
    }

    return { value: item };
  });
}

export const jsonCleanerTool: ToolModule = {
  meta: {
    id: "json-cleaner",
    name: "Nettoyeur JSON",
    description: "Nettoie, renomme et reformate un JSON existant.",
    kind: "processor",
    inputExtensions: ["json"],
    outputModes: ["canonical", "rag", "jsonl"]
  },
  defaultConfig: {
    outputMode: "canonical",
    removeEmptyFields: true,
    normalizeWhitespace: true,
    fixEncoding: true,
    stripHtml: true,
    stripControlChars: true,
    removeBase64Images: true,
    redactSensitive: true,
    redactSecrets: true,
    redactCertificates: true,
    redactIps: true,
    redactInternalPaths: true
  },
  async run(input, config) {
    const source = parseInputJson(input.json, input.text);
    const records = toRecords(source);
    let encodingFixCount = 0;
    let removedBase64Images = 0;
    const redactionCounts = cloneEmptyRedactionCounts();
    const redactionFindings: RedactionFinding[] = [];
    const cleanedRecords = records.map((record) => {
      const result = transformRecord(record, config);
      encodingFixCount += result.encodingFixCount;
      removedBase64Images += result.removedBase64Images;
      mergeRedactionCounts(redactionCounts, result.redactionCounts);
      redactionFindings.push(...result.redactionFindings);
      return result.record;
    });
    const sourceFile = input.files?.[0]?.name ?? "input.json";
    const warnings: string[] = [];

    if (cleanedRecords.length === 0) {
      warnings.push("Le JSON ne contient aucun objet exploitable.");
    }

    if (config.outputMode === "rag" || config.outputMode === "jsonl") {
      const documents = cleanedRecords.map((record, index) =>
        recordToRagDocument(record, {
          sourceFile,
          sourceType: "json",
          toolId: jsonCleanerTool.meta.id,
          rowNumber: index + 1
        })
      );
      const text = config.outputMode === "jsonl" ? documentsToJsonl(documents) : undefined;

      return {
        documents,
        text,
        diagnostics: createDiagnostics({
          inputFiles: [sourceFile],
          rowCount: cleanedRecords.length,
          documents,
          encodingFixCount,
          redactionCounts,
          redactionFindings,
          removedBase64Images,
          warnings
        })
      };
    }

    return {
      data: cleanedRecords,
      diagnostics: createDiagnostics({
        inputFiles: [sourceFile],
        rowCount: cleanedRecords.length,
        data: cleanedRecords,
        encodingFixCount,
        redactionCounts,
        redactionFindings,
        removedBase64Images,
        warnings
      })
    };
  }
};
