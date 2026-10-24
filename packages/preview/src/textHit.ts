const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const WORD_JOINER = /[\u200C\u200D]/u;

export interface PdfWordContext {
  before: string;
  after: string;
}

export interface TextRange {
  start: number;
  end: number;
}

const CONTEXT_LENGTH = 200;

export function wordRangeInText(text: string, offset: number): TextRange | null {
  const characters = Array.from(text);
  const isWordChar = (index: number) => {
    const character = characters[index];
    if (character === undefined) return false;
    if (WORD_CHARACTER.test(character)) return true;
    return (
      WORD_JOINER.test(character) &&
      WORD_CHARACTER.test(characters[index - 1] ?? "") &&
      WORD_CHARACTER.test(characters[index + 1] ?? "")
    );
  };
  const target = Math.min(Math.max(0, offset), text.length);
  let index = 0;
  for (let unit = 0; index < characters.length; index++) {
    unit += characters[index].length;
    if (unit > target) break;
  }
  let start = index;
  let end = index;
  while (start > 0 && isWordChar(start - 1)) start--;
  while (end < characters.length && isWordChar(end)) end++;
  if (start === end) return null;
  const from = characters.slice(0, start).join("").length;
  return { start: from, end: from + characters.slice(start, end).join("").length };
}

export function closestMatchingElement<T extends Element>(
  target: EventTarget | null | undefined,
  selector: string,
): T | null {
  const closest = (target as { closest?: (value: string) => Element | null } | null)?.closest;
  return typeof closest === "function" ? (closest.call(target, selector) as T | null) : null;
}

/**
 * The index of the character under `clientX` in a text-layer span's text node,
 * measured from the browser's own layout of it.
 *
 * pdf.js lays a span's letters out in a fallback font and stretches the span to
 * the PDF run's width, so letters keep their relative widths. Treating every
 * letter as equally wide drifts by a word or more along a long run: it picked a
 * neighbouring word for about one click in 26 on real LaTeX output. Returns
 * null when nothing is laid out (tests) or the run is not left-to-right, so the
 * caller can fall back to that estimate.
 */
function hasWidth(rect: DOMRect | undefined): rect is DOMRect {
  return (rect?.width ?? 0) > 0;
}

export function measuredTextOffset(node: Text, clientX: number): number | null {
  const length = node.length;
  if (!length || typeof node.ownerDocument?.createRange !== "function") return null;
  const range = node.ownerDocument.createRange();
  const box = (index: number) => {
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    return range.getBoundingClientRect?.();
  };
  const first = box(0);
  const last = box(length - 1);
  if (!hasWidth(first) || !hasWidth(last)) return null;
  if (length > 1 && last.left <= first.left) return null;
  if (clientX < first.left || clientX > last.right) return null;
  let low = 0;
  let high = length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((box(middle)?.right ?? 0) <= clientX) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function wordRangeAtHorizontalPosition(
  text: string,
  left: number,
  width: number,
  clientX: number,
): TextRange | null {
  if (!text || width <= 0) return null;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  const offset = Math.min(text.length - 1, Math.floor(ratio * text.length));
  return wordRangeInText(text, offset);
}

function renderedText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  return node.nodeName === "BR" ? " " : "";
}

export function textAroundWord(layer: Node, target: Node, range: TextRange): PdfWordContext {
  const before: string[] = [];
  const after: string[] = [];
  let inside = "";
  let reached = false;
  const walker = (layer.ownerDocument ?? document).createTreeWalker(
    layer,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = renderedText(node);
    if (!piece) continue;
    if (target.contains(node)) {
      inside += piece;
      reached = true;
    } else {
      (reached ? after : before).push(piece);
    }
  }
  return {
    before: (before.join("") + inside.slice(0, range.start)).slice(-CONTEXT_LENGTH),
    after: (inside.slice(range.end) + after.join("")).slice(0, CONTEXT_LENGTH),
  };
}
