import { type EditorState, type Extension, Prec, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip, type TooltipView } from "@codemirror/view";
import { typstMathVersion } from "./math-render";
import { insideTypstMath, typstMathAt } from "./math-typst";
import { editorMessage } from "./messages";

type LatexToTypst = typeof import("./latex-to-typst-math");

export type LatexMathPasteKind = "delimited" | "body";

export interface TypstMathPasteOffer {
  from: number;
  to: number;
  text: string;
  kind: LatexMathPasteKind;
  tooltip: Tooltip;
}

const LATEX_MATH_ENVIRONMENT =
  /\\begin\{(?:equation|align|gather|multline|eqnarray|displaymath|flalign|alignat)\*?\}/u;
const LATEX_MATH_DELIMITERS: readonly (readonly [string, string])[] = [
  ["$$", "$$"],
  [String.raw`\[`, String.raw`\]`],
  [String.raw`\(`, String.raw`\)`],
];
const DOLLAR_SPAN = /(?<!\\)\$([^$]+)\$/gu;
const LATEX_SIGNAL = /\\[A-Za-z]{2,}|[\^_]\{/u;

let converter: Promise<LatexToTypst> | null = null;

function loadConverter(): Promise<LatexToTypst> {
  converter ??= import("./latex-to-typst-math").catch((error: unknown) => {
    converter = null;
    throw error;
  });
  return converter;
}

function hasDelimitedLatexMath(text: string): boolean {
  for (const [open, close] of LATEX_MATH_DELIMITERS) {
    const start = text.indexOf(open);
    if (start >= 0 && text.includes(close, start + open.length + 1)) return true;
  }
  return LATEX_MATH_ENVIRONMENT.test(text);
}

export function latexMathPasteKind(text: string, insideMath: boolean): LatexMathPasteKind | null {
  if (insideMath) return !text.includes("$") && LATEX_SIGNAL.test(text) ? "body" : null;
  if (hasDelimitedLatexMath(text)) return "delimited";
  for (const match of text.matchAll(DOLLAR_SPAN)) {
    if (LATEX_SIGNAL.test(match[1])) return "delimited";
  }
  return null;
}

const dismissOffer = StateEffect.define<null>();

function offerView(view: EditorView): TooltipView {
  const dom = document.createElement("div");
  dom.className = "cm-typst-paste-offer";
  dom.setAttribute("role", "group");
  dom.setAttribute("aria-label", editorMessage("typstMath.pasteOffer"));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-typst-paste-offer-button";
  button.textContent = editorMessage("typstMath.pasteAsTypst");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    void applyTypstMathPaste(view).catch(() => false);
  });
  dom.append(button);
  void loadConverter().catch(() => undefined);
  return { dom, offset: { x: 0, y: 4 } };
}

function offerFromPaste(tr: Transaction): TypstMathPasteOffer | null {
  const ranges: Array<{ fromA: number; toA: number; from: number; to: number; text: string }> = [];
  tr.changes.iterChanges((fromA, toA, from, to, inserted) => {
    ranges.push({ fromA, toA, from, to, text: inserted.toString() });
  });
  if (ranges.length !== 1 || !ranges[0].text.trim()) return null;
  const [range] = ranges;
  const kind = latexMathPasteKind(range.text, insideTypstMath(tr.startState, range.fromA, range.toA));
  if (!kind) return null;
  return {
    from: range.from,
    to: range.to,
    text: range.text,
    kind,
    tooltip: { pos: range.to, above: false, arrow: false, create: offerView },
  };
}

const offerField = StateField.define<TypstMathPasteOffer | null>({
  create: () => null,
  update(offer, tr) {
    if (tr.effects.some((effect) => effect.is(dismissOffer))) return null;
    if (tr.docChanged) return tr.isUserEvent("input.paste") ? offerFromPaste(tr) : null;
    if (offer && tr.selection) {
      const head = tr.state.selection.main.head;
      if (head < offer.from || head > offer.to) return null;
    }
    return offer;
  },
  provide: (field) => showTooltip.from(field, (offer) => offer?.tooltip ?? null),
});

export function typstMathPasteOffer(state: EditorState): TypstMathPasteOffer | null {
  return state.field(offerField, false) ?? null;
}

export async function applyTypstMathPaste(view: EditorView): Promise<boolean> {
  const offer = typstMathPasteOffer(view.state);
  if (!offer) return false;
  const { convertLatexMathInText, latexMathToTypst } = await loadConverter();
  if (typstMathPasteOffer(view.state) !== offer || view.state.doc.sliceString(offer.from, offer.to) !== offer.text) {
    return false;
  }
  const options = { typstVersion: typstMathVersion() };
  const insert =
    offer.kind === "body"
      ? latexMathToTypst(offer.text, options)
      : convertLatexMathInText(offer.text, options).text;
  if (!insert || insert === offer.text) {
    view.dispatch({ effects: dismissOffer.of(null) });
    return false;
  }
  view.dispatch({
    changes: { from: offer.from, to: offer.to, insert },
    selection: { anchor: offer.from + insert.length },
    effects: dismissOffer.of(null),
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

function bodyWithSpacing(body: string, converted: string): string {
  const leading = /^\s*/u.exec(body)?.[0] ?? "";
  const trailing = body.slice(body.trimEnd().length);
  return `${leading}${converted}${trailing}`;
}

interface SelectionConversion {
  from: number;
  to: number;
  text: string;
  convert(module: LatexToTypst, options: { typstVersion: string | null }): string;
}

function selectionConversion(state: EditorState): SelectionConversion | null {
  const range = state.selection.main;
  if (range.empty) {
    const equation = typstMathAt(state, range.head);
    if (!equation || !LATEX_SIGNAL.test(equation.body)) return null;
    return {
      from: equation.bodyFrom,
      to: equation.bodyTo,
      text: equation.body,
      convert: (module, options) => bodyWithSpacing(equation.body, module.latexMathToTypst(equation.body, options)),
    };
  }
  const text = state.sliceDoc(range.from, range.to);
  const base = { from: range.from, to: range.to, text };
  if (latexMathPasteKind(text, false) === "delimited") {
    return { ...base, convert: (module, options) => module.convertLatexMathInText(text, options).text };
  }
  if (!LATEX_SIGNAL.test(text)) return null;
  if (insideTypstMath(state, range.from, range.to)) {
    return { ...base, convert: (module, options) => bodyWithSpacing(text, module.latexMathToTypst(text, options)) };
  }
  return {
    ...base,
    convert: (module, options) => {
      const converted = module.latexMathToTypst(text, options);
      return converted ? `$${converted}$` : "";
    },
  };
}

export async function convertLatexMathSelection(view: EditorView): Promise<boolean> {
  const state = view.state;
  const conversion = selectionConversion(state);
  if (!conversion) return false;
  const module = await loadConverter();
  if (view.state.doc !== state.doc) return false;
  const insert = conversion.convert(module, { typstVersion: typstMathVersion() });
  if (!insert.trim() || insert === conversion.text) return false;
  view.dispatch({
    changes: { from: conversion.from, to: conversion.to, insert },
    selection: { anchor: conversion.from, head: conversion.from + insert.length },
    userEvent: "input",
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

const escapeDismissesOffer = Prec.high(
  keymap.of([
    {
      key: "Escape",
      run: (view) => {
        if (!typstMathPasteOffer(view.state)) return false;
        view.dispatch({ effects: dismissOffer.of(null) });
        return true;
      },
    },
  ]),
);

const offerTheme = EditorView.baseTheme({
  ".cm-tooltip.cm-typst-paste-offer, .cm-typst-paste-offer": {
    padding: "3px",
    borderRadius: "7px",
    border: "1px solid var(--border)",
    background: "var(--popover, var(--background))",
    color: "var(--popover-foreground, var(--foreground))",
    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.14)",
  },
  ".cm-typst-paste-offer-button": {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    border: "1px solid transparent",
    borderRadius: "5px",
    background: "transparent",
    color: "inherit",
    font: "500 12px/1.4 var(--font-sans)",
    cursor: "pointer",
    outline: "none",
  },
  ".cm-typst-paste-offer-button:hover, .cm-typst-paste-offer-button:focus-visible": {
    background: "var(--accent)",
  },
});

export function typstMathPaste(): Extension {
  return [offerField, escapeDismissesOffer, offerTheme];
}
