import { syntaxTree } from "@codemirror/language";
import type { Extension, Text } from "@codemirror/state";
import { StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  mountMathPreview,
  type MountedMathPreview,
} from "./math-render";
import {
  scanMathExpressions,
  type MathExpression,
  type MathSourceFormat,
} from "./math-source";

export {
  mountMathPreview,
  renderMathExpression,
  type MathRenderResult,
  type MountedMathPreview,
  type MountMathPreviewOptions,
} from "./math-render";
export {
  scanMathExpressions,
  type MathDelimiter,
  type MathExpression,
  type MathExpressionStatus,
  type MathScanOptions,
  type MathSourceFormat,
} from "./math-source";

interface PreviewPayload {
  doc: Text;
  revision: number;
  requestGeneration: number;
  decorations: DecorationSet;
}

const PREVIEW_DEBOUNCE_MS = 160;
const MAX_VISIBLE_EXPRESSIONS = 80;
const SCAN_OVERSCAN = 8_192;
const setMathDecorations = StateEffect.define<PreviewPayload>();

function protectedSyntaxRanges(
  view: EditorView,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (
        /(?:comment|code|verbatim|rawtext|url|linkdestination)/iu.test(
          node.name,
        )
      ) {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }
      return true;
    },
  });
  return ranges;
}

function viewportWindows(view: EditorView): Array<{ from: number; to: number }> {
  const windows = view.visibleRanges
    .map((range) => {
      const from = Math.max(0, range.from - SCAN_OVERSCAN);
      const to = Math.min(view.state.doc.length, range.to + SCAN_OVERSCAN);
      return {
        from: view.state.doc.lineAt(from).from,
        to: view.state.doc.lineAt(to).to,
      };
    })
    .sort((left, right) => left.from - right.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const window of windows) {
    const previous = merged[merged.length - 1];
    if (previous && window.from <= previous.to) {
      previous.to = Math.max(previous.to, window.to);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function visibleExpressions(
  view: EditorView,
  format: MathSourceFormat,
): MathExpression[] {
  const seen = new Set<string>();
  const found: MathExpression[] = [];
  for (const window of viewportWindows(view)) {
    const text = view.state.doc.sliceString(window.from, window.to);
    const excluded = protectedSyntaxRanges(view, window.from, window.to).map(
      (range) => ({
        from: range.from - window.from,
        to: range.to - window.from,
      }),
    );
    for (const localExpression of scanMathExpressions(text, {
      format,
      excluded,
    })) {
      const expression: MathExpression = {
        ...localExpression,
        from: localExpression.from + window.from,
        to: localExpression.to + window.from,
        bodyFrom: localExpression.bodyFrom + window.from,
        bodyTo: localExpression.bodyTo + window.from,
      };
      const visible = view.visibleRanges.some(
        (range) => expression.to >= range.from && expression.from <= range.to,
      );
      if (!visible) continue;
      const key = `${expression.from}:${expression.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(expression);
      if (found.length >= MAX_VISIBLE_EXPRESSIONS) return found;
    }
  }
  return found;
}

class MathPreviewWidget extends WidgetType {
  private mounted = new WeakMap<HTMLElement, MountedMathPreview>();
  /**
   * Liveness of this widget instance, which is not the same question as
   * "is the document unchanged". CodeMirror keeps a widget mounted across
   * edits and calls `destroy` when it is really gone, so the preview paints
   * and stays clickable instead of freezing on the first keystroke.
   */
  private alive = true;

  constructor(
    readonly expression: MathExpression,
    readonly identity: string,
    readonly sourceFrom: number,
    readonly sourceTo: number,
    readonly isCurrent: () => boolean,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const dom = document.createElement(this.expression.display ? "div" : "span");
    const mounted = mountMathPreview(dom, {
      expression: this.expression,
      identity: this.identity,
      isCurrent: () => this.alive,
    });
    this.mounted.set(dom, mounted);
    return dom;
  }

  destroy(dom: HTMLElement): void {
    this.alive = false;
    this.mounted.get(dom)?.destroy();
    this.mounted.delete(dom);
  }
}

function buildDecorations(
  view: EditorView,
  format: MathSourceFormat,
  identity: string,
  isCurrent: () => boolean,
): DecorationSet {
  const ranges = [];
  for (const expression of visibleExpressions(view, format)) {
    ranges.push(
      Decoration.mark({
        class:
          expression.status === "incomplete"
            ? "cm-math-source is-incomplete"
            : "cm-math-source",
        attributes: {
          "data-math-source": expression.delimiter,
          ...(expression.status === "incomplete"
            ? { "aria-invalid": "true" }
            : {}),
        },
      }).range(expression.from, expression.to),
    );
    const anchor = expression.display
      ? view.state.doc.lineAt(expression.to).to
      : expression.to;
    ranges.push(
      Decoration.widget({
        widget: new MathPreviewWidget(
          expression,
          identity,
          expression.from,
          expression.to,
          isCurrent,
        ),
        side: 1,
        block: expression.display,
      }).range(anchor),
    );
  }
  return Decoration.set(ranges, true);
}

const mathPreviewTheme = EditorView.baseTheme({
  ".cm-math-source": {
    textDecoration: "underline",
    textDecorationColor:
      "color-mix(in srgb, var(--primary) 38%, transparent)",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "0.2em",
  },
  ".cm-math-source.is-incomplete": {
    textDecorationColor: "var(--destructive)",
    textDecorationStyle: "wavy",
  },
  ".math-preview": {
    boxSizing: "border-box",
    color: "var(--cm-editor-fg, var(--foreground))",
    background:
      "color-mix(in srgb, var(--cm-editor-bg, var(--background)) 88%, var(--muted))",
    border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
    borderRadius: "6px",
    alignItems: "center",
    gap: "6px",
    maxWidth: "min(100%, 48rem)",
  },
  ".math-preview.is-inline": {
    display: "inline-flex",
    marginInline: "0.45em",
    padding: "0.12em 0.35em",
    verticalAlign: "middle",
  },
  ".math-preview.is-display": {
    display: "flex",
    justifyContent: "center",
    minHeight: "2.75rem",
    overflowX: "auto",
    padding: "0.5rem 0.75rem",
  },
  ".math-preview-output": {
    minWidth: "0",
    overflowX: "auto",
  },
        ".math-preview-error": {
    color: "var(--destructive)",
    font: "500 11px/1.35 var(--font-sans)",
  },
  ".math-preview-loading": {
    color: "var(--muted-foreground)",
    font: "500 10px/1.35 var(--font-sans)",
  },
});

/**
 * Live, source-preserving math preview for LaTeX document bodies and Pandoc
 * Markdown. Typst deliberately has no extension and remains non-applicable.
 */
export function liveMathPreview(format: MathSourceFormat): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;
      private revision = 0;
      private requestGeneration = 0;
      private timer: ReturnType<typeof setTimeout> | null = null;
      private destroyed = false;

      constructor(readonly view: EditorView) {
        this.schedule(view, 0);
      }

      update(update: ViewUpdate) {
        let appliedPreview = false;
        for (const transaction of update.transactions) {
          for (const effect of transaction.effects) {
            if (!effect.is(setMathDecorations)) continue;
            const payload = effect.value;
            if (
              payload.doc === update.state.doc &&
              payload.revision === this.revision &&
              payload.requestGeneration === this.requestGeneration
            ) {
              this.decorations = payload.decorations;
              appliedPreview = true;
            }
          }
        }

        if (update.docChanged) {
          this.revision++;
          this.decorations = Decoration.none;
          this.schedule(update.view);
        } else if (update.viewportChanged && !appliedPreview) {
          this.schedule(update.view);
        }
      }

      private schedule(view: EditorView, delay = PREVIEW_DEBOUNCE_MS) {
        if (this.timer !== null) clearTimeout(this.timer);
        const doc = view.state.doc;
        const revision = this.revision;
        const requestGeneration = ++this.requestGeneration;
        this.timer = setTimeout(() => {
          this.timer = null;
          if (
            this.destroyed ||
            view.state.doc !== doc ||
            this.revision !== revision ||
            this.requestGeneration !== requestGeneration
          ) {
            return;
          }
          const identity = `${revision}:${requestGeneration}`;
          const isCurrent = () =>
            !this.destroyed &&
            view.state.doc === doc &&
            this.revision === revision &&
            this.requestGeneration === requestGeneration;
          const decorations = buildDecorations(
            view,
            format,
            identity,
            isCurrent,
          );
          if (!isCurrent()) return;
          view.dispatch({
            effects: setMathDecorations.of({
              doc,
              revision,
              requestGeneration,
              decorations,
            }),
          });
        }, delay);
      }

      destroy() {
        this.destroyed = true;
        this.requestGeneration++;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.decorations = Decoration.none;
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );

  return [mathPreviewTheme, plugin];
}

/**
 * Kept as a compatibility alias for older hosts. New callers should choose the
 * document format explicitly with `liveMathPreview`.
 */
export function mathHover(): Extension {
  return liveMathPreview("latex");
}
