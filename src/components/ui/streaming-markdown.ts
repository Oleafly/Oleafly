import { scanMathExpressions } from "@oleafly/editor/math-source";

const MAX_RICH_TAIL_LENGTH = 6_000;

export interface StreamingMarkdownBlock {
  key: string;
  source: string;
}

export interface StreamingMarkdownPartition {
  settled: StreamingMarkdownBlock[];
  tail: {
    raw: boolean;
    source: string;
  };
}

export interface StreamingMarkdownState extends StreamingMarkdownPartition {
  overflowed: boolean;
  source: string;
}

interface SourceRange {
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

interface OpenContainer {
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

function openingContainerLine(line: string): ContainerLine {
  const quote = stripQuotePrefix(line);
  let offset = quote.offset;
  let listIndent = 0;
  const list = /^[ \t]{0,3}(?:[*+-]|\d{1,9}[.)])[ \t]{1,4}(?=\S|$)/u.exec(
    line.slice(offset),
  );
  if (list) {
    offset += list[0].length;
    listIndent = list[0].length;
  }
  return {
    content: line.slice(offset),
    offset,
    quoteDepth: quote.quoteDepth,
    listIndent,
  };
}

function continuationContainerLine(
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

function scanFences(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let open: {
    char: "`" | "~";
    from: number;
    length: number;
    container: OpenContainer;
  } | null = null;
  let lineFrom = 0;

  while (lineFrom <= source.length) {
    const lineBreak = source.indexOf("\n", lineFrom);
    const lineTo = lineBreak < 0 ? source.length : lineBreak;
    const line = source.slice(lineFrom, lineTo).replace(/\r$/u, "");

    if (open) {
      const logical = continuationContainerLine(line, open.container);
      const close = logical
        ? /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u.exec(logical.content)
        : null;
      if (
        close &&
        close[1][0] === open.char &&
        close[1].length >= open.length
      ) {
        ranges.push({ from: open.from, to: lineTo, complete: true });
        open = null;
      }
    } else {
      const logical = openingContainerLine(line);
      const start = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u.exec(logical.content);
      if (
        start &&
        (start[1][0] !== "`" || !start[2].includes("`"))
      ) {
        open = {
          char: start[1][0] as "`" | "~",
          from: lineFrom + logical.offset + logical.content.indexOf(start[1]),
          length: start[1].length,
          container: logical,
        };
      }
    }

    if (lineBreak < 0) break;
    lineFrom = lineBreak + 1;
  }

  if (open) ranges.push({ from: open.from, to: source.length, complete: false });
  return ranges;
}

function scanFlowMath(source: string, fences: readonly SourceRange[]): SourceRange[] {
  const ranges: SourceRange[] = [];
  let open: {
    from: number;
    length: number;
    container: OpenContainer;
  } | null = null;
  let lineFrom = 0;

  while (lineFrom <= source.length) {
    const lineBreak = source.indexOf("\n", lineFrom);
    const lineTo = lineBreak < 0 ? source.length : lineBreak;
    const line = source.slice(lineFrom, lineTo).replace(/\r$/u, "");
    const insideFence = fences.some(
      (fence) => fence.from < lineTo && fence.to >= lineFrom,
    );

    if (!insideFence && open) {
      const logical = continuationContainerLine(line, open.container);
      const close = logical
        ? /^[ \t]{0,3}(\${2,})[ \t]*$/u.exec(logical.content)
        : null;
      if (close && close[1].length >= open.length) {
        ranges.push({ from: open.from, to: lineTo, complete: true });
        open = null;
      }
    } else if (!insideFence) {
      const logical = openingContainerLine(line);
      const start = /^[ \t]{0,3}(\${2,})([^$]*)$/u.exec(logical.content);
      if (start) {
        open = {
          from: lineFrom + logical.offset + logical.content.indexOf(start[1]),
          length: start[1].length,
          container: logical,
        };
      }
    }

    if (lineBreak < 0) break;
    lineFrom = lineBreak + 1;
  }

  if (open) ranges.push({ from: open.from, to: source.length, complete: false });
  return ranges;
}

// Reference-style Markdown resolves across the whole document: an explicit
// reference link, a footnote, or a link definition after this point could
// bind to text that settled earlier, so nothing at or past the first such
// construct may settle. Inline links, citations like [1], and task-list
// checkboxes are self-contained and do not pin.
function referencePinnedFrom(source: string) {
  const indexes = [
    /\[[^\]\n]*\]\[/gu,
    /\[\^/gu,
    /^[ \t]{0,3}\[[^\]\n]+\]:/gmu,
  ].flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match.index));
  return indexes.length > 0 ? Math.min(...indexes) : null;
}

// A block that opens a container construct (list, quote, indented code, raw
// HTML) or begins indented may be continued by what follows a blank line.
const STICKY_BLOCK = [
  /^(?:[ \t]{0,3}>|[ \t]{0,3}(?:[*+-]|\d{1,9}[.)])[ \t]+)/mu,
  /^(?:[ ]{4}|\t|[ \t]{0,3}<(?:!--|\/?[A-Za-z]|[!?]))/mu,
  /^[ \t]/u,
];

function stickyBlock(block: string) {
  return STICKY_BLOCK.some((pattern) => pattern.test(block));
}

// The line after a boundary can continue the previous construct only when it
// begins as a continuation: indented, another item or quote line, or raw HTML.
const STICKY_START = /^(?:[ \t]|>|(?:[*+-]|\d{1,9}[.)])[ \t]|<(?:!--|\/?[A-Za-z]|[!?]))/u;

function stickyStart(source: string, boundary: number) {
  const lineEnd = source.indexOf("\n", boundary);
  const line = source.slice(boundary, lineEnd < 0 ? source.length : lineEnd);
  return STICKY_START.test(line);
}

function blockBoundaries(source: string, ranges: readonly SourceRange[]) {
  const boundaries: number[] = [];
  const blankLine = /\r?\n[ \t]*\r?\n/gu;
  const pinnedFrom = referencePinnedFrom(source);
  const sortedRanges = [...ranges].sort((left, right) => left.from - right.from);
  let rangeIndex = 0;
  let segmentFrom = 0;
  let match = blankLine.exec(source);

  while (match) {
    const matchFrom = match.index;
    const boundary = match.index + match[0].length;
    if (pinnedFrom !== null && boundary > pinnedFrom) break;
    while (sortedRanges[rangeIndex]?.to <= matchFrom) rangeIndex++;
    const range = sortedRanges[rangeIndex];
    const protectedRange = Boolean(
      range && range.from < boundary && range.to > matchFrom,
    );
    // A boundary between a container block and a continuation-shaped next
    // line would split one construct (a loose list, a multi-block quote)
    // into two renders, so those blocks glue together instead.
    const glued =
      stickyBlock(source.slice(segmentFrom, matchFrom)) && stickyStart(source, boundary);
    if (!protectedRange && !glued) boundaries.push(boundary);
    segmentFrom = boundary;
    match = blankLine.exec(source);
  }
  return boundaries;
}

function settledBlocks(source: string, boundaries: readonly number[], through: number) {
  const blocks: StreamingMarkdownBlock[] = [];
  let from = 0;
  for (const to of boundaries) {
    if (to > through) break;
    blocks.push({ key: `${from}`, source: source.slice(from, to) });
    from = to;
  }
  return { blocks, from };
}

export function partitionStreamingMarkdown(source: string): StreamingMarkdownPartition {
  const fences = scanFences(source);
  const flowMath = scanFlowMath(source, fences);
  const math = scanMathExpressions(source, { format: "markdown" }).filter(
    (expression) => !flowMath.some(
      (flow) => flow.from < expression.to && flow.to > expression.from,
    ),
  );
  const completeRanges: SourceRange[] = [
    ...math
      .filter((expression) => expression.status === "complete")
      .map((expression) => ({
        from: expression.from,
        to: expression.to,
        complete: true,
      })),
    ...fences.filter((fence) => fence.complete),
    ...flowMath.filter((expression) => expression.complete),
  ];
  const unsafeFrom = [
    ...math
      .filter((expression) => expression.status === "incomplete")
      .map((expression) => expression.from),
    ...fences.filter((fence) => !fence.complete).map((fence) => fence.from),
    ...flowMath
      .filter((expression) => !expression.complete)
      .map((expression) => expression.from),
  ].reduce<number | null>(
    (earliest, from) => earliest === null ? from : Math.min(earliest, from),
    null,
  );
  const boundaries = blockBoundaries(source, completeRanges);
  const settleThrough = unsafeFrom === null
    ? source.length
    : boundaries.filter((boundary) => boundary <= unsafeFrom).at(-1) ?? 0;
  const settled = settledBlocks(source, boundaries, settleThrough);
  const tail = source.slice(settled.from);

  return {
    settled: settled.blocks,
    tail: {
      raw: unsafeFrom !== null || tail.length > MAX_RICH_TAIL_LENGTH,
      source: tail,
    },
  };
}

export function updateStreamingMarkdown(
  previous: StreamingMarkdownState | null,
  source: string,
): StreamingMarkdownState {
  if (previous?.source === source) return previous;
  if (!previous || !source.startsWith(previous.source)) {
    const partition = partitionStreamingMarkdown(source);
    return {
      source,
      overflowed: partition.tail.raw && partition.tail.source.length > MAX_RICH_TAIL_LENGTH,
      ...partition,
    };
  }
  if (previous.overflowed) {
    return {
      ...previous,
      source,
      tail: {
        raw: true,
        source: previous.tail.source + source.slice(previous.source.length),
      },
    };
  }

  const settledLength = previous.source.length - previous.tail.source.length;
  const next = partitionStreamingMarkdown(source.slice(settledLength));
  if (
    !previous.tail.raw
    && previous.tail.source.length > 0
    && next.settled.length === 0
    && next.tail.raw
    && next.tail.source.length > MAX_RICH_TAIL_LENGTH
  ) {
    return {
      source,
      overflowed: true,
      settled: [
        ...previous.settled,
        { key: `${settledLength}`, source: previous.tail.source },
      ],
      tail: {
        raw: true,
        source: source.slice(previous.source.length),
      },
    };
  }
  let blockFrom = settledLength;
  const localBlocks = [...next.settled];
  const newlySettled: StreamingMarkdownBlock[] = [];
  const firstBlock = localBlocks[0];
  const previousTailSuffix = firstBlock?.source.slice(previous.tail.source.length);
  if (
    !previous.tail.raw
    && previous.tail.source.length > 0
    && firstBlock?.source.startsWith(previous.tail.source)
    && /^\r?\n[ \t]*\r?\n$/u.test(previousTailSuffix ?? "")
  ) {
    newlySettled.push({ key: `${blockFrom}`, source: previous.tail.source });
    blockFrom += previous.tail.source.length;
    newlySettled.push({ key: `${blockFrom}`, source: previousTailSuffix ?? "" });
    blockFrom += previousTailSuffix?.length ?? 0;
    localBlocks.shift();
  }
  for (const block of localBlocks) {
    const blockTo = blockFrom + block.source.length;
    newlySettled.push({
      key: `${blockFrom}`,
      source: block.source,
    });
    blockFrom = blockTo;
  }

  return {
    source,
    overflowed: next.tail.raw && next.tail.source.length > MAX_RICH_TAIL_LENGTH,
    settled: [...previous.settled, ...newlySettled],
    tail: next.tail,
  };
}
