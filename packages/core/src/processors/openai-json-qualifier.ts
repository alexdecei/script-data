import type { ToolModule } from "../types.js";
import { createDiagnostics } from "../utils/diagnostics.js";
import {
  mergeQualifications,
  qualifyItemsWithOpenAI
} from "../ai/openai-qualification.js";

function parseInputJson(inputJson: unknown, text: string | undefined): unknown {
  if (inputJson !== undefined) {
    return inputJson;
  }

  if (!text) {
    throw new Error("OpenAI JSON qualifier expects parsed JSON or input text.");
  }

  return JSON.parse(text);
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error("OpenAI JSON qualifier expects a JSON array.");
  }

  return value.map((item, index) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return item as Record<string, unknown>;
    }

    throw new Error(`Item ${index + 1} is not a JSON object.`);
  });
}

export const openAIJsonQualifierTool: ToolModule = {
  meta: {
    id: "openai-json-qualifier",
    name: "Qualifier JSON avec OpenAI",
    description: "Enrichit un tableau JSON avec level, tags et summary via OpenAI.",
    kind: "processor",
    inputExtensions: ["json"],
    outputModes: ["canonical"]
  },
  defaultConfig: {
    outputMode: "canonical",
    enableOpenAIQualification: true,
    concurrency: 5,
    maxRetries: 2,
    contentField: "body_markdown",
    titleField: "title",
    categoryField: "categorie"
  },
  async run(input, config) {
    const sourceFile = input.files?.[0]?.name ?? "input.json";
    const records = toObjectArray(parseInputJson(input.json, input.text));
    const startedAt = Date.now();
    const warnings: string[] = [];

    if (config.enableOpenAIQualification === false) {
      warnings.push("Qualification OpenAI desactivee.");
      const durationMs = Date.now() - startedAt;

      return {
        data: records,
        diagnostics: createDiagnostics({
          inputFiles: [sourceFile],
          rowCount: records.length,
          data: records,
          totalItems: records.length,
          qualifiedItems: 0,
          failedItems: 0,
          durationMs,
          averageMsPerItem: records.length > 0 ? Math.round(durationMs / records.length) : 0,
          warnings
        })
      };
    }

    const batch = await qualifyItemsWithOpenAI(records, {
      concurrency: config.concurrency,
      maxRetries: config.maxRetries,
      contentField: config.contentField,
      titleField: config.titleField,
      categoryField: config.categoryField
    });
    const enrichedRecords = mergeQualifications(records, batch.qualifications);

    return {
      data: enrichedRecords,
      diagnostics: createDiagnostics({
        inputFiles: [sourceFile],
        rowCount: records.length,
        data: enrichedRecords,
        totalItems: records.length,
        qualifiedItems: batch.qualifiedItems,
        failedItems: batch.failedItems,
        durationMs: batch.durationMs,
        averageMsPerItem: records.length > 0 ? Math.round(batch.durationMs / records.length) : 0,
        warnings: [...warnings, ...batch.warnings],
        errors: batch.errors
      })
    };
  }
};
