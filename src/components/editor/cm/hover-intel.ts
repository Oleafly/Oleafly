import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  hoverTooltip,
  type DecorationSet,
} from "@codemirror/view";
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
import { useIndexStore } from "@/store/project-index";

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

function describe(
  snapshot: ProjectIntelligenceSnapshot,
  symbol: ProjectSymbol,
): { title: string; detail: string } | null {
  if (isUse(symbol)) {
    const definitions = definitionsForUse(snapshot, symbol.id);
    const noun =
      symbol.kind === "citation"
        ? "citation"
        : symbol.kind === "macro"
          ? "macro"
          : symbol.kind === "environment"
            ? "environment"
            : "reference";
    if (definitions.length === 0) {
      return {
        title: `Unresolved ${noun}: ${symbol.name}`,
        detail: "No definition was found in the current project revision.",
      };
    }
    if (definitions.length > 1) {
      return {
        title: `Duplicate ${noun}: ${symbol.name}`,
        detail: `${definitions.length} definitions · press F12 to inspect every candidate`,
      };
    }
    const texts = useIndexStore.getState().texts;
    return {
      title: `${definitions[0].kind} · ${definitions[0].name}`,
      detail: definitionDetail(definitions[0], texts),
    };
  }

  const count = referencesFor(snapshot, symbol.id).length;
  if (count === 0) return null;
  return {
    title: `${symbol.kind} · ${symbol.name}`,
    detail: `${count} reference${count === 1 ? "" : "s"} in the current project revision`,
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
      if (info.detail) {
        const detail = dom.appendChild(document.createElement("div"));
        detail.className = "cm-code-hover-detail";
        detail.textContent = info.detail;
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
});

export function hoverIntel() {
  return [linkField, linkHandlers, projectHover, theme];
}
