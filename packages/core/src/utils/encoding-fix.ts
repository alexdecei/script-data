const cp1252ReverseMap = new Map<string, number>([
  ["\u20ac", 0x80],
  ["\u201a", 0x82],
  ["\u0192", 0x83],
  ["\u201e", 0x84],
  ["\u2026", 0x85],
  ["\u2020", 0x86],
  ["\u2021", 0x87],
  ["\u02c6", 0x88],
  ["\u2030", 0x89],
  ["\u0160", 0x8a],
  ["\u2039", 0x8b],
  ["\u0152", 0x8c],
  ["\u017d", 0x8e],
  ["\u2018", 0x91],
  ["\u2019", 0x92],
  ["\u201c", 0x93],
  ["\u201d", 0x94],
  ["\u2022", 0x95],
  ["\u2013", 0x96],
  ["\u2014", 0x97],
  ["\u02dc", 0x98],
  ["\u2122", 0x99],
  ["\u0161", 0x9a],
  ["\u203a", 0x9b],
  ["\u0153", 0x9c],
  ["\u017e", 0x9e],
  ["\u0178", 0x9f]
]);

const mojibakePattern = /(?:Ã.|Â.|â[\u0080-\u00ff\u20ac\u201a-\u201e\u2020-\u2022\u2013-\u201d\u2122\u0160\u0152\u017d\u0161\u0153\u017e\u0178]|ð[\u0080-\u00ff]{1,3}|\uFFFD)/g;
const brokenEmojiPattern = /ð[\u0080-\u00ff]{1,3}/g;
const lingeringBrokenCharsPattern = /[\u0080-\u009f]/g;

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
  const brokenEmojis = (value.match(brokenEmojiPattern)?.length ?? 0) * 2;

  return matches + replacementChars + brokenEmojis;
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

  const withoutBrokenControls = current.replace(lingeringBrokenCharsPattern, "");

  if (withoutBrokenControls !== current) {
    corrections += current.length - withoutBrokenControls.length;
    current = withoutBrokenControls;
  }

  return {
    text: current,
    corrections: current === value ? 0 : corrections
  };
}
