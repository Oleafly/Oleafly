// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anchoredPlacement, menuPlacement, SuggestionListbox, SuggestionOption } from "./SuggestionListbox";

const VIEWPORT = { width: 1000, height: 800 };
const LABEL = "Choices";
const OPTIONS = ["First", "Second"] as const;
const SIZE = { width: 352, height: 288 };

function fakeEditor(coordsAtPos: () => { left: number; top: number; bottom: number }): Editor {
  return { view: { coordsAtPos } } as unknown as Editor;
}

describe("anchoredPlacement", () => {
  it("opens below the anchor and keeps inside the right edge", () => {
    expect(anchoredPlacement({ left: 900, top: 100, bottom: 120 }, SIZE, 6, VIEWPORT)).toEqual({ left: 640, top: 126 });
    expect(anchoredPlacement({ left: -20, top: 100, bottom: 120 }, SIZE, 4, VIEWPORT)).toEqual({ left: 8, top: 124 });
  });

  it("opens above near the bottom edge, unless there is no room above either", () => {
    expect(anchoredPlacement({ left: 0, top: 700, bottom: 720 }, SIZE, 6, VIEWPORT)).toEqual({ left: 8, bottom: 106 });
    expect(anchoredPlacement({ left: 0, top: 200, bottom: 720 }, SIZE, 6, VIEWPORT)).toEqual({ left: 8, top: 726 });
  });
});

describe("menuPlacement", () => {
  it("falls back to the corner when the position has no coordinates", () => {
    const editor = fakeEditor(() => {
      throw new Error("no layout");
    });
    expect(menuPlacement(editor, 3, SIZE)).toEqual({ top: 8, left: 8 });
  });
});

describe("SuggestionListbox", () => {
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  });

  it("renders a listbox in the body that keeps focus in the editor and scrolls to the active option", () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const onHighlight = vi.fn();
    const onChoose = vi.fn();
    const editor = fakeEditor(() => ({ left: 10, top: 10, bottom: 30 }));
    render(
      <SuggestionListbox editor={editor} id="menu" label={LABEL} from={1} size={SIZE} activeId="menu-option-1" className="w-60" data-kind="x">
        {OPTIONS.map((option, index) => (
          <SuggestionOption key={option} id={`menu-option-${index}`} selected={index === 1} onHighlight={onHighlight} onChoose={onChoose}>
            {option}
          </SuggestionOption>
        ))}
      </SuggestionListbox>,
    );
    const listbox = screen.getByRole("listbox", { name: LABEL });
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox.dataset.kind).toBe("x");
    expect(listbox.style.top).toBe("34px");
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    expect(fireEvent.mouseDown(listbox)).toBe(false);
    const [first, second] = screen.getAllByRole("option");
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(second.className).toContain("bg-accent");
    fireEvent.mouseEnter(second);
    expect(onHighlight).not.toHaveBeenCalled();
    fireEvent.mouseEnter(first);
    expect(onHighlight).toHaveBeenCalledTimes(1);
    fireEvent.click(first);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});
