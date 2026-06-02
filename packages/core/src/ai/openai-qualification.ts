import OpenAI from "openai";

export type QualificationLevel = "N0" | "N1" | "N2" | "UNKNOWN";

export interface OpenAIQualification {
  id: string;
  level: QualificationLevel;
  tags: string[];
  summary: string;
}

export interface OpenAIQualificationInput {
  id: string;
  title: string;
  categorie: string;
  content: string;
}

export interface OpenAIQualificationOptions {
  concurrency?: number;
  maxRetries?: number;
  contentField?: string;
  titleField?: string;
  categoryField?: string;
  promptId?: string;
  promptVersion?: string;
  retryDelayMs?: number;
  client?: {
    responses: {
      create(request: unknown): Promise<unknown>;
    };
  };
  createResponse?: (request: unknown, item: OpenAIQualificationInput) => Promise<unknown>;
}

export interface OpenAIQualificationBatchResult {
  qualifications: OpenAIQualification[];
  warnings: string[];
  errors: string[];
  qualifiedItems: number;
  failedItems: number;
  durationMs: number;
}

const validLevels = new Set<QualificationLevel>(["N0", "N1", "N2", "UNKNOWN"]);

function toText(value: unknown): string {
  if (value === null || value === undefined) {
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

function normalizeInteger(value: number | undefined, defaultValue: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, "[SECRET_REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [SECRET_REDACTED]")
    .slice(0, 240);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function buildQualificationInput(
  item: Record<string, unknown>,
  options: OpenAIQualificationOptions = {}
): OpenAIQualificationInput {
  const contentField = options.contentField ?? "body_markdown";
  const titleField = options.titleField ?? "title";
  const categoryField = options.categoryField ?? "categorie";
  const content = item[contentField] ?? item.body_markdown ?? item.content ?? "";

  return {
    id: toText(item.id),
    title: toText(item[titleField] ?? item.title),
    categorie: toText(item[categoryField] ?? item.categorie),
    content: toText(content)
  };
}

function buildOpenAIRequest(item: OpenAIQualificationInput, options: OpenAIQualificationOptions): unknown {
  const promptId = options.promptId ?? process.env.OPENAI_QUALIFICATION_PROMPT_ID;
  const promptVersion = options.promptVersion ?? process.env.OPENAI_QUALIFICATION_PROMPT_VERSION;

  if (!promptId) {
    throw new Error("OPENAI_QUALIFICATION_PROMPT_ID is required.");
  }

  return {
    prompt: {
      id: promptId,
      ...(promptVersion ? { version: promptVersion } : {})
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(item)
          }
        ]
      }
    ]
  };
}

function createResponseCaller(options: OpenAIQualificationOptions) {
  if (options.createResponse) {
    return options.createResponse;
  }

  if (options.client) {
    return (request: unknown) => options.client!.responses.create(request);
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const openai = new OpenAI({ apiKey });

  return (request: unknown) => openai.responses.create(request as never);
}

export function extractResponseText(response: unknown): string {
  if (response && typeof response === "object" && "output_text" in response) {
    const outputText = (response as { output_text?: unknown }).output_text;

    if (typeof outputText === "string" && outputText.trim()) {
      return outputText;
    }
  }

  const output = response && typeof response === "object" ? (response as { output?: unknown }).output : undefined;
  const texts: string[] = [];

  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const content = (item as { content?: unknown }).content;

      if (!Array.isArray(content)) {
        continue;
      }

      for (const part of content) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const maybeText = (part as { text?: unknown }).text;

        if (typeof maybeText === "string") {
          texts.push(maybeText);
        }
      }
    }
  }

  return texts.join("\n").trim();
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("OpenAI response did not contain text.");
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }

    throw new Error("OpenAI response did not contain valid JSON.");
  }
}

export function normalizeQualification(value: unknown, fallbackId: string): OpenAIQualification {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rawTags = Array.isArray(record.tags) ? record.tags : [];
  const tags = Array.from(
    new Set(
      rawTags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 2);
  const level = typeof record.level === "string" && validLevels.has(record.level as QualificationLevel)
    ? (record.level as QualificationLevel)
    : "UNKNOWN";

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : fallbackId,
    level,
    tags,
    summary: typeof record.summary === "string" ? record.summary : ""
  };
}

export async function qualifyItemWithOpenAI(
  item: Record<string, unknown>,
  options: OpenAIQualificationOptions = {}
): Promise<OpenAIQualification> {
  const input = buildQualificationInput(item, options);
  const request = buildOpenAIRequest(input, options);
  const createResponse = createResponseCaller(options);
  const response = await createResponse(request, input);
  const text = extractResponseText(response);
  const parsed = parseJsonText(text);

  return normalizeQualification(parsed, input.id);
}

function fallbackQualification(item: Record<string, unknown>, options: OpenAIQualificationOptions): OpenAIQualification {
  return {
    id: buildQualificationInput(item, options).id,
    level: "UNKNOWN",
    tags: [],
    summary: ""
  };
}

async function qualifyWithRetry(
  item: Record<string, unknown>,
  options: OpenAIQualificationOptions,
  maxRetries: number,
  retryDelayMs: number
): Promise<{ qualification: OpenAIQualification; failed: boolean; error?: string }> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return {
        qualification: await qualifyItemWithOpenAI(item, options),
        failed: false
      };
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        await delay(retryDelayMs * 2 ** attempt);
      }
    }
  }

  return {
    qualification: fallbackQualification(item, options),
    failed: true,
    error: sanitizeError(lastError)
  };
}

export async function qualifyItemsWithOpenAI(
  items: Record<string, unknown>[],
  options: OpenAIQualificationOptions = {}
): Promise<OpenAIQualificationBatchResult> {
  const startedAt = Date.now();
  const concurrency = normalizeInteger(options.concurrency, 5, 1, 20);
  const maxRetries = normalizeInteger(options.maxRetries, 2, 0, 5);
  const retryDelayMs = normalizeInteger(options.retryDelayMs, 400, 0, 30_000);
  const sharedOptions: OpenAIQualificationOptions = {
    ...options,
    createResponse: createResponseCaller(options)
  };
  const qualifications = new Array<OpenAIQualification>(items.length);
  const warnings: string[] = [];
  const errors: string[] = [];
  let nextIndex = 0;
  let failedItems = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const item = items[currentIndex]!;
      const result = await qualifyWithRetry(item, sharedOptions, maxRetries, retryDelayMs);
      qualifications[currentIndex] = result.qualification;

      if (result.failed) {
        failedItems += 1;
        const itemId = result.qualification.id || `item_${currentIndex + 1}`;
        const warning = `Item ${itemId}: qualification OpenAI echouee. ${result.error ?? ""}`.trim();
        warnings.push(warning);
        errors.push(warning);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

  return {
    qualifications,
    warnings,
    errors,
    failedItems,
    qualifiedItems: items.length - failedItems,
    durationMs: Date.now() - startedAt
  };
}

export function mergeQualifications(
  items: Record<string, unknown>[],
  qualifications: OpenAIQualification[],
  options: { addFallback?: boolean } = {}
): Record<string, unknown>[] {
  const byId = new Map(qualifications.map((qualification) => [qualification.id, qualification]));

  return items.map((item) => {
    const itemId = toText(item.id);
    const qualification =
      byId.get(itemId) ?? (options.addFallback ? { id: itemId, level: "UNKNOWN" as const, tags: [], summary: "" } : undefined);

    if (!qualification) {
      return item;
    }

    return {
      ...item,
      level: qualification.level,
      tags: qualification.tags,
      summary: qualification.summary
    };
  });
}
