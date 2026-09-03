import {
  mountMathPreview,
  type MountedMathPreview,
} from "@oleafly/editor/math-render";
import {
  scanMathExpressions,
  type MathExpression,
  type MathSourceFormat,
} from "@oleafly/editor/math-source";
import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@tiptap/pm/view";
import { useFilesStore } from "@/store/files";

interface VisualMathState {
  decorations: DecorationSet;
  dirty: boolean;
  revision: number;
  requestGeneration: number;
}

type VisualMathMeta =
  | { type: "refresh" }
  | {
      type: "paint";
      doc: ProseMirrorNode;
      revision: number;
      requestGeneration: number;
      decorations: DecorationSet;
    };

interface PreviewTarget {
  expression: MathExpression;
  sourceFrom: number;
  sourceTo: number;
  anchor: number;
  rawInlinePosition?: number;
}

const VISUAL_PREVIEW_DEBOUNCE_MS = 180;
const VISUAL_OVERSCAN_POSITIONS = 1_500;
const visualMathPreviewKey = new PluginKey<VisualMathState>(
  "visualMathPreview",
);
const mountedPreviews = new WeakMap<Node, MountedMathPreview>();

function formatForPath(path: string | null): MathSourceFormat | null {
  if (!path) return null;
  if (/\.(?:tex|latex|ltx)$/iu.test(path)) return "latex";
  if (/\.(?:md|markdown)$/iu.test(path)) return "markdown";
  return null;
}

function currentDocumentIdentity(): {
  path: string;
  format: MathSourceFormat;
} | null {
  const path = useFilesStore.getState().activePath;
  const format = formatForPath(path);
  return path && format ? { path, format } : null;
}

function visibleDocumentRange(view: EditorView): { from: number; to: number } {
  // jsdom does not implement hit-testing. Keep the preview plugin inert in
  // headless environments rather than allowing ProseMirror's posAtCoords()
  // to throw from its viewport probe.
  if (
    typeof document.elementFromPoint !== "function" ||
    !view.dom.isConnected
  ) {
    return { from: 0, to: view.state.doc.content.size };
  }
  const editorRect = view.dom.getBoundingClientRect();
  const scrollRoot = view.dom.closest<HTMLElement>(".wysiwyg-content");
  const rootRect = scrollRoot?.getBoundingClientRect() ?? editorRect;
  const top = Math.max(editorRect.top, rootRect.top);
  const bottom = Math.min(editorRect.bottom, rootRect.bottom);
  const horizontal = Math.min(
    Math.max(editorRect.left + 8, rootRect.left + 8),
    Math.max(editorRect.left + 8, editorRect.right - 8),
  );
  const topPosition = view.posAtCoords({
    left: horizontal,
    top: Math.min(bottom - 1, top + 1),
  });
  const bottomPosition = view.posAtCoords({
    left: horizontal,
    top: Math.max(top + 1, bottom - 1),
  });
  return {
    from: Math.max(
      0,
      (topPosition?.pos ?? 0) - VISUAL_OVERSCAN_POSITIONS,
    ),
    to: Math.min(
      view.state.doc.content.size,
      (bottomPosition?.pos ?? view.state.doc.content.size) +
        VISUAL_OVERSCAN_POSITIONS,
    ),
  };
}

function targetsForDoc(
  doc: ProseMirrorNode,
  format: MathSourceFormat,
  viewport: { from: number; to: number },
): {
  targets: PreviewTarget[];
  sourceDecorations: Decoration[];
} {
  const targets: PreviewTarget[] = [];
  const sourceDecorations: Decoration[] = [];

  doc.descendants((node, position) => {
    const nodeEnd = position + node.nodeSize;
    if (nodeEnd < viewport.from || position > viewport.to) return false;

    if (node.type.name === "rawInline") {
      const source = String(node.attrs.source ?? "");
      const expressions = scanMathExpressions(source, {
        format,
      });
      if (expressions.length === 0) return false;
      sourceDecorations.push(
        Decoration.node(position, nodeEnd, {
          class: `wysiwyg-math-source${
            expressions.some((expression) => expression.status === "incomplete")
              ? " is-incomplete"
              : ""
          }`,
          "data-math-source": "true",
        }),
      );
      for (const expression of expressions) {
        targets.push({
          expression,
          sourceFrom: position,
          sourceTo: nodeEnd,
          anchor: nodeEnd,
          rawInlinePosition: position,
        });
      }
      return false;
    }

    if (!node.isText || !node.text) return true;
    if (node.marks.some((mark) => mark.type.name === "code")) return false;

    for (const expression of scanMathExpressions(node.text, { format })) {
      const sourceFrom = position + expression.from;
      const sourceTo = position + expression.to;
      sourceDecorations.push(
        Decoration.inline(sourceFrom, sourceTo, {
          class: `wysiwyg-math-source${
            expression.status === "incomplete" ? " is-incomplete" : ""
          }`,
          "data-math-source": expression.delimiter,
          ...(expression.status === "incomplete"
            ? { "aria-invalid": "true" }
            : {}),
        }),
      );
      targets.push({
        expression,
        sourceFrom,
        sourceTo,
        anchor: sourceTo,
      });
    }
    return false;
  });

  return { targets, sourceDecorations };
}

function previewWidget(
  view: EditorView,
  target: PreviewTarget,
  identity: string,
  isCurrent: () => boolean,
  eager: boolean,
): Decoration {
  let rawSourceNode: HTMLElement | null = null;
  return Decoration.widget(
    target.anchor,
    () => {
      const dom = document.createElement("span");
      dom.classList.add("wysiwyg-math-preview");
      if (target.rawInlinePosition !== undefined) {
        const sourceNode = view.nodeDOM(target.rawInlinePosition);
        rawSourceNode =
          sourceNode instanceof HTMLElement ? sourceNode : null;
      }
      const mounted = mountMathPreview(dom, {
        expression: target.expression,
        identity,
        isCurrent,
        eager,
        errorDisplay: "hidden",
        onPaint: (result) => {
          if (result.status === "ready") {
            rawSourceNode?.setAttribute(
              "data-math-preview-mounted",
              "true",
            );
          } else {
            rawSourceNode?.removeAttribute(
              "data-math-preview-mounted",
            );
          }
        },
      });
      mountedPreviews.set(dom, mounted);
      if (target.rawInlinePosition !== undefined) {
        const rawInlinePosition = target.rawInlinePosition;
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "math-preview-edit";
        edit.textContent = "Edit";
        edit.setAttribute("aria-label", "Edit exact math source");
        edit.addEventListener("click", () => {
          const sourceNode = view.nodeDOM(rawInlinePosition);
          (
            sourceNode instanceof HTMLElement
              ? sourceNode.querySelector<HTMLButtonElement>(
                  ".raw-inline-edit",
                )
              : null
          )?.click();
        });
        dom.append(edit);
      }
      return dom;
    },
    {
      side: 1,
      relaxedSide: true,
      key: `${identity}:${target.anchor}:${target.expression.source}`,
      stopEvent: (event) =>
        event.target instanceof Element &&
        !!event.target.closest(".math-preview-edit"),
      destroy: (node) => {
        mountedPreviews.get(node)?.destroy();
        mountedPreviews.delete(node);
        rawSourceNode?.removeAttribute("data-math-preview-mounted");
        rawSourceNode = null;
      },
    },
  );
}

function decorationsForView(
  view: EditorView,
  format: MathSourceFormat,
  identity: string,
  isCurrent: () => boolean,
): DecorationSet {
  const viewport = visibleDocumentRange(view);
  const { targets, sourceDecorations } = targetsForDoc(
    view.state.doc,
    format,
    viewport,
  );
  const widgets = targets.map((target, index) =>
    previewWidget(view, target, identity, isCurrent, index < 24),
  );
  return DecorationSet.create(view.state.doc, [
    ...sourceDecorations,
    ...widgets,
  ]);
}

function applyVisualMathState(
  transaction: Transaction,
  previous: VisualMathState,
  nextState: EditorState,
): VisualMathState {
  const meta = transaction.getMeta(
    visualMathPreviewKey,
  ) as VisualMathMeta | null;
  if (transaction.docChanged || meta?.type === "refresh") {
    return {
      decorations: DecorationSet.empty,
      dirty: true,
      revision: previous.revision + 1,
      requestGeneration: previous.requestGeneration,
    };
  }
  if (
    meta?.type === "paint" &&
    meta.doc === nextState.doc &&
    meta.revision === previous.revision &&
    meta.requestGeneration >= previous.requestGeneration
  ) {
    return {
      decorations: meta.decorations,
      dirty: false,
      revision: previous.revision,
      requestGeneration: meta.requestGeneration,
    };
  }
  return previous;
}

export const VisualMathPreview = Extension.create({
  name: "visualMathPreview",

  addProseMirrorPlugins() {
    return [
      new Plugin<VisualMathState>({
        key: visualMathPreviewKey,
        state: {
          init: () => ({
            decorations: DecorationSet.empty,
            dirty: true,
            revision: 0,
            requestGeneration: 0,
          }),
          apply: (transaction, previous, _oldState, nextState) =>
            applyVisualMathState(transaction, previous, nextState),
        },
        props: {
          decorations(state) {
            return (
              visualMathPreviewKey.getState(state)?.decorations ??
              DecorationSet.empty
            );
          },
        },
        view(editorView) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let requestGeneration = 0;
          let destroyed = false;
          const scrollRoot =
            editorView.dom.closest<HTMLElement>(".wysiwyg-content");

          const schedule = (delay = VISUAL_PREVIEW_DEBOUNCE_MS) => {
            if (timer !== null) clearTimeout(timer);
            const pluginState = visualMathPreviewKey.getState(editorView.state);
            if (!pluginState) return;
            const doc = editorView.state.doc;
            const revision = pluginState.revision;
            const documentIdentity = currentDocumentIdentity();
            const request = ++requestGeneration;
            timer = setTimeout(() => {
              timer = null;
              const currentState = visualMathPreviewKey.getState(
                editorView.state,
              );
              const currentDocument = currentDocumentIdentity();
              if (
                destroyed ||
                editorView.state.doc !== doc ||
                currentState?.revision !== revision ||
                requestGeneration !== request ||
                currentDocument?.path !== documentIdentity?.path ||
                currentDocument?.format !== documentIdentity?.format
              ) {
                return;
              }

              // Viewport/resize scheduling invalidates the previous
              // `isCurrent` closure. Include its request generation in the
              // widget key so ProseMirror cannot retain the invalidated DOM
              // merely because the expression and document revision match.
              const identity = `${documentIdentity?.path ?? "unsupported"}:${revision}:${request}`;
              const isCurrent = () => {
                const latestState = visualMathPreviewKey.getState(
                  editorView.state,
                );
                const latestDocument = currentDocumentIdentity();
                return (
                  !destroyed &&
                  editorView.state.doc === doc &&
                  latestState?.revision === revision &&
                  requestGeneration === request &&
                  latestDocument?.path === documentIdentity?.path &&
                  latestDocument?.format === documentIdentity?.format
                );
              };
              const decorations = documentIdentity
                ? decorationsForView(
                    editorView,
                    documentIdentity.format,
                    identity,
                    isCurrent,
                  )
                : DecorationSet.empty;
              if (!isCurrent()) return;
              editorView.dispatch(
                editorView.state.tr.setMeta(visualMathPreviewKey, {
                  type: "paint",
                  doc,
                  revision,
                  requestGeneration: request,
                  decorations,
                } satisfies VisualMathMeta),
              );
            }, delay);
          };

          const onViewportChange = () => schedule();
          scrollRoot?.addEventListener("scroll", onViewportChange, {
            passive: true,
          });
          window.addEventListener("resize", onViewportChange, {
            passive: true,
          });
          let observedWidth = editorView.dom.getBoundingClientRect().width;
          const resizeObserver =
            typeof ResizeObserver === "function"
              ? new ResizeObserver((entries) => {
                  const width =
                    entries[entries.length - 1]?.contentRect.width ??
                    editorView.dom.getBoundingClientRect().width;
                  if (Math.abs(width - observedWidth) < 1) return;
                  observedWidth = width;
                  onViewportChange();
                })
              : null;
          resizeObserver?.observe(editorView.dom);
          schedule(0);

          return {
            update(view, previousState) {
              const current = visualMathPreviewKey.getState(view.state);
              const previous = visualMathPreviewKey.getState(previousState);
              if (
                view.state.doc !== previousState.doc ||
                current?.revision !== previous?.revision ||
                (current?.dirty && !previous?.dirty)
              ) {
                schedule();
              }
            },
            destroy() {
              destroyed = true;
              requestGeneration++;
              if (timer !== null) clearTimeout(timer);
              timer = null;
              scrollRoot?.removeEventListener("scroll", onViewportChange);
              window.removeEventListener("resize", onViewportChange);
              resizeObserver?.disconnect();
            },
          };
        },
      }),
    ];
  },
});

export function refreshVisualMathPreview(editor: Editor) {
  editor.view.dispatch(
    editor.state.tr.setMeta(visualMathPreviewKey, {
      type: "refresh",
    } satisfies VisualMathMeta),
  );
}
