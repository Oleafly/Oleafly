// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import { applyTheme } from "@/lib/theme";
import { cachedDiagram, clearDiagramCache, MermaidDiagram, renderDiagram } from "./mermaid-diagram";
import { MERMAID_LABEL_PURIFY, MermaidRemoteContentError } from "./mermaid-remote";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

const SOURCE = "flowchart TD\n  A --> B";

function themedSvg() {
  const theme = mermaid.initialize.mock.calls.at(-1)?.[0].theme;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${theme}</text></svg>` };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const diagram = () => screen.findByRole("img", { name: enCore.mermaid.diagram });

beforeEach(() => {
  clearDiagramCache();
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.render.mockImplementation(async () => themedSvg());
  applyTheme("dark");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("rendering diagrams", () => {
  it("shares one render between callers and reuses the finished drawing", async () => {
    const first = renderDiagram(SOURCE, "dark");

    expect(renderDiagram(SOURCE, "dark")).toBe(first);
    const svg = await first;
    await expect(renderDiagram(SOURCE, "dark")).resolves.toBe(svg);
    expect(cachedDiagram(SOURCE, "dark")).toBe(svg);
    expect(mermaid.render).toHaveBeenCalledTimes(1);
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict", theme: "dark" }));
  });

  it("refuses output that is not a single SVG", async () => {
    mermaid.render.mockResolvedValue({ svg: "<div>not a drawing</div>" });

    await expect(renderDiagram(SOURCE, "light")).rejects.toThrow("Invalid Mermaid SVG");
    expect(cachedDiagram(SOURCE, "light")).toBeUndefined();
  });

  it.each([
    ["an image shape", 'flowchart LR\n  A@{ img: "https://attacker.example/p.png?u=1" }'],
    ["themeCSS", '%%{init: {"themeCSS": ".node rect { fill: url(https://attacker.example/t.png) }"}}%%\nflowchart LR\n  A --> B'],
    ["a font family", '%%{init: {"fontFamily": "x; background: url(https://attacker.example/f.png)"}}%%\nflowchart LR\n  A --> B'],
    ["a classDef", "flowchart LR\n  A --> B\n  classDef bad fill:url(https://attacker.example/c.png)\n  class A bad"],
    ["a style statement", "flowchart LR\n  A --> B\n  style A background-image:url('//attacker.example/s.png')"],
    ["image-set", 'flowchart LR\n  A --> B\n  style A background:image-set("https://attacker.example/i.png" 1x)'],
    ["an HTML label image", "flowchart LR\n  A[\"<img src='https://attacker.example/h.png'>\"]"],
    ["a sequence actor icon", 'sequenceDiagram\n  participant A\n  properties A: {"icon": "https://attacker.example/i.png"}\n  A->>A: hi'],
    ["sequence actor details", "sequenceDiagram\n  participant A\n  details A: note-heading\n  A->>A: hi"],
  ])("refuses %s that loads from the internet without starting mermaid", async (_name, source) => {
    await expect(renderDiagram(source, "light")).rejects.toBeInstanceOf(MermaidRemoteContentError);
    expect(mermaid.initialize).not.toHaveBeenCalled();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("strips sources and links from labels and keeps diagrams from changing that", async () => {
    await renderDiagram(SOURCE, "light");

    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        dompurifyConfig: MERMAID_LABEL_PURIFY,
        secure: expect.arrayContaining(["dompurifyConfig", "securityLevel"]),
      }),
    );
  });

  it("refuses a drawing that still points at the internet", async () => {
    mermaid.render.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://attacker.example/i.png"/></svg>',
    });

    await expect(renderDiagram(SOURCE, "light")).rejects.toBeInstanceOf(MermaidRemoteContentError);
    expect(cachedDiagram(SOURCE, "light")).toBeUndefined();
  });

  it("keeps a node's link as plain text", async () => {
    mermaid.render.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="https://example.com/docs" target="_blank"><text>A</text></a></svg>',
    });

    const svg = await renderDiagram(SOURCE, "light");

    expect(svg.querySelector("a")?.getAttributeNames()).toEqual([]);
    expect(svg.textContent).toBe("A");
  });
});

describe("MermaidDiagram", () => {
  it("shows the source with an error when the drawing fails, and does not try again", async () => {
    mermaid.render.mockRejectedValue(new Error("parse error"));
    const { container, unmount } = render(<MermaidDiagram source={SOURCE} />);

    expect(await screen.findByRole("status", { name: enCore.mermaid.renderFailed })).toBeTruthy();
    expect(container.querySelector("code")?.textContent).toBe(SOURCE);
    unmount();

    render(<MermaidDiagram source={SOURCE} />);

    expect(await screen.findByRole("status", { name: enCore.mermaid.renderFailed })).toBeTruthy();
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it("says why a diagram that loads from the internet was not drawn and shows its source", async () => {
    const source = 'flowchart LR\n  A@{ img: "https://attacker.example/p.png" }';
    const { container } = render(<MermaidDiagram source={source} />);

    expect(await screen.findByRole("status", { name: enCore.mermaid.remoteBlocked })).toBeTruthy();
    expect(container.querySelector("code")?.textContent).toBe(source);
    expect(container.querySelector("img, image")).toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it("redraws for a new theme when the browser is idle and reuses earlier drawings", async () => {
    const idle: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => idle.push(callback));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    render(<MermaidDiagram source={SOURCE} />);
    expect((await diagram()).textContent).toBe("dark");

    act(() => applyTheme("light"));
    expect((await diagram()).textContent).toBe("dark");
    expect(idle).toHaveLength(1);

    act(() => idle[0]());
    await vi.waitFor(async () => expect((await diagram()).textContent).toBe("default"));

    act(() => applyTheme("dark"));

    expect((await diagram()).textContent).toBe("dark");
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  it("draws the current theme when the theme changes during a render", async () => {
    const idle: Array<() => void> = [];
    const cancelIdle = vi.fn();
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => idle.push(callback));
    vi.stubGlobal("cancelIdleCallback", cancelIdle);
    const dark = deferred<{ svg: string }>();
    mermaid.render.mockImplementationOnce(() => dark.promise);
    render(<MermaidDiagram source={SOURCE} />);
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));

    act(() => applyTheme("light"));
    await act(async () => {
      dark.resolve(themedSvg());
      await dark.promise;
    });

    expect(screen.queryByRole("img", { name: enCore.mermaid.diagram })).toBeNull();
    expect(cancelIdle).toHaveBeenCalledWith(1);
    act(() => idle.at(-1)?.());

    expect((await diagram()).textContent).toBe("default");
  });

  it("grows smoothly from the placeholder to the drawing's height", async () => {
    const frames: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 112 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(300);
    const { container } = render(<MermaidDiagram source={SOURCE} />);
    await diagram();
    const shell = container.querySelector<HTMLElement>("[data-mermaid-diagram]");

    expect(shell?.style.height).toBe("112px");
    act(() => frames[0]());
    expect(shell?.style.height).toBe("300px");

    const other = new Event("transitionend", { bubbles: true });
    Object.defineProperty(other, "propertyName", { value: "opacity" });
    act(() => {
      shell?.dispatchEvent(other);
    });
    expect(shell?.style.height).toBe("300px");

    const finished = new Event("transitionend", { bubbles: true });
    Object.defineProperty(finished, "propertyName", { value: "height" });
    act(() => {
      shell?.dispatchEvent(finished);
    });
    expect(shell?.style.height).toBe("");
  });

  it("drops a pending height change when it unmounts", async () => {
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => 7);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 112 } as DOMRect);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(300);
    const { unmount } = render(<MermaidDiagram source={SOURCE} />);
    await diagram();

    unmount();

    expect(cancelFrame).toHaveBeenCalledWith(7);
  });
});
