import { syntaxTree } from "@codemirror/language";
import type { Extension, Text } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { EDITOR_LINE_HEIGHT_CSS, editorHighlightStyle } from "./theme";
import { editorColor } from "./color-roles";
import {
  latexStickySource,
  scopesAtLine,
  type StickyScope,
  type StickySource,
} from "./sticky-structure";

/** How many nested scopes may be pinned before the viewport starts to suffer. */
const MAX_STICKY_ROWS = 6;

/**
 * Rescanning is linear in the document, so it only runs inline while that is
 * certainly cheap. Past this, an edit schedules the rescan instead and the
 * previous scopes stay pinned for a fraction of a second.
 */
const INLINE_RESCAN_LINES = 5_000;
const RESCAN_DELAY_MS = 250;

const stickyTheme = EditorView.theme({
  ".cm-stickyScroll": {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    // Above the scroller (z-index 0), whose stacking context holds the gutter,
    // so the document's own line numbers never show through the pinned rows.
    // Below the search panel (20) and app dialogs (80): the editor is not a
    // stacking context of its own, so a larger value here drew the pinned rows
    // over the search widget and over any dialog rendered in the workspace.
    // The editor stays unisolated because a tooltip mounted inside it has to
    // reach over the panes beside it.
    zIndex: "10",
    overflow: "hidden",
    fontFamily: "var(--cm-font-family, var(--font-mono))",
    fontSize: "var(--cm-font-size, 13px)",
    letterSpacing: "var(--cm-letter-spacing, normal)",
    lineHeight: EDITOR_LINE_HEIGHT_CSS,
    backgroundColor: editorColor("background"),
    boxShadow: "0 4px 8px -6px rgb(0 0 0 / 0.45)",
    borderBottom: "1px solid var(--border)",
  },
  ".cm-stickyScroll:empty": {
    display: "none",
  },
  ".cm-stickyRow": {
    display: "flex",
    width: "100%",
    alignItems: "baseline",
    cursor: "pointer",
    background: "none",
    border: "none",
    // A little more room than a document line, so the pinned rows read as a
    // header rather than as cramped copies of the lines below them.
    padding: "0.25em 0",
    textAlign: "left",
    font: "inherit",
    color: editorColor("text"),
  },
  ".cm-stickyRow:hover": {
    backgroundColor: "var(--cm-active-line, color-mix(in oklch, var(--muted) 45%, transparent))",
  },
  ".cm-stickyLineNo": {
    flex: "none",
    boxSizing: "border-box",
    textAlign: "right",
    color: editorColor("lineNumbers"),
    paddingLeft: "var(--cm-gutter-inset, 6px)",
    // Only until the gutter has been measured; see `measureColumns`.
    paddingRight: "8px",
  },
  ".cm-stickyCode": {
    flex: "1 1 auto",
    minWidth: "0",
    whiteSpace: "pre",
    overflow: "hidden",
  },
});

interface RenderedRow {
  line: number;
  text: string;
}

function renderedRows(
  doc: Text,
  scopes: readonly StickyScope[],
): RenderedRow[] {
  return scopes.map((scope) => ({
    line: scope.line,
    text: doc.line(scope.line).text,
  }));
}

function sameRows(a: readonly RenderedRow[], b: readonly RenderedRow[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => row.line === b[i].line && row.text === b[i].text)
  );
}

/** Horizontal offsets from the editor's left edge, in CSS pixels. */
interface Columns {
  /** Where the line-number digits end. */
  digitsEnd: number;
  /** Where a line's text starts. */
  textStart: number;
}

function sameColumns(a: Columns | null, b: Columns | null): boolean {
  return a?.digitsEnd === b?.digitsEnd && a?.textStart === b?.textStart;
}

class StickyScrollPlugin {
  private readonly container: HTMLDivElement;
  private scopes: StickyScope[] = [];
  private scannedDoc: Text | null = null;
  private scannedTree: Tree | null = null;
  private rows: RenderedRow[] = [];
  private columns: Columns | null = null;
  private columnsDirty = true;
  private horizontalOffset = -1;
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private readonly onScroll: () => void;

  constructor(
    private readonly view: EditorView,
    private readonly source: StickySource,
  ) {
    this.container = document.createElement("div");
    this.container.className = "cm-stickyScroll";
    this.container.setAttribute("aria-hidden", "true");
    view.dom.appendChild(this.container);

    this.onScroll = () => this.schedulePaint();
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });

    this.rescan();
    this.schedulePaint();
  }

  update(update: ViewUpdate) {
    const treeChanged =
      this.source.followsTree === true && syntaxTree(update.state) !== syntaxTree(update.startState);
    if (update.docChanged || treeChanged) {
      if (update.state.doc.lines <= INLINE_RESCAN_LINES) this.rescan();
      else this.scheduleRescan();
    }
    if (update.docChanged || update.geometryChanged) this.columnsDirty = true;
    if (update.docChanged || treeChanged || update.viewportChanged || update.geometryChanged) {
      this.schedulePaint();
    }
  }

  /**
   * Painting measures the scroller, which is a layout read. Deferring it to the
   * next frame keeps it out of CodeMirror's update cycle and collapses a burst
   * of scroll events into the one measurement the browser can actually paint.
   */
  private schedulePaint() {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    if (this.rescanTimer !== null) clearTimeout(this.rescanTimer);
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.container.remove();
  }

  private scheduleRescan() {
    if (this.rescanTimer !== null) clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null;
      this.rescan();
      this.schedulePaint();
    }, RESCAN_DELAY_MS);
  }

  private rescan() {
    const { state } = this.view;
    const tree = this.source.followsTree ? syntaxTree(state) : null;
    if (this.scannedDoc === state.doc && this.scannedTree === tree) return;
    this.scannedDoc = state.doc;
    this.scannedTree = tree;
    this.scopes = this.source.scopes(state);
  }

  private topLine(): number {
    const { view } = this;
    const rect = view.scrollDOM.getBoundingClientRect();
    if (rect.height === 0) return 1;
    // Measured from the scroller's true top edge, not from below the pinned
    // rows: offsetting by the overlay's own height makes the row count feed
    // back into the measurement, and a scope right at the boundary flickers in
    // and out on every frame.
    const block = view.lineBlockAtHeight(rect.top - view.documentTop);
    return view.state.doc.lineAt(block.from).number;
  }

  private paint() {
    const { view } = this;
    const next = renderedRows(
      view.state.doc,
      scopesAtLine(this.scopes, this.topLine(), MAX_STICKY_ROWS),
    );
    const columns = next.length > 0 ? this.currentColumns() : this.columns;
    if (sameRows(next, this.rows) && sameColumns(columns, this.columns)) {
      this.syncHorizontalScroll();
      return;
    }
    this.rows = next;
    this.columns = columns;

    this.container.textContent = "";
    for (const row of next) {
      this.container.appendChild(this.renderRow(row, columns));
    }
    this.horizontalOffset = -1;
    this.syncHorizontalScroll();
  }

  private currentColumns(): Columns | null {
    if (!this.columnsDirty && this.columns) return this.columns;
    const measured = this.measureColumns();
    if (measured) this.columnsDirty = false;
    return measured;
  }

  /**
   * Reads the document's own columns so a pinned row's number sits under the
   * line numbers and its text under the text, with the fold and diagnostic
   * gutters in between. Null until the editor has been laid out.
   */
  private measureColumns(): Columns | null {
    const { view } = this;
    const gutters = view.dom.querySelector<HTMLElement>(".cm-gutters-before");
    const number = gutters?.querySelector<HTMLElement>(".cm-lineNumbers .cm-gutterElement");
    const line = view.contentDOM.querySelector<HTMLElement>(".cm-line");
    if (!gutters || !number || !line) return null;
    const numberBox = number.getBoundingClientRect();
    if (numberBox.width === 0) return null;
    const left = view.dom.getBoundingClientRect().left;
    const padding = (element: HTMLElement, side: "paddingLeft" | "paddingRight") =>
      Number.parseFloat(getComputedStyle(element)[side]) || 0;
    return {
      digitsEnd: Math.round((numberBox.right - left) / view.scaleX - padding(number, "paddingRight")),
      // The text starts where the gutters end. Measured from them, not from a
      // line, because the text scrolls sideways under the fixed gutters.
      textStart: Math.round(
        (gutters.getBoundingClientRect().right - left) / view.scaleX +
          padding(view.contentDOM, "paddingLeft") +
          padding(line, "paddingLeft"),
      ),
    };
  }

  private syncHorizontalScroll() {
    const offset = this.view.scrollDOM.scrollLeft;
    if (offset === this.horizontalOffset) return;
    this.horizontalOffset = offset;
    for (const code of this.container.querySelectorAll<HTMLElement>(".cm-stickyCode")) {
      code.style.transform = offset ? `translateX(${-offset}px)` : "";
    }
  }

  private renderRow(row: RenderedRow, columns: Columns | null): HTMLElement {
    const { view } = this;
    const line = view.state.doc.line(row.line);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-stickyRow";
    button.tabIndex = -1;
    button.addEventListener("mousedown", (event) => {
      // mousedown, not click: the editor takes focus on mousedown and would
      // otherwise scroll the caret back into view, undoing the jump.
      event.preventDefault();
      view.scrollDOM.scrollTop = view.lineBlockAt(line.from).top;
    });

    const number = document.createElement("span");
    number.className = "cm-stickyLineNo";
    number.textContent = String(row.line);
    button.appendChild(number);

    const code = document.createElement("span");
    code.className = "cm-stickyCode";
    this.fillHighlighted(code, line.from, line.to, row.text);
    button.appendChild(code);

    if (columns) {
      number.style.width = `${columns.digitsEnd}px`;
      number.style.paddingRight = "0";
      code.style.marginLeft = `${Math.max(0, columns.textStart - columns.digitsEnd)}px`;
    }

    return button;
  }

  /**
   * Colorizes one line with the document's own highlight styles. Pinned rows
   * live outside the document flow, so `syntaxHighlighting` never sees them and
   * the tree has to be walked by hand. An unparsed region simply yields plain
   * text, which is the correct fallback rather than a reason to skip the row.
   */
  private fillHighlighted(
    target: HTMLElement,
    from: number,
    to: number,
    text: string,
  ) {
    let cursor = from;
    const append = (start: number, end: number, className?: string) => {
      if (end <= start) return;
      const span = document.createElement("span");
      if (className) span.className = className;
      span.textContent = text.slice(start - from, end - from);
      target.appendChild(span);
    };

    try {
      highlightTree(
        syntaxTree(this.view.state),
        editorHighlightStyle,
        (start, end, classes) => {
          append(cursor, start);
          append(start, end, classes);
          cursor = end;
        },
        from,
        to,
      );
    } catch {
      target.textContent = text;
      return;
    }
    append(cursor, to);
  }
}

/**
 * Keeps the enclosing sections and environments pinned to the top of the
 * editor while you scroll, so a paragraph deep inside a nested block still
 * says which section, figure, and environment it belongs to.
 */
export function stickyScroll(source: StickySource = latexStickySource): Extension {
  return [stickyTheme, ViewPlugin.define((view) => new StickyScrollPlugin(view, source))];
}
