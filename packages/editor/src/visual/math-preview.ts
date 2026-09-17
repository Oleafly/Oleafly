import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type Text,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip, type TooltipView } from "@codemirror/view";
import { hasMouseDownEffect, pointerSelectionTracking, selectionAtMouseDown } from "./selection";
import { renderMathExpression } from "../math-render";
import { type MathSourceFormat, scanMathExpressions } from "../math-source";
import { editorMessage } from "../messages";

export interface MathPreviewTarget {
  from: number;
  to: number;
  body: string;
  display: boolean;
}

export interface MathPreviewTooltipState {
  enabled: boolean;
  hidden: { from: number; to: number } | null;
  target: MathPreviewTarget | null;
  tooltip: Tooltip | null;
}

const MAX_WINDOW = 8_000;

const MATH_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "alignat",
  "alignat*",
  "displaymath",
  "eqnarray",
  "eqnarray*",
  "equation",
  "equation*",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "math",
  "multline",
  "multline*",
]);

const ENVIRONMENT_PATTERN = /\\begin\{([A-Za-z]+\*?)\}/gu;

export const mathPreviewFormat = Facet.define<MathSourceFormat, MathSourceFormat>({
  combine: (values) => values[0] ?? "latex",
});

export const mathPreviewEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values.length === 0 || values.every(Boolean),
});

export const setMathPreviewEnabled = StateEffect.define<boolean>();

export const hideMathPreview = StateEffect.define<null>();

export function setMathPreview(enabled: boolean): TransactionSpec {
  return { effects: setMathPreviewEnabled.of(enabled) };
}

function paragraphWindow(doc: Text, pos: number): { from: number; to: number } {
  const line = doc.lineAt(pos);
  let from = line.from;
  for (let number = line.number - 1; number >= 1; number--) {
    const previous = doc.line(number);
    if (previous.text.trim() === "" || line.from - previous.from > MAX_WINDOW) break;
    from = previous.from;
  }
  let to = line.to;
  for (let number = line.number + 1; number <= doc.lines; number++) {
    const next = doc.line(number);
    if (next.text.trim() === "" || next.to - line.to > MAX_WINDOW) break;
    to = next.to;
  }
  return { from, to };
}

function environmentMathAt(
  text: string,
  offset: number,
  pos: number,
): MathPreviewTarget | null {
  ENVIRONMENT_PATTERN.lastIndex = 0;
  for (
    let match = ENVIRONMENT_PATTERN.exec(text);
    match !== null;
    match = ENVIRONMENT_PATTERN.exec(text)
  ) {
    if (!MATH_ENVIRONMENTS.has(match[1])) continue;
    const closing = `\\end{${match[1]}}`;
    const end = text.indexOf(closing, match.index + match[0].length);
    if (end < 0) continue;
    const from = match.index + offset;
    const to = end + closing.length + offset;
    if (from <= pos && pos <= to) {
      return { from, to, body: text.slice(match.index, end + closing.length), display: true };
    }
  }
  return null;
}

export function mathPreviewTargetAt(
  state: EditorState,
  format: MathSourceFormat,
): MathPreviewTarget | null {
  const range = state.selection.main;
  if (!range.empty) return null;
  const pos = range.head;
  const window = paragraphWindow(state.doc, pos);
  const text = state.doc.sliceString(window.from, window.to);

  const environment = environmentMathAt(text, window.from, pos);
  if (environment) return environment.body.trim() === "" ? null : environment;

  for (const found of scanMathExpressions(text, { format })) {
    if (found.status !== "complete") continue;
    const from = found.from + window.from;
    const to = found.to + window.from;
    if (from <= pos && pos <= to) {
      if (found.body.trim() === "") return null;
      return { from, to, body: found.body, display: found.display };
    }
  }
  return null;
}

function overlaps(left: { from: number; to: number }, right: { from: number; to: number }): boolean {
  return left.from <= right.to && right.from <= left.to;
}

function paintMath(output: HTMLElement, target: MathPreviewTarget) {
  const result = renderMathExpression(target.body, target.display);
  if (result.status !== "ready") {
    const error = document.createElement("span");
    error.className = "ofl-visual-math-tooltip-error";
    error.setAttribute("role", "status");
    error.textContent = result.message ?? editorMessage("math.notRendered");
    output.replaceChildren(error);
    return;
  }
  const parsed = new DOMParser().parseFromString(result.html, "text/html");
  const nodes = Array.from(parsed.body.childNodes).map((node) =>
    document.importNode(node, true),
  );
  output.replaceChildren(...nodes);
}

function menuItem(label: string, description: string, shortcut: string | null): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "ofl-visual-math-tooltip-item";
  item.setAttribute("role", "menuitem");

  const heading = document.createElement("span");
  heading.className = "ofl-visual-math-tooltip-item-label";
  const name = document.createElement("span");
  name.textContent = label;
  heading.append(name);
  if (shortcut) {
    const key = document.createElement("span");
    key.className = "ofl-visual-math-tooltip-shortcut";
    key.textContent = shortcut;
    heading.append(key);
  }

  const detail = document.createElement("span");
  detail.className = "ofl-visual-math-tooltip-item-description";
  detail.textContent = description;

  item.append(heading, detail);
  return item;
}

function dotsIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  for (const cy of [5, 12, 19]) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", "12");
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "1.7");
    svg.append(dot);
  }
  return svg;
}

function createTooltipView(view: EditorView, target: MathPreviewTarget): TooltipView {
  const dom = document.createElement("div");
  dom.className = "ofl-visual-math-tooltip";

  const output = document.createElement("div");
  output.className = "ofl-visual-math-tooltip-output";
  paintMath(output, target);

  const menu = document.createElement("div");
  menu.className = "ofl-visual-math-tooltip-menu";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ofl-visual-math-tooltip-toggle";
  toggle.setAttribute("aria-label", editorMessage("math.preview.moreOptions"));
  toggle.setAttribute("aria-haspopup", "menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.append(dotsIcon());

  const list = document.createElement("div");
  list.className = "ofl-visual-math-tooltip-list";
  list.setAttribute("role", "menu");
  list.hidden = true;

  const hideItem = menuItem(
    editorMessage("math.preview.hide"),
    editorMessage("math.preview.hideDescription"),
    "Esc",
  );
  const disableItem = menuItem(
    editorMessage("math.preview.disable"),
    editorMessage("math.preview.disableDescription"),
    null,
  );
  list.append(hideItem, disableItem);
  menu.append(toggle, list);
  dom.append(output, menu);

  const closeMenu = () => {
    list.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onOutside, true);
  };
  const onOutside = (event: MouseEvent) => {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    closeMenu();
  };
  const openMenu = () => {
    list.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onOutside, true);
  };

  toggle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  toggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (list.hidden) openMenu();
    else closeMenu();
  });
  hideItem.addEventListener("click", (event) => {
    event.preventDefault();
    closeMenu();
    view.dispatch({ effects: hideMathPreview.of(null) });
  });
  disableItem.addEventListener("click", (event) => {
    event.preventDefault();
    closeMenu();
    view.dispatch({ effects: setMathPreviewEnabled.of(false) });
  });
  dom.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (list.hidden) view.dispatch({ effects: hideMathPreview.of(null) });
    else closeMenu();
  });

  return {
    dom,
    overlap: true,
    offset: { x: 0, y: 8 },
    destroy: closeMenu,
  };
}

function buildTooltip(target: MathPreviewTarget): Tooltip {
  return {
    pos: target.from,
    above: true,
    strictSide: true,
    arrow: false,
    create: (view) => createTooltipView(view, target),
  };
}

function resolveState(
  state: EditorState,
  format: MathSourceFormat,
  enabled: boolean,
  hidden: { from: number; to: number } | null,
): MathPreviewTooltipState {
  if (!enabled) return { enabled, hidden: null, target: null, tooltip: null };
  const target = mathPreviewTargetAt(state, format);
  if (!target) return { enabled, hidden: null, target: null, tooltip: null };
  if (hidden && overlaps(hidden, target)) {
    return { enabled, hidden, target, tooltip: null };
  }
  if (selectionAtMouseDown(state) !== undefined) {
    return { enabled, hidden: null, target, tooltip: null };
  }
  return { enabled, hidden: null, target, tooltip: buildTooltip(target) };
}

export const mathPreviewTooltipField = StateField.define<MathPreviewTooltipState>({
  create: (state) =>
    resolveState(state, state.facet(mathPreviewFormat), state.facet(mathPreviewEnabled), null),

  update(value, tr) {
    const format = tr.state.facet(mathPreviewFormat);
    let enabled = value.enabled;
    let hidden = value.hidden;
    let hideRequested = false;

    const before = tr.startState.facet(mathPreviewEnabled);
    const after = tr.state.facet(mathPreviewEnabled);
    if (before !== after) enabled = after;

    for (const effect of tr.effects) {
      if (effect.is(setMathPreviewEnabled)) enabled = effect.value;
      if (effect.is(hideMathPreview)) hideRequested = true;
    }

    if (hidden && tr.docChanged) {
      hidden = {
        from: tr.changes.mapPos(hidden.from, -1),
        to: tr.changes.mapPos(hidden.to, 1),
      };
    }

    if (hideRequested) {
      const target = value.target ?? mathPreviewTargetAt(tr.state, format);
      return {
        enabled,
        hidden: target ? { from: target.from, to: target.to } : null,
        target,
        tooltip: null,
      };
    }

    if (
      !tr.docChanged &&
      !tr.selection &&
      !hasMouseDownEffect(tr) &&
      enabled === value.enabled &&
      hidden === value.hidden &&
      format === tr.startState.facet(mathPreviewFormat)
    ) {
      return value;
    }

    return resolveState(tr.state, format, enabled, hidden);
  },

  provide: (self) => showTooltip.compute([self], (state) => state.field(self).tooltip),
});

const escapeHidesPreview = keymap.of([
  {
    key: "Escape",
    run: (view) => {
      if (!view.state.field(mathPreviewTooltipField, false)?.tooltip) return false;
      view.dispatch({ effects: hideMathPreview.of(null) });
      return true;
    },
  },
]);

export function mathPreviewTooltip(format: MathSourceFormat = "latex"): Extension {
  return [
    mathPreviewTooltipTheme,
    mathPreviewFormat.of(format),
    pointerSelectionTracking,
    mathPreviewTooltipField,
    escapeHidesPreview,
  ];
}

export function isMathPreviewEnabled(state: EditorState): boolean {
  return state.facet(mathPreviewEnabled);
}

const mathPreviewTooltipTheme = EditorView.baseTheme({
  ".ofl-visual-math-tooltip": {
    display: "flex",
    alignItems: "flex-start",
    gap: "6px",
    maxWidth: "min(40rem, 90vw)",
    padding: "6px 6px 6px 10px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--popover, var(--background))",
    color: "var(--popover-foreground, var(--foreground))",
    boxShadow: "0 2px 10px rgba(0, 0, 0, 0.14)",
  },
  ".ofl-visual-math-tooltip-output": {
    flex: "1 1 auto",
    minWidth: "0",
    overflowX: "auto",
    overflowY: "hidden",
    padding: "2px 0",
  },
  ".ofl-visual-math-tooltip-output .katex-display": {
    margin: "0",
  },
  ".ofl-visual-math-tooltip-error": {
    color: "var(--destructive)",
    font: "500 11px/1.4 var(--font-sans)",
  },
  ".ofl-visual-math-tooltip-menu": {
    position: "relative",
    flex: "0 0 auto",
  },
  ".ofl-visual-math-tooltip-toggle": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    padding: "0",
    border: "1px solid transparent",
    borderRadius: "5px",
    background: "transparent",
    color: "var(--muted-foreground)",
    cursor: "pointer",
    outline: "none",
  },
  ".ofl-visual-math-tooltip-toggle:hover": {
    background: "var(--accent)",
    color: "var(--foreground)",
  },
  ".ofl-visual-math-tooltip-toggle[aria-expanded='true']": {
    background: "var(--accent)",
    color: "var(--foreground)",
  },
  ".ofl-visual-math-tooltip-list": {
    position: "absolute",
    top: "28px",
    right: "0",
    zIndex: "2",
    display: "flex",
    flexDirection: "column",
    minWidth: "15rem",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid var(--border)",
    background: "var(--popover, var(--background))",
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.18)",
  },
  ".ofl-visual-math-tooltip-item": {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    padding: "6px 8px",
    border: "none",
    borderRadius: "5px",
    background: "transparent",
    color: "var(--popover-foreground, var(--foreground))",
    textAlign: "left",
    cursor: "pointer",
    outline: "none",
  },
  ".ofl-visual-math-tooltip-item:hover": {
    background: "var(--accent)",
  },
  ".ofl-visual-math-tooltip-item-label": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    font: "500 12px/1.4 var(--font-sans)",
  },
  ".ofl-visual-math-tooltip-item-description": {
    color: "var(--muted-foreground)",
    font: "400 11px/1.4 var(--font-sans)",
  },
  ".ofl-visual-math-tooltip-shortcut": {
    color: "var(--muted-foreground)",
    font: "500 10px/1.4 var(--font-mono)",
  },
});
