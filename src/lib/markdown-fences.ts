/**
 * Finds the fenced code blocks in Markdown, so every reader of an assistant
 * reply agrees on which lines are code. The chat bubble (`outsideCodeFences`
 * in display-path.ts) leaves code as written, and the plan reader
 * (plan-from-reply.ts) skips numbered lines in code. The rules follow
 * CommonMark as micromark reads it, the parser behind the chat's Markdown
 * renderer, so both also agree with what the user sees.
 *
 * - A fence is three or more backticks or tildes, indented at most three
 *   spaces past the blockquotes and list items that hold it.
 * - An info string may follow the opener, but a backtick fence's info string
 *   cannot hold a backtick: "```latex``` then" is inline code.
 * - Only a run of the same character, at least as long, with nothing after it
 *   closes a fence.
 * - A fence that is never closed runs to the end of the text (a reply that is
 *   still streaming), or to the end of the blockquote or list item holding it.
 * - Lines end in "\n" or "\r\n". A tab counts to the next multiple of four
 *   columns.
 */

export type FenceRole = "open" | "code" | "close";

export interface MarkdownLine {
  /** The line without its line ending. */
  text: string;
  /** "\r\n", "\n", or what ends the last line ("" or a lone "\r" mid-stream). */
  eol: string;
  /** The line's part in a fenced code block, or null outside one. */
  fence: FenceRole | null;
}

interface Fence {
  char: string;
  length: number;
}

interface OpenFence extends Fence {
  /** How many containers (blockquotes and list items) hold the fence. */
  depth: number;
}

// A blockquote, or a list item with the column its content starts at,
// counted from the end of the containers around it. An item that began with
// an empty line ends at the next text after a blank line, as micromark reads it.
type Container =
  | { kind: "quote" }
  | { kind: "item"; column: number; startedEmpty: boolean; blankAfterStart: boolean };

interface ListMarker {
  width: number;
  spaces: number;
  body: string;
}

// What the innermost container holds open that affects the next line:
// paragraph text, which a "lazy" line may continue without the container
// prefixes, or indented code, which the renderer's parser (micromark) keeps
// open across blank lines.
type Flow = "paragraph" | "indented" | null;

interface ScanState {
  containers: Container[];
  fence: OpenFence | null;
  flow: Flow;
}

const TAB_STOP = 4;
// Up to three spaces, ">", then one optional space.
const QUOTE_MARKER = /^ {0,3}> ?/;
const FENCE_OPENER = /^(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSER = /^(`{3,}|~{3,})[ \t]*$/;
// A bullet or a number of up to nine digits, then a space or the line end.
const LIST_MARKER = /^(?:[-+*]|\d{1,9}[.)])(?= |$)/;
// The markers that may start a list in the middle of a paragraph.
const INTERRUPTING_MARKER = /^(?:[-+*]|1[.)])$/;
const THEMATIC_BREAK = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/;
const HEADING = /^#{1,6}(?:[ \t]|$)/;
// Tabs are expanded before matching, so a blank line holds only spaces.
const BLANK = /^ *$/;

function splitLines(markdown: string): { text: string; eol: string }[] {
  const lines: { text: string; eol: string }[] = [];
  let from = 0;
  for (;;) {
    const lineFeed = markdown.indexOf("\n", from);
    const end = lineFeed < 0 ? markdown.length : lineFeed;
    const carriageReturn = end > from && markdown[end - 1] === "\r";
    const textEnd = carriageReturn ? end - 1 : end;
    lines.push({
      text: markdown.slice(from, textEnd),
      eol: markdown.slice(textEnd, lineFeed < 0 ? end : end + 1),
    });
    if (lineFeed < 0) return lines;
    from = lineFeed + 1;
  }
}

// Tabs become spaces up to the next multiple of four columns, as CommonMark
// counts indentation, so every column below is a plain character offset.
function expandTabs(text: string): string {
  if (!text.includes("\t")) return text;
  let out = "";
  for (const char of text) {
    out += char === "\t" ? " ".repeat(TAB_STOP - (out.length % TAB_STOP)) : char;
  }
  return out;
}

function indentOf(text: string): number {
  let count = 0;
  while (text[count] === " ") count += 1;
  return count;
}

function openerOf(content: string): Fence | null {
  const match = FENCE_OPENER.exec(content);
  if (!match) return null;
  if (match[1].startsWith("`") && match[2].includes("`")) return null;
  return { char: match[1][0], length: match[1].length };
}

function closes(content: string, fence: Fence): boolean {
  const match = FENCE_CLOSER.exec(content);
  return match !== null && match[1][0] === fence.char && match[1].length >= fence.length;
}

// The list marker that starts `content`, if it starts a list item there. In
// the middle of a paragraph or indented code only a bullet or "1." with text
// after it does, as micromark reads it.
function listMarkerOf(content: string, interrupting: boolean): ListMarker | null {
  if (THEMATIC_BREAK.test(content)) return null;
  const match = LIST_MARKER.exec(content);
  if (!match) return null;
  const afterMarker = content.slice(match[0].length);
  const spaces = indentOf(afterMarker);
  const body = afterMarker.slice(spaces);
  if (interrupting && (body === "" || !INTERRUPTING_MARKER.test(match[0]))) return null;
  return { width: match[0].length, spaces, body };
}

// How many of the first `count` containers the line continues, and the text
// after their prefixes. A blockquote needs its ">"; a list item needs the line
// indented to its content column, or blank.
function matchContainers(
  line: string,
  containers: readonly Container[],
  count: number,
): { matched: number; rest: string } {
  let rest = line;
  let matched = 0;
  for (; matched < count; matched++) {
    const container = containers[matched];
    if (container.kind === "quote") {
      const marker = QUOTE_MARKER.exec(rest);
      if (!marker) break;
      rest = rest.slice(marker[0].length);
    } else if (BLANK.test(rest)) {
      rest = "";
    } else if (!container.blankAfterStart && indentOf(rest) >= container.column) {
      rest = rest.slice(container.column);
    } else {
      break;
    }
  }
  return { matched, rest };
}

// The line's part in the open fence, or null when a blockquote or list item
// holding the fence has ended, and the fence with it.
function roleInFence(line: string, containers: readonly Container[], fence: OpenFence): FenceRole | null {
  const { matched, rest } = matchContainers(line, containers, fence.depth);
  if (matched < fence.depth) return null;
  const indent = indentOf(rest);
  return indent <= 3 && closes(rest.slice(indent), fence) ? "close" : "code";
}

// Opens the blockquotes and list items that start the line. Returns the text
// after their markers, or null when the line opens none.
function openContainers(text: string, state: ScanState, interrupting: boolean): string | null {
  let rest = text;
  let opened = false;
  for (;;) {
    const indent = indentOf(rest);
    if (indent > 3) break;
    const quote = QUOTE_MARKER.exec(rest);
    // micromark applies the paragraph-interrupt rule to every list marker
    // on the line, not only the first container ("> 2) x" after text).
    const marker = quote ? null : listMarkerOf(rest.slice(indent), interrupting);
    if (quote) {
      state.containers.push({ kind: "quote" });
      rest = rest.slice(quote[0].length);
    } else if (marker) {
      // One to four spaces after the marker set where the item's content
      // starts. With five or more (indented code), or an empty item, it
      // starts one space after the marker.
      const gap = marker.body === "" || marker.spaces > 4 ? 1 : marker.spaces;
      const column = indent + marker.width + gap;
      state.containers.push({
        kind: "item",
        column,
        startedEmpty: marker.body === "",
        blankAfterStart: false,
      });
      rest = rest.slice(Math.min(column, rest.length));
    } else {
      break;
    }
    opened = true;
  }
  return opened ? rest : null;
}

// Keeps track of list items that began with an empty line: a blank line
// after one ends it, and text first keeps it open for good.
function trackEmptyItems(containers: readonly Container[], matched: number, blank: boolean): void {
  for (const container of containers.slice(0, matched)) {
    if (container.kind !== "item") continue;
    if (blank) {
      container.blankAfterStart ||= container.startedEmpty;
    } else {
      container.startedEmpty = false;
      container.blankAfterStart = false;
    }
  }
}

// The block that starts `text`, the line after its container markers.
// `continues`: the line may go on with the paragraph above it, lazily when it
// leaves out the prefixes of `unmatched` containers, which then stay open.
function scanBlock(
  text: string,
  state: ScanState,
  unmatched: readonly Container[],
  continues: boolean,
): FenceRole | null {
  const indent = indentOf(text);
  const content = text.slice(indent);
  if (content === "") {
    state.flow = null;
    return null;
  }
  if (indent > 3) {
    // Indented code, unless it goes on with a paragraph. micromark does not
    // hold indented code open against the next line when it starts on the
    // line that ends a blockquote or list item.
    if (continues) state.containers.push(...unmatched);
    else state.flow = unmatched.length > 0 ? null : "indented";
    return null;
  }
  const opener = openerOf(content);
  if (opener) {
    state.fence = { ...opener, depth: state.containers.length };
    state.flow = null;
    return "open";
  }
  const underline = continues && unmatched.length === 0 && SETEXT_UNDERLINE.test(content);
  if (underline || THEMATIC_BREAK.test(content) || HEADING.test(content)) {
    state.flow = null;
    return null;
  }
  if (continues) state.containers.push(...unmatched);
  state.flow = "paragraph";
  return null;
}

function scanLine(line: string, state: ScanState): FenceRole | null {
  if (state.fence) {
    const role = roleInFence(line, state.containers, state.fence);
    if (role === "code") return role;
    state.fence = null;
    state.flow = null;
    // Otherwise a container holding the fence ended: read the line afresh.
    if (role === "close") return role;
  }
  const open = state.containers.length;
  const { matched, rest } = matchContainers(line, state.containers, open);
  const blank = BLANK.test(rest);
  trackEmptyItems(state.containers, matched, blank);
  if (blank) {
    state.containers.length = matched;
    // Indented code stays open across blank lines; a paragraph does not.
    if (matched < open || state.flow === "paragraph") state.flow = null;
    return null;
  }
  const unmatched = state.containers.splice(matched);
  const opened = openContainers(rest, state, state.flow !== null && matched === open);
  return scanBlock(opened ?? rest, state, unmatched, opened === null && state.flow === "paragraph");
}

/** `markdown` split into lines, each marked with its part in a fenced code block. */
export function markdownLines(markdown: string): MarkdownLine[] {
  const state: ScanState = { containers: [], fence: null, flow: null };
  return splitLines(markdown).map(({ text, eol }) => ({
    text,
    eol,
    fence: scanLine(expandTabs(text), state),
  }));
}
