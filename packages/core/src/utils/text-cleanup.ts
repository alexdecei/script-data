export function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function stripHtml(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface CleanTextOptions {
  normalizeWhitespace?: boolean;
  stripHtml?: boolean;
  stripControlChars?: boolean;
}

export function cleanForRag(value: string, options: CleanTextOptions = {}): string {
  let text = value;

  if (options.stripHtml) {
    text = stripHtml(text);
  }

  if (options.stripControlChars) {
    text = stripControlChars(text);
  }

  if (options.normalizeWhitespace !== false) {
    text = normalizeWhitespace(text);
  }

  return text;
}
