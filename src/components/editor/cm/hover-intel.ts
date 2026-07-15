import { EditorView, Decoration, hoverTooltip, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import type { Sym } from "@/lib/index/types";

// Index may be a few ms stale here; fine for hover.
function symbolAtPos(pos: number): Sym | null {
  const path = useFilesStore.getState().activePath;
  if (!path) return null;
  return useIndexStore.getState().index?.symbolAt(path, pos) ?? null;
}

function clickable(sym: Sym): boolean {
  return !!useIndexStore.getState().index?.definitionFor(sym);
}

const setLink = StateEffect.define<{ from: number; to: number } | null>();

const linkField = StateField.define<{ deco: DecorationSet; range: { from: number; to: number } | null }>({
  create: () => ({ deco: Decoration.none, range: null }),
  update(value, tr) {
    let { deco, range } = value;
    // Keep decorations aligned with edits.
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setLink)) {
        range = e.value;
        deco = range
          ? Decoration.set([Decoration.mark({ class: "cm-cmd-link" }).range(range.from, range.to)])
          : Decoration.none;
      }
    }
    return { deco, range };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

function updateLink(view: EditorView, range: { from: number; to: number } | null) {
  const cur = view.state.field(linkField).range;
  const same = cur === range || (cur && range && cur.from === range.from && cur.to === range.to);
  if (same) return;
  view.dispatch({ effects: setLink.of(range) });
}

const linkHandlers = EditorView.domEventHandlers({
  mousemove(event, view) {
    if (!(event.metaKey || event.ctrlKey)) {
      updateLink(view, null);
      return false;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) {
      updateLink(view, null);
      return false;
    }
    const sym = symbolAtPos(pos);
    updateLink(view, sym && clickable(sym) ? { from: sym.from, to: sym.to } : null);
    return false;
  },
  mouseleave(_event, view) {
    updateLink(view, null);
    return false;
  },
  keyup(event, view) {
    if (event.key === "Meta" || event.key === "Control") updateLink(view, null);
    return false;
  },
});

function previewLine(file: string, line: number): string {
  const text = useIndexStore.getState().texts[file];
  return (text?.split("\n")[line - 1] ?? "").trim();
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function describe(sym: Sym): { title: string; detail: string } | null {
  const index = useIndexStore.getState().index;
  if (!index) return null;

  if (sym.kind === "ref" || sym.kind === "cite" || sym.kind === "atuse" || sym.kind === "macrouse" || sym.kind === "glossaryuse" || sym.kind === "envuse") {
    const def = index.definitionFor(sym);
    if (def) {
      const where = `${basename(def.file)}:${def.line}`;
      return { title: `${def.kind} · ${def.name}`, detail: `${previewLine(def.file, def.line)}\n${where}` };
    }
    // Only call it unresolved if that definition kind exists in the project;
    // otherwise the index may still be loading (or there's no .bib yet).
    const TARGETS: Record<string, string[]> = {
      cite: ["bibentry"],
      ref: ["label"],
      macrouse: ["macro"],
      glossaryuse: ["glossary"],
      envuse: ["theorem", "environment"],
    };
    const noun = sym.kind === "cite" ? "citation" : sym.kind === "macrouse" ? "macro" : "reference";
    const anyTargets = index.defs.some((d) => (TARGETS[sym.kind] ?? []).includes(d.kind));
    if (!anyTargets) return { title: `${noun} · ${sym.name}`, detail: "" };
    return { title: `Unresolved ${noun}: ${sym.name}`, detail: "No definition found in the project." };
  }
  if (sym.kind === "inputedge") {
    return { title: `includes ${sym.target ?? sym.name}`, detail: "" };
  }
  // A definition: show how many references point at it.
  const refs = index.allReferences(sym).filter((s) => s !== sym);
  return { title: `${sym.kind} · ${sym.name}`, detail: `${refs.length} reference${refs.length === 1 ? "" : "s"} in the project` };
}

const codeHover = hoverTooltip((_view, pos) => {
  const sym = symbolAtPos(pos);
  if (!sym) return null;
  const info = describe(sym);
  if (!info) return null;
  return {
    pos: sym.from,
    end: sym.to,
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
  ".cm-cmd-link": { textDecoration: "underline", textUnderlineOffset: "2px", cursor: "pointer" },
  ".cm-code-hover": {
    maxWidth: "22rem",
    padding: "6px 8px",
    fontSize: "12px",
    lineHeight: "1.4",
    whiteSpace: "pre-wrap",
  },
  ".cm-code-hover-title": { fontWeight: "600" },
  ".cm-code-hover-detail": { marginTop: "3px", opacity: "0.75", fontFamily: "monospace", fontSize: "11px" },
});

export function hoverIntel() {
  return [linkField, linkHandlers, codeHover, theme];
}
