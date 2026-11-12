// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { AppError } from "@/lib/app-error";
import { useSettingsStore } from "@/store/settings";
import { NATIVE_RENDER_DELAY_MS } from "./native-render";
import type { NoteBlockKind, PaintContext } from "./note-blocks";
import { CIRCUITIKZ_TEMPLATE, TIKZ_RENDERERS, TIKZ_TEMPLATE, tikzBlocks, tikzRenderError } from "./tikz-block";
import { tikzDocument } from "./tikz-source";
import "./tests/setup";

const render = vi.hoisted(() => vi.fn(async (_document: string) => '<svg xmlns="http://www.w3.org/2000/svg"/>'));

vi.mock("@/lib/tauri", () => ({ notesRenderTikz: render }));

const PERSONAL = { still: false, noteId: "n1" };
const SHARED = { still: false };
const disposers: (() => void)[] = [];

function paint(kind: NoteBlockKind, preview: HTMLElement, source: string, context: PaintContext): (() => void) | undefined {
  const dispose = kind.paint(preview, source, context);
  if (dispose) disposers.push(dispose);
  return dispose;
}

function setPreamble(text: string): void {
  useSettingsStore.getState().setNotesAppearance("notesTikzPreamble", text);
}

function coded(code: string, params: Record<string, string>): Error {
  return new Error(`@oleafly/error:${JSON.stringify({ code, params, detail: null })}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  render.mockReset();
  render.mockImplementation(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const renderer of Object.values(TIKZ_RENDERERS)) renderer.reset();
  Object.assign(globalThis, { isTauri: true });
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
  setPreamble("");
  Reflect.deleteProperty(globalThis, "isTauri");
});

describe("TikZ blocks", () => {
  it("registers TikZ and CircuiTikZ with their own fences and templates", () => {
    expect(tikzBlocks.map((kind) => [kind.name, kind.label(), kind.template?.().info])).toEqual([
      ["tikz", "TikZ", "tikz"],
      ["circuitikz", "CircuiTikZ", "circuitikz"],
    ]);
    expect(tikzBlocks[0].template?.().source).toBe(TIKZ_TEMPLATE);
    expect(tikzBlocks[1].template?.().source).toBe(CIRCUITIKZ_TEMPLATE);
  });

  it("compiles a standalone document through Rust and draws it for both themes", async () => {
    const [tikz, circuit] = tikzBlocks;
    const preview = document.createElement("div");
    paint(tikz, preview, String.raw`\draw (0,0) -- (1,1);`, PERSONAL);
    expect(preview.textContent).toBe(enNotes.blocks.typst.rendering);
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS);
    expect(render).toHaveBeenCalledWith(tikzDocument(String.raw`\draw (0,0) -- (1,1);`, "tikz").text);
    const image = preview.querySelector("img.note-tikz") as HTMLImageElement;
    expect(image.alt).toBe(enNotes.blocks.tikz.alt);
    expect(image.className).toContain("dark:invert");
    const other = document.createElement("div");
    paint(circuit, other, String.raw`\draw (0,0) to[R] (2,0);`, PERSONAL);
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS);
    expect(render.mock.calls[1][0]).toContain(String.raw`\usepackage{circuitikz}`);
    expect(render.mock.calls[1][0]).toContain(String.raw`\begin{circuitikz}`);
    expect((other.querySelector("img") as HTMLImageElement).alt).toBe(enNotes.blocks.tikz.circuitAlt);
  });

  it("points TeX errors at the block's own line", async () => {
    const source = String.raw`\usetikzlibrary{calc}
\begin{tikzpicture}
\drawx (0,0);
\end{tikzpicture}`;
    const line = tikzDocument(source, "tikz").lines.findIndex((origin) => origin?.line === 3) + 1;
    render.mockRejectedValueOnce(coded("notes.tikz_line", { line: String(line), message: "Undefined control sequence." }));
    const preview = document.createElement("div");
    paint(tikzBlocks[0], preview, source, PERSONAL);
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS);
    expect(preview.textContent).toBe("LaTeX couldn't compile this block: Line 3: Undefined control sequence.");
  });

  it("keeps only the message when the error is in the generated preamble, and passes other errors on", () => {
    const document = tikzDocument(String.raw`\draw (0,0);`, "tikz");
    expect(tikzRenderError(coded("notes.tikz_line", { line: "1", message: "File missing." }), document)).toBe("File missing.");
    const mapped = tikzRenderError(coded("notes.tikz_line", { line: "6", message: "Bad." }), document);
    expect(mapped).toBeInstanceOf(AppError);
    expect((mapped as AppError).params).toEqual({ line: "1", message: "Bad." });
    const timeout = coded("notes.tikz_timeout", {});
    expect(tikzRenderError(timeout, document)).toBe(timeout);
  });

  it("explains empty blocks and the desktop requirement, and shows cards on Home", async () => {
    const preview = document.createElement("div");
    paint(tikzBlocks[1], preview, " \n", PERSONAL);
    expect(preview.textContent).toBe("This CircuiTikZ block is empty.");
    Reflect.deleteProperty(globalThis, "isTauri");
    paint(tikzBlocks[0], preview, String.raw`\draw (0,0);`, PERSONAL);
    expect(preview.textContent).toBe("TikZ previews need the desktop app.");
    const card = document.createElement("div");
    const still = tikzBlocks[1].still;
    if (typeof still === "function") still(card, String.raw`\draw (0,0) to[R] (1,0);`, { still: true });
    expect(card.querySelector("p")?.textContent).toBe("CircuiTikZ");
    expect(render).not.toHaveBeenCalled();
  });

  it("forgets older drawings once the kept SVGs grow too large", async () => {
    const big = `<svg xmlns="http://www.w3.org/2000/svg">${"x".repeat(3_500_000)}</svg>`;
    render.mockImplementation(async () => big);
    await TIKZ_RENDERERS.tikz.svg(String.raw`\draw (0,0) -- (1,0);`);
    await TIKZ_RENDERERS.tikz.svg(String.raw`\draw (0,0) -- (2,0);`);
    await expect(TIKZ_RENDERERS.tikz.svg(String.raw`\draw (0,0) -- (1,0);`, { cachedOnly: true })).rejects.toThrow();
    await expect(TIKZ_RENDERERS.tikz.svg(String.raw`\draw (0,0) -- (2,0);`, { cachedOnly: true })).resolves.toBe(big);
  });

  it("renders on request for exports and reuses the drawing", async () => {
    const svg = await TIKZ_RENDERERS.tikz.svg(String.raw`\draw (0,0) -- (2,0);`);
    expect(svg).toContain("<svg");
    await TIKZ_RENDERERS.tikz.svg(String.raw` \draw (0,0) -- (2,0); `);
    expect(render).toHaveBeenCalledOnce();
  });

  it("exports a shared note's drawing only once it has been drawn here", async () => {
    const source = String.raw`\draw (0,0) -- (3,0);`;
    await expect(TIKZ_RENDERERS.tikz.svg(source, { cachedOnly: true })).rejects.toThrow();
    expect(render).not.toHaveBeenCalled();
    await TIKZ_RENDERERS.tikz.svg(source);
    await expect(TIKZ_RENDERERS.tikz.svg(source, { cachedOnly: true })).resolves.toContain("<svg");
  });
});

describe("TikZ blocks in shared notes", () => {
  function drawButton(preview: HTMLElement): HTMLButtonElement {
    return [...preview.querySelectorAll("button")].find((button) => button.textContent === enNotes.blocks.tikz.draw) as HTMLButtonElement;
  }

  it("asks before running LaTeX and draws once Draw is clicked", async () => {
    const source = String.raw`\draw (0,0) circle (1);`;
    const preview = document.createElement("div");
    paint(tikzBlocks[0], preview, source, SHARED);
    expect(preview.textContent).toContain(enNotes.blocks.tikz.sharedNotice);
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS * 4);
    expect(render).not.toHaveBeenCalled();
    const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    drawButton(preview).dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);
    drawButton(preview).click();
    expect(render).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(preview.querySelector("img.note-tikz")).not.toBeNull();
    const again = document.createElement("div");
    paint(tikzBlocks[0], again, source, SHARED);
    expect(again.querySelector("img.note-tikz")).not.toBeNull();
    expect(render).toHaveBeenCalledOnce();
  });

  it("keeps the last drawing in view while it asks about a changed source", async () => {
    const preview = document.createElement("div");
    paint(tikzBlocks[0], preview, String.raw`\draw (0,0) -- (1,0);`, SHARED);
    drawButton(preview).click();
    await vi.advanceTimersByTimeAsync(0);
    paint(tikzBlocks[0], preview, String.raw`\draw (0,0) -- (2,0);`, SHARED);
    expect(drawButton(preview)).toBeDefined();
    expect(preview.querySelector("img.note-tikz")).not.toBeNull();
    expect(render).toHaveBeenCalledOnce();
  });

  it("does not ask in personal notes or for Home cards", async () => {
    const preview = document.createElement("div");
    paint(tikzBlocks[1], preview, String.raw`\draw (0,0) to[R] (1,0);`, PERSONAL);
    expect(drawButton(preview)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS);
    expect(render).toHaveBeenCalledOnce();
  });
});

describe("the shared TikZ preamble", () => {
  it("goes into every drawing and redraws open blocks when it changes", async () => {
    setPreamble(String.raw`\usetikzlibrary{calc}`);
    const preview = document.createElement("div");
    const dispose = paint(tikzBlocks[0], preview, String.raw`\draw (0,0) -- (1,0);`, PERSONAL);
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS);
    expect(render.mock.lastCall?.[0]).toContain(String.raw`\usetikzlibrary{calc}`);
    setPreamble(String.raw`\usetikzlibrary{positioning}`);
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.lastCall?.[0]).toContain(String.raw`\usetikzlibrary{positioning}`);
    dispose?.();
    setPreamble(String.raw`\usetikzlibrary{shapes}`);
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("names the preamble line when the error is in it", async () => {
    setPreamble(String.raw`\usetikzlibrary{calc}
\tikzsett{thick}`);
    const source = String.raw`\draw (0,0) -- (1,0);`;
    const line = tikzDocument(source, "tikz", useSettingsStore.getState().notesTikzPreamble).lines.findIndex((origin) => origin?.shared && origin.line === 2) + 1;
    render.mockRejectedValueOnce(coded("notes.tikz_line", { line: String(line), message: "Undefined control sequence." }));
    const preview = document.createElement("div");
    paint(tikzBlocks[0], preview, source, PERSONAL);
    await vi.advanceTimersByTimeAsync(NATIVE_RENDER_DELAY_MS);
    expect(preview.textContent).toBe("LaTeX couldn't compile this block: Line 2 of the TikZ preamble in Settings: Undefined control sequence.");
  });
});
