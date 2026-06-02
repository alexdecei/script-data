import type { RedactionCounts, RedactionFinding, RedactionType, ToolConfig } from "../types.js";

export const emptyRedactionCounts: RedactionCounts = {
  secret: 0,
  certificate: 0,
  ip: 0,
  internalPath: 0
};

export interface RedactionResult {
  text: string;
  counts: RedactionCounts;
  findings: RedactionFinding[];
}

function addCount(counts: RedactionCounts, key: RedactionType, amount = 1): void {
  counts[key] += amount;
}

function shouldRedact(config: ToolConfig, key: RedactionType): boolean {
  if (config.redactSensitive === false) {
    return false;
  }

  if (key === "secret") {
    return config.redactSecrets !== false;
  }

  if (key === "certificate") {
    return config.redactCertificates !== false;
  }

  if (key === "ip") {
    return config.redactIps !== false;
  }

  return config.redactInternalPaths !== false;
}

function replaceAndCount(
  text: string,
  pattern: RegExp,
  replacement: string | ((...args: string[]) => string),
  counts: RedactionCounts,
  findings: RedactionFinding[],
  key: RedactionType,
  placeholder: string,
  fieldPath?: string
): string {
  return text.replace(pattern, (...args: string[]) => {
    const match = args[0] ?? "";
    addCount(counts, key);
    findings.push({
      type: key,
      fieldPath,
      placeholder,
      preview: match
    });
    return typeof replacement === "string" ? replacement : replacement(...args);
  });
}

export function mergeRedactionCounts(target: RedactionCounts, source: RedactionCounts): RedactionCounts {
  target.secret += source.secret;
  target.certificate += source.certificate;
  target.ip += source.ip;
  target.internalPath += source.internalPath;
  return target;
}

export function cloneEmptyRedactionCounts(): RedactionCounts {
  return { ...emptyRedactionCounts };
}

export function redactSensitiveText(value: string, config: ToolConfig, fieldPath?: string): RedactionResult {
  const counts = cloneEmptyRedactionCounts();
  const findings: RedactionFinding[] = [];
  let text = value;

  if (shouldRedact(config, "secret")) {
    text = replaceAndCount(
      text,
      /\b((?:server\.)?(?:password|passwd|pwd|token|api[_-]?key|secret|mot\s+de\s+passe)\s*[:=]\s*)(["']?)([^"',;\s][^"',;\n\r]*?)(\2)(?=\s*(?:[,;}\]\n\r]|$))/gi,
      (_match, prefix, quote) => `${prefix}${quote}[SECRET_REDACTED]${quote}`,
      counts,
      findings,
      "secret",
      "[SECRET_REDACTED]",
      fieldPath
    );
  }

  if (shouldRedact(config, "certificate")) {
    text = replaceAndCount(
      text,
      /\b[\w./\\:-]+\.(?:p12|pem|key)\b/gi,
      "[CERTIFICATE_REDACTED]",
      counts,
      findings,
      "certificate",
      "[CERTIFICATE_REDACTED]",
      fieldPath
    );
  }

  if (shouldRedact(config, "ip")) {
    text = replaceAndCount(
      text,
      /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
      "[IP_REDACTED]",
      counts,
      findings,
      "ip",
      "[IP_REDACTED]",
      fieldPath
    );
  }

  if (shouldRedact(config, "internalPath")) {
    text = replaceAndCount(
      text,
      /\\\\[A-Za-z0-9._$-]+\\[^\s"',;)]+/g,
      "[INTERNAL_PATH_REDACTED]",
      counts,
      findings,
      "internalPath",
      "[INTERNAL_PATH_REDACTED]",
      fieldPath
    );
    text = replaceAndCount(
      text,
      /\b[A-Za-z]:\\(?:srv|server|data|apps|inetpub|www|var|opt|etc|users)\\[^\s"',;)]+/gi,
      "[INTERNAL_PATH_REDACTED]",
      counts,
      findings,
      "internalPath",
      "[INTERNAL_PATH_REDACTED]",
      fieldPath
    );
    text = replaceAndCount(
      text,
      /\/(?:srv|var\/www|opt|etc)\/[^\s"',;)]+/gi,
      "[INTERNAL_PATH_REDACTED]",
      counts,
      findings,
      "internalPath",
      "[INTERNAL_PATH_REDACTED]",
      fieldPath
    );
  }

  return { text, counts, findings };
}

export function redactSensitiveFieldValue(
  key: string,
  value: unknown,
  config: ToolConfig
): { value: unknown; counts: RedactionCounts; findings: RedactionFinding[] } {
  const counts = cloneEmptyRedactionCounts();
  const findings: RedactionFinding[] = [];

  if (typeof value !== "string") {
    return { value, counts, findings };
  }

  if (
    shouldRedact(config, "secret") &&
    value !== "[SECRET_REDACTED]" &&
    /(?:^|[._-])(?:password|passwd|pwd|token|api[_-]?key|secret|mot\s*de\s*passe)(?:$|[._-])/i.test(key)
  ) {
    counts.secret += 1;
    findings.push({
      type: "secret",
      fieldPath: key,
      placeholder: "[SECRET_REDACTED]",
      preview: value
    });
    return { value: "[SECRET_REDACTED]", counts, findings };
  }

  if (
    shouldRedact(config, "certificate") &&
    value !== "[CERTIFICATE_REDACTED]" &&
    /(?:cert|certificate|keystore|truststore|private[_-]?key|pem|p12)/i.test(key)
  ) {
    counts.certificate += 1;
    findings.push({
      type: "certificate",
      fieldPath: key,
      placeholder: "[CERTIFICATE_REDACTED]",
      preview: value
    });
    return { value: "[CERTIFICATE_REDACTED]", counts, findings };
  }

  return { value, counts, findings };
}
