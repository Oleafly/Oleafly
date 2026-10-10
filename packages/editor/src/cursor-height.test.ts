// @vitest-environment jsdom

import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURSOR_EXTEND_PROPERTY, cursorFillsLine, cursorLineExtend } from "./cursor-height";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  vi.restoreAllMocks();
});

function mount(textHeights: Record<number, number>, lineHeight = 24) {
  const prefs = new Compartment();
  const view = new EditorView({
    state: EditorState.create({ doc: "short\nlonger line", extensions: [prefs.of([])] }),
    parent: document.body.appendChild(document.createElement("div")),
  });
  views.push(view);
  vi.spyOn(view, "defaultLineHeight", "get").mockReturnValue(lineHeight);
  vi.spyOn(view, "coordsAtPos").mockImplementation((pos) => {
    const height = textHeights[view.state.doc.lineAt(pos).number] ?? 16;
    return { left: 0, right: 0, top: 100, bottom: 100 + height };
  });
  return { view, prefs };
}

async function nextFrame() {
  await new Promise(requestAnimationFrame);
}

describe("cursorLineExtend", () => {
  it("splits the leading above and below the text", () => {
    expect(cursorLineExtend(24, 16)).toBe(4);
    expect(cursorLineExtend(30, 17)).toBe(6.5);
  });

  it("never shrinks a cursor taller than the line", () => {
    expect(cursorLineExtend(20, 26)).toBe(0);
  });
});

describe("cursorFillsLine", () => {
  it("pads the cursor out to the line height and follows the cursor's line", async () => {
    const { view, prefs } = mount({ 1: 16, 2: 20 });
    view.dispatch({ effects: prefs.reconfigure(cursorFillsLine()) });
    await nextFrame();
    expect(view.dom.style.getPropertyValue(CURSOR_EXTEND_PROPERTY)).toBe("4px");

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(2).from) });
    await nextFrame();
    expect(view.dom.style.getPropertyValue(CURSOR_EXTEND_PROPERTY)).toBe("2px");
  });

  it("drops the padding when the setting turns off", async () => {
    const { view, prefs } = mount({ 1: 16 });
    view.dispatch({ effects: prefs.reconfigure(cursorFillsLine()) });
    await nextFrame();
    expect(view.dom.style.getPropertyValue(CURSOR_EXTEND_PROPERTY)).toBe("4px");

    view.dispatch({ effects: prefs.reconfigure([]) });
    expect(view.dom.style.getPropertyValue(CURSOR_EXTEND_PROPERTY)).toBe("");
  });
});
