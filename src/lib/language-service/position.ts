export type PositionEncoding = "utf-8" | "utf-16" | "utf-32";

export const DEFAULT_POSITION_ENCODING: PositionEncoding = "utf-16";

export interface Position {
  line: number;
  character: number;
}

interface LineSpan {
  start: number;
  contentEnd: number;
  end: number;
}

function codePointWidth(
  codePoint: number,
  codeUnitWidth: number,
  encoding: PositionEncoding,
): number {
  if (encoding === "utf-16") return codeUnitWidth;
  if (encoding === "utf-32") return 1;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function readCodePoint(text: string, offset: number) {
  const first = text.charCodeAt(offset);
  if (
    first >= 0xd800 &&
    first <= 0xdbff &&
    offset + 1 < text.length
  ) {
    const second = text.charCodeAt(offset + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return {
        codePoint: text.codePointAt(offset) ?? first,
        codeUnitWidth: 2,
      };
    }
  }
  return { codePoint: first, codeUnitWidth: 1 };
}

function buildLineSpans(text: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let start = 0;
  for (let offset = 0; offset < text.length; offset++) {
    if (text.charCodeAt(offset) !== 10) continue;
    const contentEnd =
      offset > start && text.charCodeAt(offset - 1) === 13
        ? offset - 1
        : offset;
    lines.push({ start, contentEnd, end: offset + 1 });
    start = offset + 1;
  }
  lines.push({ start, contentEnd: text.length, end: text.length });
  return lines;
}

/**
 * Reusable line index for converting LSP positions without rescanning all
 * preceding lines for every range.
 */
export class TextPositionIndex {
  readonly text: string;
  private readonly lines: LineSpan[];

  constructor(text: string) {
    this.text = text;
    this.lines = buildLineSpans(text);
  }

  get lineCount(): number {
    return this.lines.length;
  }

  positionToOffset(
    position: Position,
    encoding: PositionEncoding = DEFAULT_POSITION_ENCODING,
  ): number {
    const requestedLine = Number.isFinite(position.line)
      ? Math.trunc(position.line)
      : 0;
    const lineNumber = Math.min(
      Math.max(requestedLine, 0),
      this.lines.length - 1,
    );
    const line = this.lines[lineNumber];
    const requestedCharacter = Number.isFinite(position.character)
      ? Math.max(0, Math.trunc(position.character))
      : 0;

    let units = 0;
    let offset = line.start;
    while (offset < line.contentEnd) {
      const { codePoint, codeUnitWidth } = readCodePoint(this.text, offset);
      const width = codePointWidth(codePoint, codeUnitWidth, encoding);
      if (units + width > requestedCharacter) return offset;
      units += width;
      offset += codeUnitWidth;
      if (units === requestedCharacter) return offset;
    }
    return line.contentEnd;
  }

  offsetToPosition(
    rawOffset: number,
    encoding: PositionEncoding = DEFAULT_POSITION_ENCODING,
  ): Position {
    const offset = Number.isFinite(rawOffset)
      ? Math.min(Math.max(Math.trunc(rawOffset), 0), this.text.length)
      : 0;

    let low = 0;
    let high = this.lines.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.lines[middle].start <= offset) low = middle;
      else high = middle - 1;
    }

    const line = this.lines[low];
    const target = Math.min(offset, line.contentEnd);
    let character = 0;
    let cursor = line.start;
    while (cursor < target) {
      const { codePoint, codeUnitWidth } = readCodePoint(this.text, cursor);
      if (cursor + codeUnitWidth > target) break;
      character += codePointWidth(codePoint, codeUnitWidth, encoding);
      cursor += codeUnitWidth;
    }
    return { line: low, character };
  }
}

export function positionToOffset(
  text: string,
  position: Position,
  encoding: PositionEncoding = DEFAULT_POSITION_ENCODING,
): number {
  return new TextPositionIndex(text).positionToOffset(position, encoding);
}

export function offsetToPosition(
  text: string,
  offset: number,
  encoding: PositionEncoding = DEFAULT_POSITION_ENCODING,
): Position {
  return new TextPositionIndex(text).offsetToPosition(offset, encoding);
}
