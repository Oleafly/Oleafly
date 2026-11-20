// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import { transform } from "sucrase";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assetModules, createDeckRunner, DECK_MODULES, FRAME_EVENT, HOST_EVENT } from "./deck-host";
import { createArtifactRuntime, esm, type TransformOptions } from "./runtime-core";

const MESSAGES = {
  unknownImport: "Imports {{name}} offline",
  compileError: "Syntax problem",
  runtimeError: "Stopped",
  noComponent: "Nothing to show",
  noSlides: "No slides",
};

const DECK = `import type { Page } from "@open-slide/core";
import { Step, Steps, useSlidePageNumber } from "@open-slide/core";
import logo from "./assets/logo.png";
const Number = () => { const { current, total } = useSlidePageNumber(); return <span data-number>{current}/{total}</span>; };
const One: Page = () => <div><h1>First slide</h1><img alt="logo" src={logo} /><Number /></div>;
const Two: Page = () => <div><h1>Second slide</h1><Steps><Step>Point A</Step><Step>Point B</Step></Steps></div>;
export const meta = { title: "Attention" };
export const notes = ["Say hello", undefined];
export default [One, Two] satisfies Page[];`;

function compile(code: string, options: TransformOptions): string {
  const transforms: ("jsx" | "typescript" | "imports")[] = ["jsx"];
  if (options.typescript) transforms.push("typescript");
  if (options.imports) transforms.push("imports");
  return transform(code, { transforms, jsxRuntime: options.jsx, production: true, filePath: options.filePath }).code;
}

function runner(tailwindSource = "") {
  const runtime = createArtifactRuntime({
    React,
    createRoot,
    modules: { react: () => esm(React), "react/jsx-runtime": () => esm(JsxRuntime), ...DECK_MODULES },
    globals: {},
    transform: compile,
    tailwindSource,
    evaluate: (code) => {
      new Function(code)();
    },
  });
  return createDeckRunner(runtime);
}

function collect() {
  const sent: Record<string, unknown>[] = [];
  const listener = (event: Event) => sent.push((event as CustomEvent).detail);
  window.addEventListener(FRAME_EVENT, listener);
  return { sent, stop: () => window.removeEventListener(FRAME_EVENT, listener) };
}

function host(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent(HOST_EVENT, { detail }));
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("assetModules", () => {
  it("turns project assets into default-export modules", () => {
    expect(assetModules({ "./assets/a.png": "data:image/png;base64,AA==" })).toEqual({
      "./assets/a.png": { __esModule: true, default: "data:image/png;base64,AA==" },
    });
  });
});

describe("runDeck", () => {
  it("runs an Open Slide deck, reports its pages and notes, and follows the host", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { sent, stop } = collect();
    act(() => {
      runner()(DECK, MESSAGES, { mode: "edit", page: 0, assets: { "./assets/logo.png": "data:image/png;base64,AA==" } });
    });
    expect(sent.find((message) => message.type === "deck")).toEqual({
      type: "deck",
      pages: 2,
      notes: ["Say hello", null],
      title: "Attention",
    });
    expect(document.body.textContent).toContain("First slide");
    expect(document.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(document.querySelector("[data-number]")?.textContent).toBe("1/2");

    host({ type: "goto", page: 1 });
    expect(document.body.textContent).toContain("Second slide");
    expect(sent.at(-1)).toMatchObject({ type: "position", page: 1 });

    host({ type: "source", code: DECK.replace("Second slide", "Second slide, edited") });
    expect(document.body.textContent).toContain("Second slide, edited");
    stop();
  });

  it("hands the app the shortcuts the deck does not use, but not keys typed into a field or plain keys", () => {
    document.body.innerHTML = '<div id="root"></div><input aria-label="Answer" />';
    act(() => {
      runner()(DECK, MESSAGES, { mode: "edit", page: 0, assets: {} });
    });
    const { sent, stop } = collect();
    const press = (target: EventTarget, init: KeyboardEventInit) =>
      act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
      });
    press(window, { key: "s", code: "KeyS", ctrlKey: true });
    press(window, { key: "Control", code: "ControlLeft", ctrlKey: true });
    press(window, { key: "x" });
    press(document.querySelector("input") as HTMLInputElement, { key: "z", code: "KeyZ", ctrlKey: true });
    const handled = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, cancelable: true });
    handled.preventDefault();
    act(() => {
      window.dispatchEvent(handled);
    });
    expect(sent.filter((message) => message.type === "key")).toEqual([
      { type: "key", key: "s", code: "KeyS", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
    ]);
    stop();
  });

  it("styles decks with Tailwind and gives each slide the whole canvas", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const started = vi.fn();
    vi.stubGlobal("__tailwindStarted", started);
    act(() => {
      runner("globalThis.__tailwindStarted();")(DECK, MESSAGES, {
        mode: "edit",
        page: 0,
        assets: { "./assets/logo.png": "data:image/png;base64,AA==" },
      });
    });
    expect(started).toHaveBeenCalledTimes(1);
    const layer = document.querySelector<HTMLElement>("[data-osd-current-page]");
    expect(layer?.style.position).toBe("absolute");
    expect(layer?.style.inset).toBe("0px");
    expect(layer?.parentElement?.style.height).toBe("100%");
  });

  it("explains a deck that does not compile or has no slides, naming its file", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { sent, stop } = collect();
    act(() => {
      runner()("export default [", MESSAGES, { mode: "edit", page: 0, assets: {}, file: "slides/demo/index.tsx" });
    });
    expect(sent.at(-1)).toMatchObject({ type: "error", title: "Syntax problem" });
    expect(sent.at(-1)?.detail).toContain("slides/demo/index.tsx");
    expect(document.querySelector("[data-artifact-error]")?.textContent).toContain("slides/demo/index.tsx");
    host({ type: "source", code: "export const notes = [];" });
    expect(sent.at(-1)).toMatchObject({ type: "error", title: "No slides" });
    expect(document.querySelector("[data-artifact-error]")).not.toBeNull();
    stop();
  });

  it("opens partway through a slide and comes back there once a broken edit is fixed", () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { sent, stop } = collect();
    const assets = { "./assets/logo.png": "data:image/png;base64,AA==" };
    act(() => {
      runner()(DECK, MESSAGES, { mode: "edit", page: 1, revealed: 1, assets });
    });
    expect(sent.at(-1)).toMatchObject({ type: "position", page: 1, revealed: 1, steps: 2 });

    host({ type: "source", code: "export default [" });
    expect(sent.at(-1)).toMatchObject({ type: "error" });
    host({ type: "source", code: DECK });
    expect(sent.at(-1)).toMatchObject({ type: "position", page: 1, revealed: 1, steps: 2 });
    expect(document.body.textContent).toContain("Second slide");
    stop();
  });

  it("shows a slide that throws as an error, and clears it once the source is fixed", () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = `const One = () => { throw new Error("bad slide"); };\nexport default [One];`;
    act(() => {
      runner()(broken, MESSAGES, { mode: "edit", page: 0, assets: {} });
    });
    expect(document.querySelector("[data-artifact-error]")?.textContent).toContain("bad slide");
    host({ type: "source", code: "const One = () => <h1>Fixed slide</h1>;\nexport default [One];" });
    expect(document.querySelector("[data-artifact-error]")).toBeNull();
    expect(document.body.textContent).toContain("Fixed slide");
  });
});
