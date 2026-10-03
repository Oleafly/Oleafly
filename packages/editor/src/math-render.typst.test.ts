// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cssColorToHex,
  paintTypstMath,
  renderTypstMath,
  setTypstMathHost,
  type TypstMathHost,
  type TypstMathOutcome,
  typstMathSnippet,
  typstMathTheme,
} from "./math-render";
import { installEnglishEditorMessages } from "./test-messages";

installEnglishEditorMessages();

const THEME = { color: "#112233", size: 10.5 };
let counter = 0;

function unique(body: string): string {
  counter++;
  return `${body} + u_${counter}`;
}

function hostWith(render: (source: string) => Promise<TypstMathOutcome>, version = "0.15.1") {
  const host: TypstMathHost = {
    render: vi.fn(render),
    typstVersion: () => version,
  };
  setTypstMathHost(host);
  return host;
}

const rendered = (svg = "<svg xmlns='http://www.w3.org/2000/svg'/>"): TypstMathOutcome => ({
  status: "rendered",
  svg,
});

afterEach(() => {
  setTypstMathHost(null);
  vi.useRealTimers();
});

describe("typstMathSnippet", () => {
  it("sets the text colour and size and keeps the equation delimiters", () => {
    expect(typstMathSnippet(" a + b ", THEME)).toBe('#set text(fill: rgb("#112233"), size: 10.5pt)\n$ a + b $');
    expect(typstMathSnippet("x^2", THEME)).toBe('#set text(fill: rgb("#112233"), size: 10.5pt)\n$x^2$');
  });

  it("never lets an unexpected colour into the source", () => {
    expect(typstMathSnippet("x", { color: '#000"); #panic("x', size: 11 })).toContain('rgb("#808080")');
  });
});

describe("renderTypstMath", () => {
  it("renders once and serves the same theme and Typst version from the cache", async () => {
    const host = hostWith(async () => rendered());
    const body = unique("x");
    await renderTypstMath(body, THEME);
    await renderTypstMath(body, THEME);
    expect(host.render).toHaveBeenCalledTimes(1);
    expect(host.render).toHaveBeenCalledWith(typstMathSnippet(body, THEME));
  });

  it("renders again for another theme or another Typst version", async () => {
    const host = hostWith(async () => rendered());
    const body = unique("y");
    await renderTypstMath(body, THEME);
    await renderTypstMath(body, { ...THEME, color: "#ffffff" });
    expect(host.render).toHaveBeenCalledTimes(2);
    const other = hostWith(async () => rendered(), "0.13.1");
    await renderTypstMath(body, THEME);
    expect(other.render).toHaveBeenCalledTimes(1);
  });

  it("shares one render between concurrent requests", async () => {
    let resolve: (outcome: TypstMathOutcome) => void = () => undefined;
    const host = hostWith(() => new Promise((done) => (resolve = done)));
    const body = unique("z");
    const first = renderTypstMath(body, THEME);
    const second = renderTypstMath(body, THEME);
    resolve(rendered());
    await expect(first).resolves.toEqual(rendered());
    await expect(second).resolves.toEqual(rendered());
    expect(host.render).toHaveBeenCalledTimes(1);
  });

  it("caches compile errors but retries after a failed call", async () => {
    const failing = hostWith(async () => ({ status: "failed", message: "unknown variable: foo" }));
    const body = unique("foo");
    await expect(renderTypstMath(body, THEME)).resolves.toEqual({ status: "failed", message: "unknown variable: foo" });
    await renderTypstMath(body, THEME);
    expect(failing.render).toHaveBeenCalledTimes(1);

    const broken = hostWith(async () => {
      throw new Error("bridge closed");
    });
    const other = unique("bar");
    await expect(renderTypstMath(other, THEME)).resolves.toEqual({ status: "failed", message: "bridge closed" });
    await renderTypstMath(other, THEME);
    expect(broken.render).toHaveBeenCalledTimes(2);
  });

  it("reports that Typst is unavailable without a host", async () => {
    await expect(renderTypstMath(unique("q"), THEME)).resolves.toEqual({
      status: "failed",
      message: "Typst preview is unavailable.",
    });
  });

  it("evicts the least recently used render", async () => {
    const host = hostWith(async () => rendered());
    const first = unique("first");
    await renderTypstMath(first, THEME);
    for (let index = 0; index < 200; index++) await renderTypstMath(unique("fill"), THEME);
    const calls = vi.mocked(host.render).mock.calls.length;
    await renderTypstMath(first, THEME);
    expect(host.render).toHaveBeenCalledTimes(calls + 1);
  });
});

describe("paintTypstMath", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("waits for the debounce before it asks Typst", async () => {
    const host = hostWith(async () => rendered("<svg>ok</svg>"));
    const output = document.createElement("div");
    paintTypstMath(output, unique("a"), THEME, { delay: 200 });
    expect(host.render).not.toHaveBeenCalled();
    expect(output.textContent).toBe("Previewing…");
    await vi.advanceTimersByTimeAsync(200);
    const image = output.querySelector("img");
    expect(image?.getAttribute("src")).toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg>ok</svg>")}`);
  });

  it("never asks Typst when cancelled during the debounce", async () => {
    const host = hostWith(async () => rendered());
    const cancel = paintTypstMath(document.createElement("div"), unique("b"), THEME, { delay: 200 });
    cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(host.render).not.toHaveBeenCalled();
  });

  it("drops a result that arrives after cancellation", async () => {
    let resolve: (outcome: TypstMathOutcome) => void = () => undefined;
    hostWith(() => new Promise((done) => (resolve = done)));
    const output = document.createElement("div");
    const cancel = paintTypstMath(output, unique("c"), THEME, { delay: 0 });
    await vi.advanceTimersByTimeAsync(0);
    cancel();
    resolve(rendered());
    await vi.advanceTimersByTimeAsync(0);
    expect(output.querySelector("img")).toBeNull();
  });

  it("shows the Typst error message", async () => {
    hostWith(async () => ({ status: "failed", message: "unclosed delimiter" }));
    const output = document.createElement("div");
    const onPaint = vi.fn();
    paintTypstMath(output, unique("d"), THEME, { delay: 0, errorClass: "custom-error", onPaint });
    await vi.advanceTimersByTimeAsync(0);
    const error = output.querySelector(".custom-error");
    expect(error?.textContent).toBe("unclosed delimiter");
    expect(error?.getAttribute("role")).toBe("status");
    expect(onPaint).toHaveBeenCalledWith({ status: "failed", message: "unclosed delimiter" });
  });

  it("paints a cached render at once", async () => {
    const host = hostWith(async () => rendered());
    const body = unique("e");
    await renderTypstMath(body, THEME);
    const output = document.createElement("div");
    paintTypstMath(output, body, THEME, { delay: 200 });
    expect(output.querySelector("img")).not.toBeNull();
    expect(host.render).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous image of the same owner, dimmed, while the next one renders", async () => {
    hostWith(async () => rendered("<svg>one</svg>"));
    const owner = {};
    const first = document.createElement("div");
    paintTypstMath(first, unique("f"), THEME, { delay: 0, owner });
    await vi.advanceTimersByTimeAsync(0);
    const second = document.createElement("div");
    paintTypstMath(second, unique("g"), THEME, { delay: 200, owner });
    const stale = second.querySelector("img");
    expect(stale?.classList.contains("is-stale")).toBe(true);
    expect(stale?.getAttribute("src")).toContain(encodeURIComponent("<svg>one</svg>"));
  });
});

describe("typstMathTheme", () => {
  it("reads the colour and converts the font size to points", () => {
    const element = document.createElement("div");
    element.style.color = "rgb(10, 20, 255)";
    element.style.fontSize = "14px";
    document.body.append(element);
    expect(typstMathTheme(element)).toEqual({ color: "#0a14ff", size: 10.5 });
    element.remove();
  });

  it("normalises the colour formats a computed style returns", () => {
    expect(cssColorToHex("#ABC")).toBe("#aabbcc");
    expect(cssColorToHex("rgba(255, 0, 16, 0.5)")).toBe("#ff0010");
    expect(cssColorToHex("rgb(1 2 3 / 0)")).toBeNull();
    expect(cssColorToHex("oklch(0.5 0 0)")).toBeNull();
  });

  it.each([
    ["RGB( 1 ,, 2\n3 )", "#010203"],
    ["rgba(300, 12.6, .5, 50%)", "#ff0d01"],
    ["rgb(255 255 255 / 0%)", null],
    ["rgba(1,2,3,0.0)", null],
    ["rgb(1, 2)", null],
    ["rgb(1, 2, 3 x)", null],
    ["rgb(1, 2, 3, 4, 5)", null],
    ["rgb(1, 2, 3) ", "#010203"],
  ])("reads the rgb() colour %j", (color, hex) => {
    expect(cssColorToHex(color)).toBe(hex);
  });
});
