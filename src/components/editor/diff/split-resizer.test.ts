// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { attachSplitResizer, clampSplitRatio, readSplitRatio } from "./split-resizer";

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
