// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachSplitResizer, clampSplitRatio, readSplitRatio } from "./split-resizer";

const globalsCss = readFileSync(
  resolve(__dirname, "../../../styles/globals.css"),
  "utf8",
);

function ruleFor(selector: string): string {
  const start = globalsCss.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`globals.css has no rule for ${selector}`);
  }
  const end = globalsCss.indexOf("}", start);
  if (end < 0) {
    throw new Error(`globals.css rule for ${selector} is never closed`);
  }
  return globalsCss.slice(start, end);
}

function mergeHost() {
  const host = document.createElement("div");
  const editors = document.createElement("div");
  editors.className = "cm-mergeViewEditors";
  const first = document.createElement("div");
  first.className = "cm-mergeViewEditor cm-merge-a";
  const gutter = document.createElement("div");
  gutter.className = "cm-merge-revert";
  const second = document.createElement("div");
  second.className = "cm-mergeViewEditor cm-merge-b";
  editors.append(first, gutter, second);
  host.append(editors);
  document.body.append(host);
  return { host, editors, first, second };
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});

describe("diff split resizer", () => {
  it("clamps ratios to the allowed range and defaults to half", () => {
    expect(clampSplitRatio(5)).toBe(20);
    expect(clampSplitRatio(95)).toBe(80);
    expect(clampSplitRatio(Number.NaN)).toBe(50);
    expect(readSplitRatio()).toBe(50);
  });

  it("adds a keyboard resizable separator that persists the ratio", () => {
    const { host, first, second } = mergeHost();
    const detach = attachSplitResizer(host);
    const handle = host.querySelector<HTMLElement>('[role="separator"]');
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("aria-label")).toBe("Resize diff panes");
    expect(first.style.flex).toBe("0 0 50%");
    expect(second.style.flex).toBe("1 1 0%");

    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(first.style.flex).toBe("0 0 55%");
    expect(window.localStorage.getItem("oleafly.diff.splitRatio")).toBe("55");
    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(first.style.flex).toBe("0 0 80%");

    detach();
    expect(host.querySelector('[role="separator"]')).toBeNull();
    expect(first.style.flex).toBe("");
  });

  it("restores a stored ratio on the next attach", () => {
    window.localStorage.setItem("oleafly.diff.splitRatio", "35");
    const { host, first } = mergeHost();
    attachSplitResizer(host);
    expect(first.style.flex).toBe("0 0 35%");
  });

  it("does nothing without two panes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const detach = attachSplitResizer(host);
    expect(host.querySelector('[role="separator"]')).toBeNull();
    detach();
  });
});

describe("diff split resizer interaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function separator(host: HTMLElement): HTMLElement {
    const handle = host.querySelector<HTMLElement>('[role="separator"]');
    if (!handle) throw new Error("no separator");
    return handle;
  }

  function pointer(type: string, init: { button?: number; clientX?: number }) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    return event as unknown as PointerEvent;
  }

  it("follows a primary-button drag until the pointer is released", () => {
    const { host, editors, first } = mergeHost();
    vi.spyOn(editors, "getBoundingClientRect").mockReturnValue({ left: 100, width: 400 } as DOMRect);
    attachSplitResizer(host);
    const handle = separator(host);

    const down = pointer("pointerdown", { button: 0 });
    handle.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(handle.dataset.dragging).toBe("true");
    window.dispatchEvent(pointer("pointermove", { clientX: 260 }));
    expect(first.style.flex).toBe("0 0 40%");
    expect(handle.getAttribute("aria-valuenow")).toBe("40");

    window.dispatchEvent(pointer("pointerup", {}));
    expect(handle.dataset.dragging).toBe("false");
    window.dispatchEvent(pointer("pointermove", { clientX: 420 }));
    expect(first.style.flex).toBe("0 0 40%");
  });

  it("ignores other buttons and a collapsed pane area", () => {
    const { host, editors, first } = mergeHost();
    vi.spyOn(editors, "getBoundingClientRect").mockReturnValue({ left: 0, width: 0 } as DOMRect);
    attachSplitResizer(host);
    const handle = separator(host);

    handle.dispatchEvent(pointer("pointerdown", { button: 2 }));
    expect(handle.dataset.dragging).toBeUndefined();

    handle.dispatchEvent(pointer("pointerdown", { button: 0 }));
    window.dispatchEvent(pointer("pointermove", { clientX: 30 }));
    expect(first.style.flex).toBe("0 0 50%");
  });

  it("steps left, jumps home and leaves other keys alone", () => {
    const { host, first } = mergeHost();
    attachSplitResizer(host);
    const handle = separator(host);
    const left = new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true });
    handle.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(true);
    expect(first.style.flex).toBe("0 0 45%");
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    expect(first.style.flex).toBe("0 0 20%");
    const other = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    handle.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    expect(first.style.flex).toBe("0 0 20%");
  });

  it("keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSplitRatio()).toBe(50);
    const { host, first } = mergeHost();
    attachSplitResizer(host);
    separator(host).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(first.style.flex).toBe("0 0 55%");
  });

  it("repositions the handle when the host resizes and stops observing on detach", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let resize: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { host, first, second } = mergeHost();
    const detach = attachSplitResizer(host);
    expect(observe).toHaveBeenCalledWith(host);
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ left: 10 } as DOMRect);
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue({ right: 210 } as DOMRect);
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({ left: 220 } as DOMRect);
    resize();
    expect(separator(host).style.left).toBe("205px");
    detach();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

describe("diff split resizer styling", () => {
  it("draws a resting hairline in the border colour", () => {
    const rule = ruleFor(".oleafly-diff-resizer::after");
    expect(rule).toContain("background: var(--border)");
    expect(rule).toContain("width: 1px");
    expect(rule).not.toContain("background: transparent");
  });

  it("switches the same hairline to the primary colour when active", () => {
    const rule = ruleFor('.oleafly-diff-resizer[data-dragging="true"]::after');
    expect(rule).toContain("background: var(--primary)");
    expect(globalsCss).toContain(".oleafly-diff-resizer:hover::after");
  });

  it("widens the hairline into a focus indicator for keyboard use", () => {
    const rule = ruleFor(".oleafly-diff-resizer:focus-visible::after");
    expect(rule).toContain("background: var(--primary)");
    expect(rule).toContain("width: 2px");
  });

  it("keeps the ten pixel hit area around the hairline", () => {
    const rule = ruleFor(".oleafly-diff-resizer");
    expect(rule).toContain("width: 10px");
    expect(rule).toContain("margin-left: -5px");
  });
});
