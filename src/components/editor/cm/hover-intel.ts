import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
import { renderMathExpression } from "@oleafly/editor/math-render";
import { auxNumberFor, type LabelNumber } from "@/lib/aux-numbers";
import { currentSourceProjectIntelligence } from "@/lib/project-intelligence/current";
import {
  definitionsForUse,
  referencesFor,
  safeLinePreview,
  symbolAt,
  type ProjectSymbol,
} from "@/lib/project-intelligence/selectors";
import type {
  ProjectDefinition,
  ProjectIntelligenceSnapshot,
  ProjectUse,
} from "@/lib/project-intelligence/types";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { loadAssetThumbnail, THUMBNAIL_TARGET_RE } from "./hover-asset";
import { enclosingMathEnvironment } from "./hover-math";

function isUse(symbol: ProjectSymbol): symbol is ProjectUse {
  return "definitionIds" in symbol;
}

function currentSymbol(
  view: EditorView,
  position: number,
): {
  snapshot: ProjectIntelligenceSnapshot;
  symbol: ProjectSymbol;
} | null {
  const current = currentSourceProjectIntelligence(
    view.state.doc.toString(),
  );
  if (!current) return null;
  const symbol =
    symbolAt(current.snapshot, current.path, position) ??
    (position > 0
      ? symbolAt(current.snapshot, current.path, position - 1)
      : null);
  return symbol ? { snapshot: current.snapshot, symbol } : null;
}

function isClickable(
  snapshot: ProjectIntelligenceSnapshot,
  symbol: ProjectSymbol,
): boolean {
  return !isUse(symbol) || definitionsForUse(snapshot, symbol.id).length > 0;
}

const setLink = StateEffect.define<{ from: number; to: number } | null>();
export const clearProjectHoverIntel = StateEffect.define<null>();

const linkField = StateField.define<{
  deco: DecorationSet;
  range: { from: number; to: number } | null;
}>({
  create: () => ({ deco: Decoration.none, range: null }),
  update(value, transaction) {
    let { deco, range } = value;
    deco = deco.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setLink)) {
        range = effect.value;
        deco = range
          ? Decoration.set([
              Decoration.mark({ class: "cm-cmd-link" }).range(
                range.from,
                range.to,
              ),
            ])
          : Decoration.none;
      }
      if (effect.is(clearProjectHoverIntel)) {
        range = null;
        deco = Decoration.none;
      }
    }
    return { deco, range };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.deco),
});

function updateLink(
  view: EditorView,
  range: { from: number; to: number } | null,
) {
  const current = view.state.field(linkField).range;
  const same =
    current === range ||
    (current &&
      range &&
      current.from === range.from &&
      current.to === range.to);
  if (!same) view.dispatch({ effects: setLink.of(range) });
}

const linkHandlers = EditorView.domEventHandlers({
  mousemove(event, view) {
    if (!(event.metaKey || event.ctrlKey)) {
      updateLink(view, null);
      return false;
    }
    const position = view.posAtCoords({
      x: event.clientX,
      y: event.clientY,
    });
    if (position == null) {
      updateLink(view, null);
      return false;
    }
    const current = currentSymbol(view, position);
    const range =
      current && isClickable(current.snapshot, current.symbol)
        ? current.symbol.location.range
        : null;
    updateLink(
      view,
      range ? { from: range.from, to: range.to } : null,
    );
    return false;
  },
  mouseleave(_event, view) {
    updateLink(view, null);
    return false;
  },
  keyup(event, view) {
    if (event.key === "Meta" || event.key === "Control") {
      updateLink(view, null);
    }
    return false;
  },
});

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function definitionDetail(
  definition: ProjectDefinition,
  texts: Readonly<Record<string, string>>,
): string {
  const preview = safeLinePreview(texts, definition.location, 180);
  const where = `${basename(definition.location.file)}:${definition.location.range.startLine}`;
  return [definition.detail, preview, where].filter(Boolean).join("\n");
}

interface HoverExtras {
  /** Display-math body rendered under the card (resolved label in math). */
  math?: string;
  /** Project-relative image/PDF path thumbnailed under the card. */
  assetPath?: string;
  /** Number from the last successful compile's .aux files. */
  aux?: LabelNumber;
}

function mathBodyForDefinition(
  definition: ProjectDefinition,
): string | undefined {
  if (definition.kind !== "label" && definition.kind !== "anchor") {
    return undefined;
  }
  const text = useIndexStore.getState().texts[definition.location.file];
  if (!text) return undefined;
  return enclosingMathEnvironment(text, definition.location.range.from)
    ?.body;
}

export function kindNoun(kind: string): string {
  switch (kind) {
    case "file":
      return i18n.t(($) => $.intelligence.symbolKind.file);
    case "section":
      return i18n.t(($) => $.intelligence.symbolKind.section);
    case "label":
      return i18n.t(($) => $.intelligence.symbolKind.label);
    case "anchor":
      return i18n.t(($) => $.intelligence.symbolKind.anchor);
    case "macro":
      return i18n.t(($) => $.intelligence.symbolKind.macro);
    case "environment":
      return i18n.t(($) => $.intelligence.symbolKind.environment);
    case "glossary":
      return i18n.t(($) => $.intelligence.symbolKind.glossary);
    case "bibentry":
      return i18n.t(($) => $.intelligence.symbolKind.bibentry);
    case "reference":
      return i18n.t(($) => $.intelligence.symbolKind.reference);
    case "citation":
      return i18n.t(($) => $.intelligence.symbolKind.citation);
    case "include":
      return i18n.t(($) => $.intelligence.symbolKind.include);
    case "import":
      return i18n.t(($) => $.intelligence.symbolKind.import);
    case "link":
      return i18n.t(($) => $.intelligence.symbolKind.link);
    case "asset":
      return i18n.t(($) => $.intelligence.symbolKind.asset);
    case "bibliography":
      return i18n.t(($) => $.intelligence.symbolKind.bibliography);
    default:
      return kind;
  }
}

function describe(
  snapshot: ProjectIntelligenceSnapshot,
  symbol: ProjectSymbol,
): { title: string; detail: string; extras?: HoverExtras } | null {
  if (isUse(symbol) && symbol.kind === "asset") {
    const target =
      symbol.resolution === "resolved" && symbol.target
        ? symbol.target
        : null;
    if (target && THUMBNAIL_TARGET_RE.test(target)) {
      return {
        title: i18n.t(($) => $.intelligence.hover.figure, { name: basename(target) }),
        detail: target,
        extras: { assetPath: target },
      };
    }
    return null;
  }
  if (isUse(symbol)) {
    const definitions = definitionsForUse(snapshot, symbol.id);
    const noun =
      symbol.kind === "citation" || symbol.kind === "macro" || symbol.kind === "environment"
        ? kindNoun(symbol.kind)
        : kindNoun("reference");
    if (definitions.length === 0) {
      return {
        title: i18n.t(($) => $.intelligence.hover.unresolved, { kind: noun, name: symbol.name }),
        detail: i18n.t(($) => $.intelligence.hover.unresolvedDetail),
      };
    }
    if (definitions.length > 1) {
      return {
        title: i18n.t(($) => $.intelligence.hover.duplicate, { kind: noun, name: symbol.name }),
        detail: i18n.t(($) => $.intelligence.hover.duplicateDetail, {
          count: definitions.length,
        }),
      };
    }
    const texts = useIndexStore.getState().texts;
    const definition = definitions[0];
    return {
      title: i18n.t(($) => $.intelligence.hover.definition, {
        kind: kindNoun(definition.kind),
        name: definition.name,
      }),
      detail: definitionDetail(definition, texts),
      extras: {
        math: mathBodyForDefinition(definition),
        aux: auxNumberFor(definition.name) ?? undefined,
      },
    };
  }

  const count = referencesFor(snapshot, symbol.id).length;
  if (count === 0) return null;
  return {
    title: i18n.t(($) => $.intelligence.hover.definition, {
      kind: kindNoun(symbol.kind),
      name: symbol.name,
    }),
    detail: i18n.t(($) => $.intelligence.hover.referenceCount, { count }),
    extras:
      symbol.kind === "label" || symbol.kind === "anchor"
        ? { aux: auxNumberFor(symbol.name) ?? undefined }
        : undefined,
  };
}

const projectHover = hoverTooltip((view, position) => {
  const current = currentSymbol(view, position);
  if (!current) return null;
  const info = describe(current.snapshot, current.symbol);
  if (!info) return null;
  return {
    pos: current.symbol.location.range.from,
    end: current.symbol.location.range.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-code-hover";
      const title = dom.appendChild(document.createElement("div"));
      title.className = "cm-code-hover-title";
      title.textContent = info.title;
      const extras = info.extras;
      if (extras?.math) {
        const rendered = renderMathExpression(extras.math, true);
        if (rendered.status === "ready") {
          const math = dom.appendChild(document.createElement("div"));
          math.className = "cm-code-hover-math";
          // renderMathExpression output is KaTeX HTML already sanitized
          // against SAFE_KATEX_ELEMENTS with trust disabled.
          math.innerHTML = rendered.html;
        }
      }
      if (info.detail) {
        const detail = dom.appendChild(document.createElement("div"));
        detail.className = "cm-code-hover-detail";
        detail.textContent = info.detail;
      }
      if (extras?.aux) {
        const aux = dom.appendChild(document.createElement("div"));
        aux.className = "cm-code-hover-aux";
        aux.textContent = i18n.t(($) => $.intelligence.hover.auxNumber, {
          number: extras.aux.number,
          page: extras.aux.page,
        });
      }
      if (extras?.assetPath) {
        const thumb = dom.appendChild(document.createElement("div"));
        thumb.className = "cm-code-hover-thumb";
        thumb.textContent = i18n.t(($) => $.intelligence.hover.loadingPreview);
        const projectId = useFilesStore.getState().projectId;
        if (projectId) {
          void loadAssetThumbnail(projectId, extras.assetPath).then(
            (url) => {
              if (!thumb.isConnected) return;
              if (!url) {
                thumb.textContent = i18n.t(($) => $.intelligence.hover.previewUnavailable);
                return;
              }
              const image = document.createElement("img");
              image.src = url;
              image.alt = "";
              thumb.replaceChildren(image);
            },
          );
        } else {
          thumb.textContent = i18n.t(($) => $.intelligence.hover.previewUnavailable);
        }
      }
      return { dom };
    },
  };
});

const theme = EditorView.baseTheme({
  ".cm-cmd-link": {
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    cursor: "pointer",
  },
  ".cm-code-hover": {
    maxWidth: "22rem",
    padding: "6px 8px",
    fontSize: "12px",
    lineHeight: "1.4",
    whiteSpace: "pre-wrap",
  },
  ".cm-code-hover-title": { fontWeight: "600" },
  ".cm-code-hover-detail": {
    marginTop: "3px",
    opacity: "0.75",
    fontFamily: "monospace",
    fontSize: "11px",
  },
  ".cm-code-hover-math": {
    marginTop: "4px",
    overflowX: "auto",
  },
  ".cm-code-hover-aux": {
    marginTop: "3px",
    opacity: "0.85",
    fontSize: "11px",
  },
  ".cm-code-hover-thumb": {
    marginTop: "4px",
    opacity: "0.9",
  },
  ".cm-code-hover-thumb img": {
    maxWidth: "20rem",
    maxHeight: "12rem",
    display: "block",
    borderRadius: "3px",
  },
});

export function hoverIntel() {
  return [linkField, linkHandlers, projectHover, theme];
}
