export function normalizeKey(key: unknown, fallback = "field"): string {
  const source = String(key ?? "").trim();
  const normalized = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");

  return normalized || fallback;
}

export function normalizeKeys(keys: unknown[]): string[] {
  const counts = new Map<string, number>();

  return keys.map((key, index) => {
    const baseKey = normalizeKey(key, `field_${index + 1}`);
    const previousCount = counts.get(baseKey) ?? 0;
    counts.set(baseKey, previousCount + 1);

    return previousCount === 0 ? baseKey : `${baseKey}_${previousCount}`;
  });
}
