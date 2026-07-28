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
  coverage: Array<{ from: number; to: number }>;
  decorations: DecorationSet;
}

const EDIT_PREVIEW_DEBOUNCE_MS = 160;
// CodeMirror deliberately keeps its rendered DOM viewport small. Rebuilding
// height-changing widgets while that viewport is chasing a fast scroll can
// expose its spacer rows for a frame. Wait for the viewport to settle and keep
// the preview set local to it instead of installing offscreen block widgets
// throughout a math-heavy document.
const VIEWPORT_PREVIEW_DEBOUNCE_MS = 120;
const SCAN_OVERSCAN = 16_384;
const COVERAGE_OVERSCAN = 4_096;
const MAX_RENDERED_EXPRESSIONS = 240;
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

function viewportWindows(
  view: EditorView,
  overscan: number,
): Array<{ from: number; to: number }> {
  const windows = view.visibleRanges
    .map((range) => {
      const from = Math.max(0, range.from - overscan);
      const to = Math.min(view.state.doc.length, range.to + overscan);
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
  windows: Array<{ from: number; to: number }>,
): MathExpression[] {
  const seen = new Set<string>();
  const found: MathExpression[] = [];
  for (const window of windows) {
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
      const key = `${expression.from}:${expression.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(expression);
    }
  }
  if (found.length <= MAX_RENDERED_EXPRESSIONS) return found;

  // In a pathological math-dense window, retain the expressions nearest to
  // what the user can actually see. The surrounding scan window still gives
  // ordinary documents enough look-ahead for seamless scrolling.
  const visible = view.visibleRanges;
  const distanceToViewport = (expression: MathExpression): number => {
    let distance = Number.POSITIVE_INFINITY;
    for (const range of visible) {
      if (expression.to >= range.from && expression.from <= range.to) {
        return 0;
      }
      distance = Math.min(
        distance,
        expression.to < range.from
          ? range.from - expression.to
          : expression.from - range.to,
      );
    }
    return distance;
  };
  return found
    .map((expression) => ({
      expression,
      distance: distanceToViewport(expression),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.expression.from - right.expression.from,
    )
    .slice(0, MAX_RENDERED_EXPRESSIONS)
    .map(({ expression }) => expression)
    .sort((left, right) => left.from - right.from);
}

class MathPreviewWidget extends WidgetType {
  private mounted = new WeakMap<HTMLElement, MountedMathPreview>();
  private liveHosts = new WeakSet<HTMLElement>();

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
    // Keep every preview inline in CodeMirror's content flow. A block widget
    // participates in the editor's virtual height map; rebuilding surrounding
    // diagnostic/semantic-token marks can then force the same source region to
    // be measured through two independent geometry layers. The compact display
    // treatment below preserves a live preview without owning line geometry.
    const dom = document.createElement("span");
    // Virtual scrolling may destroy a widget DOM node and later ask the same
    // WidgetType instance for a fresh node. Track each host independently so a
    // previous offscreen node cannot permanently poison future remounts.
    this.liveHosts.add(dom);
    const mounted = mountMathPreview(dom, {
      expression: this.expression,
      identity: this.identity,
      isCurrent: () => this.liveHosts.has(dom) && this.isCurrent(),
      // CodeMirror only mounts widgets in its rendered viewport. Rendering
      // synchronously here avoids painting a small loading label first and
      // replacing it with wider KaTeX on the next frame, which otherwise
      // reflows wrapped source lines during a fast scroll.
      eager: true,
    });
    this.mounted.set(dom, mounted);
    return dom;
  }

  destroy(dom: HTMLElement): void {
    this.liveHosts.delete(dom);
    this.mounted.get(dom)?.destroy();
    this.mounted.delete(dom);
  }

  ignoreEvent(): boolean {
    // Let CodeMirror place the caret around the non-editable decoration.
    return false;
  }

  eq(other: MathPreviewWidget): boolean {
    return (
      this.identity === other.identity &&
      this.sourceFrom === other.sourceFrom &&
      this.sourceTo === other.sourceTo &&
      this.expression.body === other.expression.body &&
      this.expression.display === other.expression.display &&
      this.expression.status === other.expression.status
    );
  }
}

function buildDecorations(
  view: EditorView,
  format: MathSourceFormat,
  identity: string,
  isCurrent: () => boolean,
  windows: Array<{ from: number; to: number }>,
): DecorationSet {
  const ranges = [];
  for (const expression of visibleExpressions(view, format, windows)) {
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
      }).range(expression.to),
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
    contain: "layout paint",
    color: "var(--cm-editor-fg, var(--foreground))",
    background:
      "color-mix(in srgb, var(--cm-editor-bg, var(--background)) 88%, var(--muted))",
    border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
    borderRadius: "6px",
    alignItems: "center",
    gap: "6px",
    minWidth: "0",
    maxWidth: "min(100%, 48rem)",
  },
  ".math-preview.is-inline": {
    display: "inline-flex",
    marginInline: "0.45em",
    padding: "0.12em 0.35em",
    verticalAlign: "middle",
  },
  ".math-preview.is-display": {
    display: "inline-flex",
    justifyContent: "center",
    height: "1.6em",
    marginInline: "0.45em",
    overflowX: "auto",
    overflowY: "hidden",
    padding: "0.12em 0.35em",
    verticalAlign: "middle",
  },
  ".math-preview.is-display .katex-display": {
    display: "inline-block",
    margin: "0",
  },
  ".math-preview-output": {
    minWidth: "0",
    maxWidth: "100%",
    overflowX: "auto",
    overflowY: "hidden",
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
      private coverage: Array<{ from: number; to: number }> = [];

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
              this.coverage = payload.coverage;
              appliedPreview = true;
            }
          }
        }

        if (update.docChanged) {
          this.revision++;
          this.decorations = Decoration.none;
          this.coverage = [];
          this.schedule(update.view, EDIT_PREVIEW_DEBOUNCE_MS);
        } else if (
          update.viewportChanged &&
          !appliedPreview &&
          !this.coversVisibleRanges(update.view)
        ) {
          this.schedule(update.view, VIEWPORT_PREVIEW_DEBOUNCE_MS);
        }
      }

      private coversVisibleRanges(view: EditorView) {
        return view.visibleRanges.every((visible) =>
          this.coverage.some(
            (covered) =>
              visible.from >= covered.from && visible.to <= covered.to,
          ),
        );
      }

      private schedule(
        view: EditorView,
        delay = EDIT_PREVIEW_DEBOUNCE_MS,
      ) {
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
          const scanWindows = viewportWindows(view, SCAN_OVERSCAN);
          const coverage = viewportWindows(view, COVERAGE_OVERSCAN);
          const identity = `${revision}`;
          const isCurrent = () =>
            !this.destroyed &&
            view.state.doc === doc &&
            this.revision === revision;
          const decorations = buildDecorations(
            view,
            format,
            identity,
            isCurrent,
            scanWindows,
          );
          if (
            !isCurrent() ||
            this.requestGeneration !== requestGeneration
          ) {
            return;
          }
          view.dispatch({
            effects: setMathDecorations.of({
              doc,
              revision,
              requestGeneration,
              coverage,
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
        this.coverage = [];
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
