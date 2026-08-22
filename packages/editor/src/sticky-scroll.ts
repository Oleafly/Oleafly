import { syntaxTree } from "@codemirror/language";
import type { Extension, Text } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { editorHighlightStyle } from "./theme";
import { scopesAtLine, stickyScopes, type StickyScope } from "./sticky-structure";

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
    // Above the gutter (200), which is otherwise painted over the overlay and
    // shows the document's own line numbers through the pinned rows. Below the
    // search and other panels (300).
    zIndex: "250",
    overflow: "hidden",
    fontFamily: "var(--cm-font-family, var(--font-mono))",
    fontSize: "var(--cm-font-size, 13px)",
    lineHeight: "1.6",
    backgroundColor: "var(--cm-editor-bg, var(--background))",
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
    padding: "0",
    textAlign: "left",
    font: "inherit",
    color: "var(--cm-editor-fg, var(--foreground))",
  },
  ".cm-stickyRow:hover": {
    backgroundColor: "var(--cm-active-line, color-mix(in oklch, var(--muted) 45%, transparent))",
  },
  ".cm-stickyLineNo": {
    flex: "none",
    textAlign: "right",
    color: "var(--cm-gutter-fg, var(--muted-foreground))",
    paddingLeft: "var(--cm-gutter-inset, 6px)",
    // Matches the line-number gutter's own right padding so the digits in a
    // pinned row sit exactly under the digits in the document.
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

class StickyScrollPlugin {
  private readonly container: HTMLDivElement;
  private scopes: StickyScope[] = [];
  private scannedDoc: Text | null = null;
  private rows: RenderedRow[] = [];
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private frame = 0;
  private readonly onScroll: () => void;

  constructor(private readonly view: EditorView) {
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
    if (update.docChanged) {
      if (update.state.doc.lines <= INLINE_RESCAN_LINES) this.rescan();
      else this.scheduleRescan();
    }
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
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
    const { doc } = this.view.state;
    if (this.scannedDoc === doc) return;
    this.scannedDoc = doc;
    this.scopes = stickyScopes(doc);
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
    if (sameRows(next, this.rows)) {
      this.syncHorizontalScroll();
      return;
    }
    this.rows = next;

    this.container.textContent = "";
    const gutter = view.dom.querySelector(".cm-gutters");
    const gutterWidth = gutter instanceof HTMLElement ? gutter.offsetWidth : 0;
    for (const row of next) {
      this.container.appendChild(this.renderRow(row, gutterWidth));
    }
    this.syncHorizontalScroll();
  }

  private syncHorizontalScroll() {
    const offset = this.view.scrollDOM.scrollLeft;
    for (const code of this.container.querySelectorAll<HTMLElement>(".cm-stickyCode")) {
      code.style.transform = offset ? `translateX(${-offset}px)` : "";
    }
  }

  private renderRow(row: RenderedRow, gutterWidth: number): HTMLElement {
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
    if (gutterWidth > 0) number.style.width = `${gutterWidth}px`;
    number.textContent = String(row.line);
    button.appendChild(number);

    const code = document.createElement("span");
    code.className = "cm-stickyCode";
    this.fillHighlighted(code, line.from, line.to, row.text);
    button.appendChild(code);

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
export function stickyScroll(): Extension {
  return [stickyTheme, ViewPlugin.fromClass(StickyScrollPlugin)];
}
