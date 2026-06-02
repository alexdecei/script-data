import type { RedactionFinding, ToolInputFile, ToolModule } from "../types.js";
import { toUint8Array } from "../utils/binary.js";
import { createDiagnostics } from "../utils/diagnostics.js";
import { normalizeKeys } from "../utils/normalize-key.js";
import { cloneEmptyRedactionCounts, mergeRedactionCounts } from "../utils/redact-sensitive.js";
import {
  documentsToJsonl,
  recordToRagDocument,
  transformRecord
} from "../utils/record-transform.js";

function requireInputFile(files: ToolInputFile[] | undefined): ToolInputFile {
  const [file] = files ?? [];

  if (!file) {
    throw new Error("CSV/XLSX converter expects one input file.");
  }

  return file;
}

function isEmptyCell(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every(isEmptyCell);
}

async function readFirstWorksheet(file: ToolInputFile): Promise<unknown[][]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(toUint8Array(file.buffer), {
    type: "array",
    cellDates: true,
    raw: true
  });
  const [sheetName] = workbook.SheetNames;

  if (!sheetName) {
    throw new Error(`No worksheet found in ${file.name}.`);
  }

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Cannot read worksheet ${sheetName}.`);
  }

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: ""
  }) as unknown[][];
}

function rowsToRecords(rows: unknown[][]): Record<string, unknown>[] {
  const [headers = [], ...bodyRows] = rows;
  const width = Math.max(headers.length, ...bodyRows.map((row) => row.length), 0);
  const normalizedHeaders = normalizeKeys(
    Array.from({ length: width }, (_, index) => headers[index] ?? `field_${index + 1}`)
  );

  return bodyRows.filter((row) => !isEmptyRow(row)).map((row) => {
    const record: Record<string, unknown> = {};

    for (let index = 0; index < width; index += 1) {
      record[normalizedHeaders[index] ?? `field_${index + 1}`] = row[index] ?? "";
    }

    return record;
  });
}

export const csvXlsxToJsonTool: ToolModule = {
  meta: {
    id: "csv-xlsx-to-json",
    name: "CSV/XLSX vers JSON",
    description: "Convertit une table en JSON canonique ou documents RAG.",
    kind: "converter",
    inputExtensions: ["csv", "xlsx", "xls"],
    outputModes: ["canonical", "rag", "jsonl"]
  },
  defaultConfig: {
    outputMode: "canonical",
    removeEmptyFields: true,
    normalizeWhitespace: true,
    fixEncoding: true,
    stripHtml: false,
    stripControlChars: true,
    removeBase64Images: true,
    redactSensitive: true,
    redactSecrets: true,
    redactCertificates: true,
    redactIps: true,
    redactInternalPaths: true
  },
  async run(input, config) {
    const file = requireInputFile(input.files);
    const rows = await readFirstWorksheet(file);
    const records = rowsToRecords(rows);
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
    const warnings: string[] = [];

    if (cleanedRecords.length === 0) {
      warnings.push("Aucune ligne de donnees detectee apres les en-tetes.");
    }

    if (config.outputMode === "rag" || config.outputMode === "jsonl") {
      const documents = cleanedRecords.map((record, index) =>
        recordToRagDocument(record, {
          sourceFile: file.name,
          sourceType: file.extension,
          toolId: csvXlsxToJsonTool.meta.id,
          rowNumber: index + 1
        })
      );
      const text = config.outputMode === "jsonl" ? documentsToJsonl(documents) : undefined;

      return {
        documents,
        text,
        diagnostics: createDiagnostics({
          inputFiles: [file.name],
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
        inputFiles: [file.name],
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
