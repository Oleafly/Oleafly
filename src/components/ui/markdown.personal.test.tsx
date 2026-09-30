// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

import MarkdownRenderer, { clearMarkdownDocumentCache } from "./markdown-renderer";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { usePersonalDetailsStore } from "@/store/personal-details";

const reply = [
  "I saved it to ~/paper/main.tex and read `~/paper/refs.bib`.",
  "",
  "```sh",
  "latexmk /Users/ada/paper/main.tex",
  "```",
  "",
  "See https://example.com/a/b for more.",
].join("\n");

function marked(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-private]")].map((node) => node.textContent ?? "");
}

beforeEach(() => {
  clearMarkdownDocumentCache();
  setDisplayHomes(["/Users/ada"]);
});

afterEach(() => {
  cleanup();
  act(() => usePersonalDetailsStore.getState().setHidden(false));
  resetDisplayHomes();
});

describe("Markdown in screenshot mode", () => {
  it("adds no markers while personal details are shown", () => {
    const { container } = render(<MarkdownRenderer>{reply}</MarkdownRenderer>);
    expect(marked(container)).toEqual([]);
  });

  it("marks paths in prose, inline code and code blocks, and leaves links alone", () => {
    act(() => usePersonalDetailsStore.getState().setHidden(true));
    const { container } = render(<MarkdownRenderer>{reply}</MarkdownRenderer>);
    const runs = marked(container);
    expect(runs).toContain("~/paper/main.tex");
    expect(runs).toContain("~/paper/refs.bib");
    expect(runs.some((run) => run.includes("latexmk /Users/ada/paper/main.tex"))).toBe(true);
    expect(runs.join(" ")).not.toContain("example.com");
    expect(container.textContent).toContain("I saved it to ~/paper/main.tex");
  });

  it("follows the mode when it is turned on after the reply rendered", () => {
    const { container } = render(<MarkdownRenderer>{reply}</MarkdownRenderer>);
    act(() => usePersonalDetailsStore.getState().setHidden(true));
    expect(marked(container)).toContain("~/paper/main.tex");
    act(() => usePersonalDetailsStore.getState().setHidden(false));
    expect(marked(container)).toEqual([]);
  });
});
