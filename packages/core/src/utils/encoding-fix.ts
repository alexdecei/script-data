const cp1252ReverseMap = new Map<string, number>([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f]
]);

const mojibakePattern = /(?:Ã.|Â.|â[\u0080-\u00ff€œžŸŠŒŽš™“”‘’•–—]|\uFFFD)/g;

function charToWindows1252Byte(char: string): number {
  const mapped = cp1252ReverseMap.get(char);

  if (mapped !== undefined) {
    return mapped;
  }

  return char.charCodeAt(0) & 0xff;
}

function decodeWindows1252AsUtf8(value: string): string {
  const bytes = Uint8Array.from([...value], charToWindows1252Byte);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function mojibakeScore(value: string): number {
  const matches = value.match(mojibakePattern)?.length ?? 0;
  const replacementChars = (value.match(/\uFFFD/g)?.length ?? 0) * 5;

  return matches + replacementChars;
}

export interface EncodingFixResult {
  text: string;
  corrections: number;
}

export function fixEncoding(value: string): EncodingFixResult {
  let current = value;
  let corrections = 0;

  for (let index = 0; index < 3; index += 1) {
    if (!mojibakePattern.test(current)) {
      mojibakePattern.lastIndex = 0;
      break;
    }

    mojibakePattern.lastIndex = 0;
    const candidate = decodeWindows1252AsUtf8(current).replace(/\u00c2/g, "");

    if (candidate === current || mojibakeScore(candidate) > mojibakeScore(current)) {
      break;
    }

    corrections += Math.max(1, mojibakeScore(current) - mojibakeScore(candidate));
    current = candidate;
  }

  return {
    text: current,
    corrections: current === value ? 0 : corrections
  };
}
