// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  hideMathPreview,
  mathPreviewEnabled,
  mathPreviewTargetAt,
  mathPreviewTooltip,
  mathPreviewTooltipField,
  setMathPreview,
  setMathPreviewEnabled,
} from "./math-preview";

let mounted: EditorView | null = null;

afterEach(() => {
  mounted?.destroy();
  mounted = null;
  document.body.replaceChildren();
});

function stateFor(doc: string, cursor: number, enabled?: boolean): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions:
      enabled === undefined
        ? [mathPreviewTooltip("latex")]
        : [mathPreviewTooltip("latex"), mathPreviewEnabled.of(enabled)],
  });
}

function preview(state: EditorState) {
  return state.field(mathPreviewTooltipField);
}

function mount(state: EditorState): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  mounted = new EditorView({ state, parent });
  return mounted;
}

const INLINE = String.raw`Text with $E = mc^2$ inside.`;
const INLINE_CURSOR = INLINE.indexOf("E");
const OUTSIDE = 2;

describe("mathPreviewTargetAt", () => {
  it("finds the inline expression around the cursor", () => {
    const target = mathPreviewTargetAt(stateFor(INLINE, INLINE_CURSOR), "latex");
    expect(target).toEqual({
      from: INLINE.indexOf("$"),
      to: INLINE.lastIndexOf("$") + 1,
      body: "E = mc^2",
      display: false,
    });
  });

  it("finds a display environment around the cursor", () => {
    const doc = [String.raw`\begin{equation}`, "a = b", String.raw`\end{equation}`].join("\n");
    const target = mathPreviewTargetAt(stateFor(doc, doc.indexOf("a = b")), "latex");
    expect(target?.display).toBe(true);
    expect(target?.from).toBe(0);
    expect(target?.to).toBe(doc.length);
    expect(target?.body).toBe(doc);
  });

  it("ignores a non-empty selection", () => {
    const state = EditorState.create({
      doc: INLINE,
      selection: { anchor: INLINE_CURSOR, head: INLINE_CURSOR + 3 },
    });
    expect(mathPreviewTargetAt(state, "latex")).toBeNull();
  });

  it("ignores a cursor outside math", () => {
    expect(mathPreviewTargetAt(stateFor(INLINE, OUTSIDE), "latex")).toBeNull();
  });
});

describe("math preview tooltip state", () => {
  it("shows a tooltip while the cursor sits in math", () => {
    expect(preview(stateFor(INLINE, INLINE_CURSOR)).tooltip).not.toBeNull();
    expect(preview(stateFor(INLINE, OUTSIDE)).tooltip).toBeNull();
  });

  it("hides until the cursor leaves the math", () => {
    const shown = stateFor(INLINE, INLINE_CURSOR);
    const hiddenState = shown.update({ effects: hideMathPreview.of(null) }).state;
    expect(preview(hiddenState).tooltip).toBeNull();

    const stillInside = hiddenState.update({
      selection: { anchor: INLINE_CURSOR + 1 },
    }).state;
    expect(preview(stillInside).tooltip).toBeNull();

    const outside = stillInside.update({ selection: { anchor: OUTSIDE } }).state;
    expect(preview(outside).tooltip).toBeNull();

    const back = outside.update({ selection: { anchor: INLINE_CURSOR } }).state;
    expect(preview(back).tooltip).not.toBeNull();
  });

  it("stays off once disabled, wherever the cursor goes", () => {
    const shown = stateFor(INLINE, INLINE_CURSOR);
    const disabled = shown.update({ effects: setMathPreviewEnabled.of(false) }).state;
    expect(preview(disabled).enabled).toBe(false);
    expect(preview(disabled).tooltip).toBeNull();

    const moved = disabled.update({ selection: { anchor: OUTSIDE } }).state;
    const backInside = moved.update({ selection: { anchor: INLINE_CURSOR } }).state;
    expect(preview(backInside).tooltip).toBeNull();

    const reenabled = backInside.update(setMathPreview(true)).state;
    expect(preview(reenabled).enabled).toBe(true);
    expect(preview(reenabled).tooltip).not.toBeNull();
  });

  it("honours the enabled facet supplied by the host", () => {
    expect(preview(stateFor(INLINE, INLINE_CURSOR, false)).tooltip).toBeNull();
    expect(preview(stateFor(INLINE, INLINE_CURSOR, true)).tooltip).not.toBeNull();
  });
});

describe("math preview tooltip view", () => {
  function tooltipDom(view: EditorView) {
    const tooltip = preview(view.state).tooltip;
    expect(tooltip).not.toBeNull();
    const created = tooltip?.create(view);
    expect(created).toBeDefined();
    return created?.dom as HTMLElement;
  }

  it("renders a display environment through KaTeX", () => {
    const doc = [String.raw`\begin{equation}`, "a = b", String.raw`\end{equation}`].join("\n");
    const view = mount(stateFor(doc, doc.indexOf("a = b")));
    const dom = tooltipDom(view);
    expect(dom.querySelector(".ofl-visual-math-tooltip-error")).toBeNull();
    expect(dom.querySelector(".katex")).not.toBeNull();
  });

  it("renders the math and a menu with hide and disable", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const dom = tooltipDom(view);

    expect(dom.querySelector(".katex")).not.toBeNull();
    const items = dom.querySelectorAll<HTMLButtonElement>(".ofl-visual-math-tooltip-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("math.preview.hide");
    expect(items[0].textContent).toContain("Esc");
    expect(items[1].textContent).toContain("math.preview.disable");

    const toggle = dom.querySelector<HTMLButtonElement>(".ofl-visual-math-tooltip-toggle");
    expect(toggle?.getAttribute("aria-label")).toBe("math.preview.moreOptions");
    const list = dom.querySelector<HTMLElement>(".ofl-visual-math-tooltip-list");
    expect(list?.hidden).toBe(true);
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(list?.hidden).toBe(false);
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("hides the preview from the menu and from Escape", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const dom = tooltipDom(view);
    const items = dom.querySelectorAll<HTMLButtonElement>(".ofl-visual-math-tooltip-item");

    items[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(preview(view.state).tooltip).toBeNull();
    expect(preview(view.state).enabled).toBe(true);

    view.dispatch({ selection: { anchor: OUTSIDE } });
    view.dispatch({ selection: { anchor: INLINE_CURSOR } });
    expect(preview(view.state).tooltip).not.toBeNull();

    tooltipDom(view).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(preview(view.state).tooltip).toBeNull();
  });

  it("disables the preview from the menu", () => {
    const view = mount(stateFor(INLINE, INLINE_CURSOR));
    const items = tooltipDom(view).querySelectorAll<HTMLButtonElement>(
      ".ofl-visual-math-tooltip-item",
    );

    items[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(preview(view.state).enabled).toBe(false);
    expect(preview(view.state).tooltip).toBeNull();
  });
});
