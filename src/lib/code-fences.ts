/**
 * Finds fenced code blocks in Markdown, inside blockquotes and list items
 * too. The chat's streaming renderer uses it to keep a fence in one block,
 * chat bubbles to leave code as written, and What's new to skip code when it
 * reads headings and list items.
 *
 * Known gaps, all rare in model output: a blockquote inside a list item
 * ("1. > ```"), a list item that starts on an empty line, a lazy line in a
 * list item, a tab-indented fence, and an unclosed fence, which runs to the
 * end of the text even after its blockquote or list item ends.
 */

export interface SourceRange {
  from: number;
  to: number;
  complete: boolean;
}

interface ContainerLine {
  content: string;
  offset: number;
  quoteDepth: number;
  listIndent: number;
}

export interface OpenContainer {
  quoteDepth: number;
  listIndent: number;
}

function stripQuotePrefix(line: string) {
  let offset = 0;
  let quoteDepth = 0;
  while (true) {
    const quote = /^[ \t]{0,3}>[ \t]?/u.exec(line.slice(offset));
    if (!quote) break;
    offset += quote[0].length;
    quoteDepth++;
  }
  return { offset, quoteDepth };
}

/**
 * The line after its blockquote markers, the indent of `item` when the line
 * sits under that list item, and a list marker of its own.
 */
export function openingContainerLine(line: string, item?: OpenContainer): ContainerLine {
  const underItem = item ? continuationContainerLine(line, item) : null;
  const quote = stripQuotePrefix(line);
  let offset = underItem?.offset ?? quote.offset;
  let listIndent = underItem?.listIndent ?? 0;
  const list = /^[ \t]{0,3}(?:[*+-]|\d{1,9}[.)])[ \t]{1,4}(?=\S|$)/u.exec(
    line.slice(offset),
  );
  if (list) {
    offset += list[0].length;
    listIndent += list[0].length;
  }
  return {
    content: line.slice(offset),
    offset,
    quoteDepth: quote.quoteDepth,
    listIndent,
  };
}

export function continuationContainerLine(
  line: string,
  container: OpenContainer,
): ContainerLine | null {
  const quote = stripQuotePrefix(line);
  if (quote.quoteDepth !== container.quoteDepth) return null;
  let offset = quote.offset;
  if (container.listIndent > 0) {
    const indent = /^[ \t]+/u.exec(line.slice(offset))?.[0].length ?? 0;
    if (indent < container.listIndent) return null;
    offset += container.listIndent;
  }
  return {
    content: line.slice(offset),
    offset,
    quoteDepth: quote.quoteDepth,
    listIndent: container.listIndent,
  };
}

interface OpenFence {
  char: "`" | "~";
  from: number;
  length: number;
  container: OpenContainer;
}

function fenceCloses(line: string, open: OpenFence): boolean {
  const logical = continuationContainerLine(line, open.container);
  const close = logical
    ? /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u.exec(logical.content)
    : null;
  return close?.[1].startsWith(open.char) === true && close[1].length >= open.length;
}

function fenceOpensAt(logical: ContainerLine, lineFrom: number): OpenFence | null {
  const start = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u.exec(logical.content);
  if (!start || (start[1].startsWith("`") && start[2].includes("`"))) return null;
  return {
    char: start[1][0] as "`" | "~",
    from: lineFrom + logical.offset + logical.content.indexOf(start[1]),
    length: start[1].length,
    container: logical,
  };
}

/**
 * Each fence, from its opening run to the end of its closing line, or to the
 * end of `source` when it is still open.
 */
export function scanFences(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let open: OpenFence | null = null;
  // The list items the scan is in, innermost last, so a fence indented under
  // one ("1.  Run:" then "    ```sh") counts. Less indented text ends them.
  const items: OpenContainer[] = [];
  let lineFrom = 0;

  while (lineFrom <= source.length) {
    const lineBreak = source.indexOf("\n", lineFrom);
    const lineTo = lineBreak < 0 ? source.length : lineBreak;
    const line = source.slice(lineFrom, lineTo).replace(/\r$/u, "");

    if (open) {
      if (fenceCloses(line, open)) {
        ranges.push({ from: open.from, to: lineTo, complete: true });
        open = null;
      }
    } else {
      while (items.length > 0 && line.trim() && !continuationContainerLine(line, items[items.length - 1])) {
        items.pop();
      }
      const logical = openingContainerLine(line, items.at(-1));
      open = fenceOpensAt(logical, lineFrom);
      if (logical.listIndent > (items.at(-1)?.listIndent ?? 0)) items.push(logical);
    }

    if (lineBreak < 0) break;
    lineFrom = lineBreak + 1;
  }

  if (open) ranges.push({ from: open.from, to: source.length, complete: false });
  return ranges;
}

export function lineInsideFence(
  fences: readonly SourceRange[],
  lineFrom: number,
  lineTo: number,
): boolean {
  return fences.some((fence) => fence.from < lineTo && fence.to >= lineFrom);
}
