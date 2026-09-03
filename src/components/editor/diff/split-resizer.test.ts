// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
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
