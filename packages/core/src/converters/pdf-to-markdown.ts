import type { RagDocument, RedactionFinding, ToolInputFile, ToolModule } from "../types.js";
import { removeBase64Images } from "../utils/base64-images.js";
import { toUint8Array } from "../utils/binary.js";
import { createDiagnostics } from "../utils/diagnostics.js";
import { fixEncoding } from "../utils/encoding-fix.js";
import {
  cloneEmptyRedactionCounts,
  mergeRedactionCounts,
  redactSensitiveText
} from "../utils/redact-sensitive.js";
import { cleanForRag } from "../utils/text-cleanup.js";

function requireInputFile(files: ToolInputFile[] | undefined): ToolInputFile {
  const [file] = files ?? [];

  if (!file) {
    throw new Error("PDF converter expects one input file.");
  }

  return file;
}

function markdownTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Document PDF";
}

export const pdfToMarkdownTool: ToolModule = {
  meta: {
    id: "pdf-to-markdown",
    name: "PDF vers Markdown",
    description: "Extrait un Markdown simple page par page depuis un PDF.",
    kind: "converter",
    inputExtensions: ["pdf"],
    outputModes: ["document", "rag"]
  },
  defaultConfig: {
    outputMode: "document",
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
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const file = requireInputFile(input.files);
    const pdf = await getDocument({
      data: toUint8Array(file.buffer),
      disableWorker: true
    }).promise;
    const pageTexts: string[] = [];
    const documents: RagDocument[] = [];
    let encodingFixCount = 0;
    let removedBase64Images = 0;
    const redactionCounts = cloneEmptyRedactionCounts();
    const redactionFindings: RedactionFinding[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const rawText = textContent.items.map((item) => item.str ?? "").join(" ");
      const fixed = config.fixEncoding ? fixEncoding(rawText) : { text: rawText, corrections: 0 };
      const withoutImages =
        config.removeBase64Images === false
          ? { text: fixed.text, removedBase64Images: 0 }
          : removeBase64Images(fixed.text);
      const cleaned = cleanForRag(withoutImages.text, {
        normalizeWhitespace: config.normalizeWhitespace,
        stripControlChars: config.stripControlChars
      });
      const redacted = redactSensitiveText(cleaned, config, `page_${pageNumber}`);
      const text = redacted.text;
      encodingFixCount += fixed.corrections;
      removedBase64Images += withoutImages.removedBase64Images;
      mergeRedactionCounts(redactionCounts, redacted.counts);
      redactionFindings.push(...redacted.findings);

      pageTexts.push(`## Page ${pageNumber}\n\n${text}`);
      documents.push({
        metadata: {
          source_file: file.name,
          source_type: file.extension,
          tool: pdfToMarkdownTool.meta.id,
          page: pageNumber
        },
        content: text
      });
    }

    const markdown = `# ${markdownTitle(file.name)}\n\n${pageTexts.join("\n\n")}\n`;
    const warnings = pageTexts.length === 0 ? ["Aucune page detectee dans le PDF."] : [];

    if (config.outputMode === "rag") {
      return {
        documents,
        diagnostics: createDiagnostics({
          inputFiles: [file.name],
          documents,
          text: documents.map((document) => document.content).join("\n\n"),
          encodingFixCount,
          redactionCounts,
          redactionFindings,
          removedBase64Images,
          warnings
        })
      };
    }

    return {
      text: markdown,
      diagnostics: createDiagnostics({
        inputFiles: [file.name],
        documentCount: documents.length,
        text: markdown,
        encodingFixCount,
        redactionCounts,
        redactionFindings,
        removedBase64Images,
        warnings
      })
    };
  }
};
