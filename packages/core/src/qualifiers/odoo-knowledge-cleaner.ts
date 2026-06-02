import type {
  RagDocument,
  RedactionFinding,
  ToolConfig,
  ToolInput,
  ToolInputFile,
  ToolModule
} from "../types.js";
import { toUint8Array } from "../utils/binary.js";
import { removeBase64Images } from "../utils/base64-images.js";
import { createDiagnostics } from "../utils/diagnostics.js";
import { fixEncoding } from "../utils/encoding-fix.js";
import { htmlToMarkdown } from "../utils/html-to-markdown.js";
import { cloneEmptyRedactionCounts, mergeRedactionCounts, redactSensitiveText } from "../utils/redact-sensitive.js";
import { cleanForRag, normalizeWhitespace, stripControlChars } from "../utils/text-cleanup.js";

interface OdooArticle {
  id?: string | number;
  title: string;
  categorie?: string;
  url?: string;
  created_at?: string;
  updated_at?: string;
  body_markdown: string;
  quality_flags?: {
    is_menu_page?: boolean;
  };
}

interface MenuMetrics {
  isMenuPage: boolean;
  internalKnowledgeLinks: number;
  nonEmptyLineCount: number;
  linkOnlyLineCount: number;
  linkOnlyLineRatio: number;
  narrativeParagraphCount: number;
  textOutsideLinksLength: number;
}

interface NormalizeArticleResult {
  article?: OdooArticle;
  bodyText?: string;
  menuMetrics?: MenuMetrics;
  encodingFixCount: number;
  removedBase64Images: number;
  redactionFindings: RedactionFinding[];
  redactionCounts: ReturnType<typeof cloneEmptyRedactionCounts>;
  warnings: string[];
  excludedInactive: boolean;
  excludedEmpty: boolean;
}

const excelEpochMs = Date.UTC(1899, 11, 30);

function readTextInput(input: ToolInput): string {
  if (input.text) {
    return input.text;
  }

  const [file] = input.files ?? [];

  if (!file) {
    throw new Error("Odoo Knowledge cleaner expects a JSON input file.");
  }

  return new TextDecoder("utf-8").decode(toUint8Array(file.buffer));
}

function inputFileName(files: ToolInputFile[] | undefined): string {
  return files?.[0]?.name ?? "odoo-knowledge.json";
}

function getValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function cleanTextValue(
  value: unknown,
  config: ToolConfig,
  fieldPath: string
): {
  text: string;
  corrections: number;
  redactionCounts: ReturnType<typeof cloneEmptyRedactionCounts>;
  redactionFindings: RedactionFinding[];
} {
  const raw = value === null || value === undefined ? "" : String(value);
  const fixed = config.fixEncoding === false ? { text: raw, corrections: 0 } : fixEncoding(raw);
  const cleaned = cleanForRag(fixed.text, {
    normalizeWhitespace: config.normalizeWhitespace,
    stripControlChars: config.stripControlChars
  });
  const redacted = redactSensitiveText(cleaned, config, fieldPath);

  return {
    text: redacted.text,
    corrections: fixed.corrections,
    redactionCounts: redacted.counts,
    redactionFindings: redacted.findings
  };
}

function parseActive(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return ["true", "1", "yes", "oui", "vrai"].includes(value.trim().toLowerCase());
  }

  return true;
}

function normalizeCategory(
  value: unknown,
  config: ToolConfig
): {
  text: string;
  corrections: number;
  redactionCounts: ReturnType<typeof cloneEmptyRedactionCounts>;
  redactionFindings: RedactionFinding[];
} {
  const cleaned = cleanTextValue(value, config, "article_parent");
  const text = normalizeWhitespace(
    stripControlChars(cleaned.text)
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[^\p{L}\p{N}\s'/&().,-]/gu, " ")
      .replace(/^[\s\u002d\u2013\u2014\u2022\u00b7|>]+/gu, "")
      .replace(/^[\s\-–—•·|>]+/g, "")
  );

  return {
    text,
    corrections: cleaned.corrections,
    redactionCounts: cleaned.redactionCounts,
    redactionFindings: cleaned.redactionFindings
  };
}

function parseDateValue(value: unknown): { iso?: string; raw?: unknown } {
  if (value === null || value === undefined || value === "") {
    return {};
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 20000 && value < 80000) {
      return { iso: new Date(excelEpochMs + value * 86_400_000).toISOString() };
    }

    if (value > 1_000_000_000_000 && value < 4_102_444_800_000) {
      return { iso: new Date(value).toISOString() };
    }

    if (value > 1_000_000_000 && value < 4_102_444_800) {
      return { iso: new Date(value * 1000).toISOString() };
    }
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);

    if (trimmed && Number.isFinite(numeric)) {
      return parseDateValue(numeric);
    }

    const timestamp = Date.parse(trimmed);

    if (Number.isFinite(timestamp)) {
      return { iso: new Date(timestamp).toISOString() };
    }
  }

  return { raw: value };
}

function markdownToPlainText(markdown: string): string {
  return normalizeWhitespace(
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_#>`-]+/g, " ")
  );
}

function isMostlyMarkdownLinkLine(line: string): boolean {
  const cleaned = line.trim().replace(/^[-*+]\s+/, "");

  if (!cleaned) {
    return false;
  }

  const withoutLinks = cleaned.replace(/\[[^\]]+\]\([^)]+\)/g, "").replace(/[,\s|:;.-]/g, "");
  const linkTextLength = (cleaned.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).join("").length;

  return linkTextLength > 0 && (withoutLinks.length === 0 || linkTextLength / cleaned.length >= 0.7);
}

function countNarrativeParagraphs(markdown: string): number {
  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => {
      if (!paragraph) {
        return false;
      }

      if (/^#{1,3}\s+/.test(paragraph)) {
        return false;
      }

      if (paragraph.includes("[Image") && paragraph.includes("contenu non extrait]")) {
        return false;
      }

      if (paragraph.includes("[Image — contenu non extrait]")) {
        return false;
      }

      const lines = paragraph.split(/\n/).filter((line) => line.trim());

      if (lines.length > 0 && lines.every(isMostlyMarkdownLinkLine)) {
        return false;
      }

      const withoutLinks = normalizeWhitespace(paragraph.replace(/\[[^\]]+\]\([^)]+\)/g, " "));
      return withoutLinks.length >= 40;
    }).length;
}

function detectMenuPage(markdown: string): MenuMetrics {
  const lines = markdown.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const internalKnowledgeLinks = markdown.match(/\]\(\/knowledge\/article\/[^)]+\)/g)?.length ?? 0;
  const linkOnlyLineCount = lines.filter(isMostlyMarkdownLinkLine).length;
  const linkOnlyLineRatio = lines.length > 0 ? linkOnlyLineCount / lines.length : 0;
  const textOutsideLinks = normalizeWhitespace(
    markdown
      .replace(/\[[^\]]+\]\(\/knowledge\/article\/[^)]+\)/g, " ")
      .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
      .replace(/^#{1,3}\s+.*$/gm, " ")
      .replace(/\[Image[^\]]*contenu non extrait\]/g, " ")
      .replace(/\[Image — contenu non extrait\]/g, " ")
  );
  const narrativeParagraphCount = countNarrativeParagraphs(markdown);
  const textOutsideLinksLength = textOutsideLinks.length;
  const isMenuPage =
    (internalKnowledgeLinks >= 5 && textOutsideLinksLength < 300) ||
    (linkOnlyLineRatio >= 0.7 && narrativeParagraphCount < 3);

  return {
    isMenuPage,
    internalKnowledgeLinks,
    nonEmptyLineCount: lines.length,
    linkOnlyLineCount,
    linkOnlyLineRatio,
    narrativeParagraphCount,
    textOutsideLinksLength
  };
}

function normalizeBody(
  value: unknown,
  config: ToolConfig,
  fieldPath: string
): {
  markdown: string;
  text: string;
  corrections: number;
  removedBase64Images: number;
  redactionFindings: RedactionFinding[];
  redactionCounts: ReturnType<typeof cloneEmptyRedactionCounts>;
} {
  const raw = value === null || value === undefined ? "" : String(value);
  const fixed = config.fixEncoding === false ? { text: raw, corrections: 0 } : fixEncoding(raw);
  const withoutImages =
    config.removeBase64Images === false
      ? { text: fixed.text, removedBase64Images: 0 }
      : removeBase64Images(fixed.text);
  const markdown = htmlToMarkdown(withoutImages.text);
  const cleanedMarkdown = cleanForRag(markdown, {
    normalizeWhitespace: config.normalizeWhitespace,
    stripControlChars: config.stripControlChars
  });
  const redacted = redactSensitiveText(cleanedMarkdown, config, fieldPath);
  const text = markdownToPlainText(redacted.text);

  return {
    markdown: redacted.text,
    text,
    corrections: fixed.corrections,
    removedBase64Images: withoutImages.removedBase64Images,
    redactionFindings: redacted.findings,
    redactionCounts: redacted.counts
  };
}

function normalizeArticle(
  source: Record<string, unknown>,
  index: number,
  config: ToolConfig
): NormalizeArticleResult {
  let encodingFixCount = 0;
  const redactionCounts = cloneEmptyRedactionCounts();
  const redactionFindings: RedactionFinding[] = [];
  const warnings: string[] = [];
  const minBodyLength = config.minBodyLength ?? 100;
  const active = parseActive(getValue(source, ["actif", "active"]));

  if (!active && !config.includeInactive) {
    return {
      encodingFixCount,
      removedBase64Images: 0,
      redactionCounts,
      redactionFindings,
      warnings,
      excludedInactive: true,
      excludedEmpty: false
    };
  }

  const title = cleanTextValue(getValue(source, ["titre", "title", "nom_d_affichage", "display_name"]), config, "titre");
  const displayName = cleanTextValue(getValue(source, ["nom_d_affichage", "display_name"]), config, "nom_d_affichage");
  const category = normalizeCategory(getValue(source, ["article_parent", "categorie", "category"]), config);
  const url = cleanTextValue(getValue(source, ["url_de_l_article", "url"]), config, "url_de_l_article");
  const body = normalizeBody(getValue(source, ["corps", "body", "html"]), config, `article_${index + 1}.corps`);
  const menuMetrics = detectMenuPage(body.markdown);

  encodingFixCount += title.corrections + displayName.corrections + category.corrections + url.corrections + body.corrections;
  mergeRedactionCounts(redactionCounts, title.redactionCounts);
  mergeRedactionCounts(redactionCounts, displayName.redactionCounts);
  mergeRedactionCounts(redactionCounts, category.redactionCounts);
  mergeRedactionCounts(redactionCounts, url.redactionCounts);
  mergeRedactionCounts(redactionCounts, body.redactionCounts);
  redactionFindings.push(...title.redactionFindings, ...displayName.redactionFindings, ...category.redactionFindings, ...url.redactionFindings);
  redactionFindings.push(...body.redactionFindings);

  if (body.text.trim().length < minBodyLength) {
    return {
      encodingFixCount,
      bodyText: body.text,
      menuMetrics,
      removedBase64Images: body.removedBase64Images,
      redactionCounts,
      redactionFindings,
      warnings,
      excludedInactive: false,
      excludedEmpty: true
    };
  }

  const createdAt = parseDateValue(getValue(source, ["cra_a_le", "cree_le", "created_at", "create_date"]));
  const updatedAt = parseDateValue(getValue(source, ["mis_a_jour_le", "updated_at", "write_date"]));

  if (createdAt.raw !== undefined) {
    warnings.push(`Article ${index + 1}: date de creation non convertie.`);
  }

  if (updatedAt.raw !== undefined) {
    warnings.push(`Article ${index + 1}: date de mise a jour non convertie.`);
  }

  const article: OdooArticle = {
    id: (getValue(source, ["id", "external_id"]) as string | number | undefined) ?? index + 1,
    title: title.text || displayName.text || `Article ${index + 1}`,
    categorie: category.text || undefined,
    url: url.text || undefined,
    created_at: createdAt.iso,
    updated_at: updatedAt.iso,
    body_markdown: body.markdown,
    ...(menuMetrics.isMenuPage ? { quality_flags: { is_menu_page: true } } : {})
  };

  return {
    article,
    bodyText: body.text,
    menuMetrics,
    encodingFixCount,
    removedBase64Images: body.removedBase64Images,
    redactionCounts,
    redactionFindings,
    warnings,
    excludedInactive: false,
    excludedEmpty: false
  };
}

function toRagDocument(article: OdooArticle, sourceFile: string): RagDocument {
  const metadata: RagDocument["metadata"] = {
    source_file: sourceFile,
    source_type: "json",
    tool: odooKnowledgeCleanerTool.meta.id,
    article_id: article.id ?? null,
    title: article.title,
    categorie: article.categorie ?? null,
    url: article.url ?? null,
    created_at: article.created_at ?? null,
    updated_at: article.updated_at ?? null
  };

  if (article.quality_flags?.is_menu_page) {
    metadata["quality_flags.is_menu_page"] = true;
  }

  const parts = [
    article.body_markdown.trim().startsWith(`# ${article.title}`) ? "" : `# ${article.title}`,
    article.categorie ? `Categorie: ${article.categorie}` : "",
    article.url ? `URL: ${article.url}` : "",
    article.body_markdown
  ].filter(Boolean);

  return {
    metadata,
    content: parts.join("\n\n")
  };
}

export const odooKnowledgeCleanerTool: ToolModule = {
  meta: {
    id: "odoo-knowledge-cleaner",
    name: "Odoo Knowledge Cleaner",
    description: "Nettoie un export JSON Odoo Knowledge pour canonical ou RAG.",
    kind: "qualifier",
    inputExtensions: ["json"],
    outputModes: ["canonical", "rag"]
  },
  defaultConfig: {
    outputMode: "canonical",
    normalizeWhitespace: true,
    fixEncoding: true,
    stripHtml: false,
    stripControlChars: true,
    removeBase64Images: true,
    redactSensitive: true,
    redactSecrets: true,
    redactCertificates: true,
    redactIps: true,
    redactInternalPaths: true,
    includeInactive: false,
    includeMenuPages: false,
    includeMenuPagesInCanonical: false,
    minBodyLength: 100
  },
  async run(input, config) {
    const sourceFile = inputFileName(input.files);
    const raw = input.json ?? JSON.parse(readTextInput(input));

    if (!Array.isArray(raw)) {
      throw new Error("Odoo Knowledge cleaner expects a JSON array of articles.");
    }

    let encodingFixCount = 0;
    let removedBase64Images = 0;
    let excludedInactiveArticles = 0;
    let excludedEmptyArticles = 0;
    let excludedMenuPages = 0;
    let detectedMenuPages = 0;
    let articlesWithMostlyLinks = 0;
    let totalInternalKnowledgeLinks = 0;
    let menuEvaluatedArticles = 0;
    const redactionCounts = cloneEmptyRedactionCounts();
    const redactionFindings: RedactionFinding[] = [];
    const warnings: string[] = [];
    const articles: OdooArticle[] = [];

    raw.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        warnings.push(`Element ${index + 1}: article ignore car ce n'est pas un objet.`);
        return;
      }

      const result = normalizeArticle(item as Record<string, unknown>, index, config);
      encodingFixCount += result.encodingFixCount;
      removedBase64Images += result.removedBase64Images;
      excludedInactiveArticles += result.excludedInactive ? 1 : 0;
      excludedEmptyArticles += result.excludedEmpty ? 1 : 0;
      mergeRedactionCounts(redactionCounts, result.redactionCounts);
      redactionFindings.push(...result.redactionFindings);
      warnings.push(...result.warnings);

      if (result.article) {
        const menuMetrics = result.menuMetrics;

        if (menuMetrics) {
          menuEvaluatedArticles += 1;
          totalInternalKnowledgeLinks += menuMetrics.internalKnowledgeLinks;
          detectedMenuPages += menuMetrics.isMenuPage ? 1 : 0;
          articlesWithMostlyLinks += menuMetrics.linkOnlyLineRatio >= 0.7 ? 1 : 0;
        }

        const includeMenuPage =
          config.outputMode === "rag"
            ? config.includeMenuPages === true
            : config.includeMenuPagesInCanonical === true;

        if (menuMetrics?.isMenuPage && !includeMenuPage) {
          excludedMenuPages += 1;
          return;
        }

        articles.push(result.article);
      }
    });
    const averageInternalLinksPerArticle =
      menuEvaluatedArticles > 0
        ? Number((totalInternalKnowledgeLinks / menuEvaluatedArticles).toFixed(2))
        : 0;

    if (config.outputMode === "rag") {
      const documents = articles.map((article) => toRagDocument(article, sourceFile));

      return {
        documents,
        diagnostics: createDiagnostics({
          inputFiles: [sourceFile],
          rowCount: raw.length,
          documents,
          encodingFixCount,
          redactionCounts,
          redactionFindings,
          removedBase64Images,
          excludedEmptyArticles,
          excludedInactiveArticles,
          excludedMenuPages,
          detectedMenuPages,
          averageInternalLinksPerArticle,
          articlesWithMostlyLinks,
          exportedArticles: documents.length,
          warnings
        })
      };
    }

    return {
      data: articles,
      diagnostics: createDiagnostics({
        inputFiles: [sourceFile],
        rowCount: raw.length,
        data: articles,
        encodingFixCount,
        redactionCounts,
        redactionFindings,
        removedBase64Images,
        excludedEmptyArticles,
        excludedInactiveArticles,
        excludedMenuPages,
        detectedMenuPages,
        averageInternalLinksPerArticle,
        articlesWithMostlyLinks,
        exportedArticles: articles.length,
        warnings
      })
    };
  }
};
