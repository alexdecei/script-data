import { decodeHtmlEntities, normalizeWhitespace } from "./text-cleanup.js";

function getAttribute(value: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return value.match(pattern)?.[1];
}

function stripRemainingTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function cleanInlineText(value: string): string {
  return decodeHtmlEntities(stripRemainingTags(value))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cleanLinkLabel(value: string): string {
  return cleanInlineText(value)
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/^[\s\u002d\u2013\u2014\u2022\u00b7|>]+/gu, "")
    .replace(/^[\s\-–—•·|>]+/g, "")
    .trim();
}

export function htmlToMarkdown(html: string): string {
  let markdown = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, code: string) => {
      const cleanCode = decodeHtmlEntities(stripRemainingTags(code)).trim();
      return cleanCode ? `\n\n\`\`\`\n${cleanCode}\n\`\`\`\n\n` : "\n\n";
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_match, code: string) => {
      const cleanCode = cleanInlineText(code);
      return cleanCode ? `\`${cleanCode}\`` : "";
    })
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_match, text: string) => `\n\n# ${cleanInlineText(text)}\n\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_match, text: string) => `\n\n## ${cleanInlineText(text)}\n\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_match, text: string) => `\n\n### ${cleanInlineText(text)}\n\n`)
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match: string, attrs: string, text: string) => {
      const label = cleanLinkLabel(text);
      const href = getAttribute(attrs, "href");

      if (!label) {
        return "";
      }

      return href ? `[${label}](${href})` : label || match;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, text: string) => `**${cleanInlineText(text)}**`)
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, text: string) => `_${cleanInlineText(text)}_`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, text: string) => `\n- ${cleanInlineText(text)}`)
    .replace(/<\/?(ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr)>/gi, "\n\n")
    .replace(/<(p|div|section|article|span|table|tbody|thead|tr|td|th)\b[^>]*>/gi, "");

  markdown = stripRemainingTags(markdown);
  markdown = decodeHtmlEntities(markdown)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n-\s+/g, "\n- ")
    .replace(/\n{3,}/g, "\n\n");

  return normalizeWhitespace(markdown);
}
