// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { openContextMenuFromKey } from "./context-menu-key";

function row() {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => ({ left: 10, top: 20, width: 41, height: 12, right: 51, bottom: 32.4, x: 10, y: 20, toJSON: () => ({}) });
  const opened: MouseEvent[] = [];
  element.addEventListener("contextmenu", (event) => opened.push(event));
  return { element, opened };
}

function key(init: { key: string; shiftKey?: boolean }) {
  return { key: init.key, shiftKey: init.shiftKey ?? false, preventDefault: vi.fn() };
}

describe("opening a context menu from the keyboard", () => {
  it.each([{ key: "ContextMenu" }, { key: "F10", shiftKey: true }])("opens below the middle of the row on %o", (init) => {
    const { element, opened } = row();
    const event = key(init);
    openContextMenuFromKey(event, element);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ clientX: 31, clientY: 32, bubbles: true, cancelable: true });
  });

  it.each([{ key: "F10" }, { key: "Enter" }, { key: "Escape", shiftKey: true }])("leaves %o alone", (init) => {
    const { element, opened } = row();
    const event = key(init);
    openContextMenuFromKey(event, element);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(opened).toHaveLength(0);
  });

  it("still claims the key when the row is gone", () => {
    const event = key({ key: "ContextMenu" });
    openContextMenuFromKey(event, null);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
