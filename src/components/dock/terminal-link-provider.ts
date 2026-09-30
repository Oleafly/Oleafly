import type {
  IBuffer,
  IBufferCell,
  IBufferLine,
  ILink,
  ILinkHandler,
  ILinkProvider,
  Terminal,
} from "@xterm/xterm";
import { findTerminalLinks, safeTerminalUrl, type TerminalLinkMatch } from "@/lib/terminal-links";
import { isMac } from "@/lib/utils";

export interface TerminalFileTarget {
  path: string;
  line?: number;
  column?: number;
}

export interface TerminalLinkHover {
  /** Project-relative location or URL, never an absolute path. */
  label: string;
  kind: "file" | "url";
}

export interface TerminalLinkActions {
  /** Maps a path from the output onto a project file, or null. */
  resolve(path: string): string | null;
  openFile(target: TerminalFileTarget): void;
  openUrl(url: string): void;
  hover(info: TerminalLinkHover, event: MouseEvent): void;
  leave(): void;
}

// A path in a traceback can wrap over several rows; stop looking well past that.
const MAX_WRAPPED_ROWS = 30;

interface CellPosition {
  x: number;
  y: number;
  width: number;
}

/**
 * Cmd-click on macOS, where Ctrl-click is a right click; Ctrl-click elsewhere.
 * A plain click keeps selecting text and focusing the terminal.
 */
export function isOpenLinkClick(event: MouseEvent, mac: boolean = isMac): boolean {
  return event.button === 0 && (mac ? event.metaKey : event.ctrlKey);
}

/** Index after the last written cell; empty cells hold no characters. */
function contentEnd(line: IBufferLine, cell: IBufferCell): number {
  let end = line.length;
  while (end > 0 && line.getCell(end - 1, cell) && cell.getWidth() === 1 && !cell.getChars()) {
    end -= 1;
  }
  return end;
}

/**
 * Joins the wrapped rows around `row` into one string and records the 1-based
 * cell each UTF-16 unit came from. Wide glyphs take two cells, so string
 * indices cannot stand in for columns.
 */
function logicalLine(buffer: IBuffer, row: number): LogicalLine | null {
  if (!buffer.getLine(row)) return null;
  const { first, last } = wrappedRows(buffer, row);
  const logical: LogicalLine = { text: "", cells: [] };
  const cell = buffer.getNullCell();
  for (let y = first; y <= last; y += 1) {
    const line = buffer.getLine(y);
    if (!line) break;
    // A wide glyph that does not fit in the last column wraps and leaves that
    // cell empty; as a space it would split the path across the rows.
    const end = y < last ? contentEnd(line, cell) : line.length;
    appendRow(logical, line, y, end, cell);
  }
  return logical;
}

interface LogicalLine {
  text: string;
  cells: CellPosition[];
}

/** The first and last rows of the wrapped line that holds `row`. */
function wrappedRows(buffer: IBuffer, row: number): { first: number; last: number } {
  let first = row;
  while (first > 0 && row - first < MAX_WRAPPED_ROWS - 1 && buffer.getLine(first)?.isWrapped) {
    first -= 1;
  }
  let last = row;
  while (last - first < MAX_WRAPPED_ROWS - 1 && buffer.getLine(last + 1)?.isWrapped) last += 1;
  return { first, last };
}

/** Adds the first `end` cells of row `y` to `logical`. */
function appendRow(logical: LogicalLine, line: IBufferLine, y: number, end: number, cell: IBufferCell) {
  for (let x = 0; x < end; x += 1) {
    if (!line.getCell(x, cell)) break;
    const width = cell.getWidth();
    if (width === 0) continue; // right half of a wide glyph
    const chars = cell.getChars() || " ";
    logical.text += chars;
    // One position per UTF-16 unit, since match offsets index the string.
    const position = { x: x + 1, y: y + 1, width };
    logical.cells.push(...Array.from({ length: chars.length }, () => position));
  }
}

function locationLabel({ path, line, column }: TerminalFileTarget): string {
  if (line === undefined) return path;
  return column === undefined ? `${path}:${line}` : `${path}:${line}:${column}`;
}

function linkTarget(
  match: TerminalLinkMatch,
  actions: TerminalLinkActions,
): { info: TerminalLinkHover; open: () => void } | null {
  if (match.kind === "url") {
    const url = safeTerminalUrl(match.url);
    return url ? { info: { label: url, kind: "url" }, open: () => actions.openUrl(url) } : null;
  }
  const path = actions.resolve(match.path);
  if (!path) return null;
  const target: TerminalFileTarget = {
    path,
    ...(match.line === undefined ? {} : { line: match.line }),
    ...(match.column === undefined ? {} : { column: match.column }),
  };
  return {
    info: { label: locationLabel(target), kind: "file" },
    open: () => actions.openFile(target),
  };
}

/**
 * Underlines project file locations and web URLs in terminal output. xterm
 * asks only for the hovered row, so busy output costs nothing until the
 * pointer rests on it.
 */
export function createTerminalLinkProvider(
  terminal: Pick<Terminal, "buffer">,
  actions: TerminalLinkActions,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const logical = logicalLine(terminal.buffer.active, y - 1);
      if (!logical) {
        callback(undefined);
        return;
      }
      const links: ILink[] = [];
      const isProjectFile = (path: string) => actions.resolve(path) !== null;
      for (const match of findTerminalLinks(logical.text, isProjectFile)) {
        const first = logical.cells[match.start];
        const last = logical.cells[match.end - 1];
        if (!first || !last || first.y > y || last.y < y) continue;
        const target = linkTarget(match, actions);
        if (!target) continue;
        links.push({
          range: {
            start: { x: first.x, y: first.y },
            end: { x: last.x + last.width - 1, y: last.y },
          },
          text: logical.text.slice(match.start, match.end),
          decorations: { underline: true, pointerCursor: true },
          activate: (event) => {
            if (isOpenLinkClick(event)) target.open();
          },
          hover: (event) => actions.hover(target.info, event),
          leave: () => actions.leave(),
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  };
}

/**
 * Handles OSC 8 hyperlinks so they open through the app, instead of xterm's
 * fallback of `confirm()` and `window.open()`. The label is the real target,
 * which can differ from the text the program printed.
 */
export function createTerminalLinkHandler(actions: TerminalLinkActions): ILinkHandler {
  return {
    allowNonHttpProtocols: false,
    activate(event, text) {
      if (!isOpenLinkClick(event)) return;
      const url = safeTerminalUrl(text);
      if (url) actions.openUrl(url);
    },
    hover(event, text) {
      const url = safeTerminalUrl(text);
      if (url) actions.hover({ label: url, kind: "url" }, event);
    },
    leave() {
      actions.leave();
    },
  };
}
