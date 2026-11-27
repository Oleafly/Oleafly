// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const render = {
    renderMathSource: vi.fn((source: string) =>
      source === "\\bad" ? { status: "error", html: "" } : { status: "ready", html: `<span class="katex">${source}</span>` },
    ),
    paintTypstMath: vi.fn((element: HTMLElement, body: string) => {
      element.textContent = `typst:${body}`;
      return () => undefined;
    }),
    typstMathTheme: vi.fn(() => ({ color: "#000000", size: 11 })),
  };
  return { render, loaded: null as typeof render | null, load: vi.fn() };
});

vi.mock("@oleafly/editor/math-render-loader", () => ({
  loadedMathRender: () => mocks.loaded,
  loadMathRender: mocks.load,
}));

import { renderSnippetMath } from "./math-preview";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loaded = null;
  mocks.load.mockResolvedValue(mocks.render);
});

describe("renderSnippetMath", () => {
  it("renders nothing for an empty body", () => {
    expect(renderSnippetMath("  ", "latex")).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("paints LaTeX at once when the math renderer is loaded", () => {
    mocks.loaded = mocks.render;
    const element = renderSnippetMath("\\frac{a}{b}", "latex");
    expect(element?.innerHTML).toBe('<span class="katex">\\frac{a}{b}</span>');
    expect(mocks.render.renderMathSource).toHaveBeenCalledWith("\\frac{a}{b}", true);
  });

  it("loads the renderer first, then paints Typst math", async () => {
    const element = renderSnippetMath("a/b", "typst");
    expect(element?.textContent).toBe("");
    await vi.waitFor(() => expect(element?.textContent).toBe("typst:a/b"));
    expect(mocks.render.typstMathTheme).toHaveBeenCalledWith(element);
  });

  it("drops the preview when the math cannot be drawn or the renderer cannot load", async () => {
    mocks.loaded = mocks.render;
    const host = document.createElement("div");
    const broken = renderSnippetMath("\\bad", "latex");
    expect(broken?.innerHTML).toBe("");
    mocks.loaded = null;
    mocks.load.mockRejectedValueOnce(new Error("offline"));
    const pending = renderSnippetMath("x", "markdown") as HTMLElement;
    host.append(pending);
    expect(host.contains(pending)).toBe(true);
    await vi.waitFor(() => expect(host.contains(pending)).toBe(false));
  });
});
