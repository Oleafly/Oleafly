import {
  NFC_COMBINING_CLASSES,
  NFC_COMPOSITIONS,
  NFC_DECOMPOSITIONS,
  UNICODE_NFC_VERSION,
} from "./unicode-nfc-v17.generated";

export { UNICODE_NFC_VERSION };

const combiningClasses = pairs(NFC_COMBINING_CLASSES);
const decompositions = variableSequences(NFC_DECOMPOSITIONS);
const compositions = triples(NFC_COMPOSITIONS);

/** Unicode 17.0 UAX #15 NFC, independent of the host JavaScript runtime. */
export function normalizeNfcV17(value: string): string {
  assertWellFormedUtf16(value, "string");
  const decomposed: number[] = [];
  for (const character of value) decompose(character.codePointAt(0) as number, decomposed);
  canonicalOrder(decomposed);
  return codePointsToString(compose(decomposed));
}

export function assertWellFormedUtf16(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new Error(`${label} contains an unpaired UTF-16 surrogate`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error(`${label} contains an unpaired UTF-16 surrogate`);
    }
  }
}

export function utf8Length(value: string, label: string): number {
  assertWellFormedUtf16(value, label);
  return new TextEncoder().encode(value).length;
}

function decompose(codePoint: number, output: number[]): void {
  if (codePoint >= 0xac00 && codePoint <= 0xd7a3) {
    const syllable = codePoint - 0xac00;
    const leading = 0x1100 + Math.floor(syllable / 588);
    const vowel = 0x1161 + Math.floor((syllable % 588) / 28);
    const trailing = syllable % 28;
    output.push(leading, vowel);
    if (trailing !== 0) output.push(0x11a7 + trailing);
    return;
  }
  const mapped = decompositions.get(codePoint);
  if (mapped === undefined) {
    output.push(codePoint);
    return;
  }
  for (const child of mapped) decompose(child, output);
}

function canonicalOrder(codePoints: number[]): void {
  for (let index = 1; index < codePoints.length; index += 1) {
    const current = codePoints[index];
    const currentClass = combiningClasses.get(current) ?? 0;
    if (currentClass === 0) continue;
    let target = index;
    while (target > 0) {
      const previousClass = combiningClasses.get(codePoints[target - 1]) ?? 0;
      if (previousClass === 0 || previousClass <= currentClass) break;
      codePoints[target] = codePoints[target - 1];
      target -= 1;
    }
    codePoints[target] = current;
  }
}

function compose(codePoints: readonly number[]): number[] {
  if (codePoints.length === 0) return [];
  const output = [codePoints[0]];
  let starterIndex = 0;
  let starter = codePoints[0];
  let previousClass = 0;
  for (let index = 1; index < codePoints.length; index += 1) {
    const current = codePoints[index];
    const currentClass = combiningClasses.get(current) ?? 0;
    const composite = composePair(starter, current);
    if (composite !== undefined && (previousClass === 0 || previousClass < currentClass)) {
      output[starterIndex] = composite;
      starter = composite;
      continue;
    }
    if (currentClass === 0) {
      starterIndex = output.length;
      starter = current;
    }
    previousClass = currentClass;
    output.push(current);
  }
  return output;
}

function composePair(left: number, right: number): number | undefined {
  const leadingIndex = left - 0x1100;
  if (leadingIndex >= 0 && leadingIndex < 19) {
    const vowelIndex = right - 0x1161;
    if (vowelIndex >= 0 && vowelIndex < 21) {
      return 0xac00 + (leadingIndex * 21 + vowelIndex) * 28;
    }
  }
  const syllableIndex = left - 0xac00;
  if (syllableIndex >= 0 && syllableIndex < 11_172 && syllableIndex % 28 === 0) {
    const trailingIndex = right - 0x11a7;
    if (trailingIndex > 0 && trailingIndex < 28) return left + trailingIndex;
  }
  return compositions.get(`${left}:${right}`);
}

function pairs(values: readonly number[]): ReadonlyMap<number, number> {
  const result = new Map<number, number>();
  for (let index = 0; index < values.length; index += 2) {
    result.set(values[index], values[index + 1]);
  }
  return result;
}

function triples(values: readonly number[]): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (let index = 0; index < values.length; index += 3) {
    result.set(`${values[index]}:${values[index + 1]}`, values[index + 2]);
  }
  return result;
}

function variableSequences(values: readonly number[]): ReadonlyMap<number, readonly number[]> {
  const result = new Map<number, readonly number[]>();
  for (let index = 0; index < values.length;) {
    const codePoint = values[index];
    const length = values[index + 1];
    result.set(codePoint, values.slice(index + 2, index + 2 + length));
    index += 2 + length;
  }
  return result;
}

function codePointsToString(values: readonly number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < values.length; index += 4096) {
    parts.push(String.fromCodePoint(...values.slice(index, index + 4096)));
  }
  return parts.join("");
}
