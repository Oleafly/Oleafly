// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import {
  clearTypstCache,
  MAX_TYPST_RENDERS,
  paintTypst,
  paintTypstStill,
  TYPST_DELAY_MS,
  TYPST_TEMPLATE,
  typstBlock,
  typstError,
} from "./typst-block";

const render = vi.hoisted(() => vi.fn(async (_source: string) => '<svg xmlns="http://www.w3.org/2000/svg"/>'));

vi.mock("@/lib/tauri", () => ({ notesRenderTypst: render }));

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  vi.useFakeTimers();
  render.mockReset();
  render.mockImplementation(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>');
  clearTypstCache();
  Object.assign(globalThis, { isTauri: true });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "isTauri");
});

describe("typst block", () => {
  it("renders through Rust after a pause and caches the result", async () => {
    const preview = document.createElement("div");
    paintTypst(preview, " $ x $ ");
    expect(preview.textContent).toBe(enNotes.blocks.typst.rendering);
    expect(render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    expect(render).toHaveBeenCalledWith("$ x $");
    const image = preview.querySelector("img.note-typst") as HTMLImageElement;
    expect(image.alt).toBe(enNotes.blocks.typst.alt);
    expect(image.src).toContain("data:image/svg+xml");
    const again = document.createElement("div");
    expect(paintTypst(again, "$ x $")).toBeUndefined();
    expect(again.querySelector("img")).not.toBeNull();
    expect(render).toHaveBeenCalledOnce();
  });

  it("keeps the last drawing while a new one renders and cancels on dispose", async () => {
    const preview = document.createElement("div");
    paintTypst(preview, "$ a $");
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    const dispose = paintTypst(preview, "$ b $");
    expect(preview.querySelector("img")).not.toBeNull();
    dispose?.();
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("ignores results that arrive after the block changed", async () => {
    let finish: (svg: string) => void = () => undefined;
    render.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const preview = document.createElement("div");
    const dispose = paintTypst(preview, "$ late $");
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    dispose?.();
    finish("<svg/>");
    await Promise.resolve();
    expect(preview.querySelector("img")).toBeNull();
    render.mockRejectedValueOnce(new Error("gone"));
    const other = document.createElement("div");
    const stop = paintTypst(other, "$ gone $");
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS - 1);
    stop?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(other.textContent).toBe(enNotes.blocks.typst.rendering);
  });

  it("shows compile errors briefly", async () => {
    render.mockRejectedValueOnce(new Error(`Line 1: ${"unclosed delimiter ".repeat(30)}`));
    const preview = document.createElement("div");
    paintTypst(preview, "$ (");
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    expect(preview.textContent?.startsWith("Typst couldn't compile this block: Line 1: unclosed")).toBe(true);
    expect(preview.textContent?.endsWith("…")).toBe(true);
    expect(typstError("short")).toBe("short");
    expect(typstError(new Error('@oleafly/error:{"code":"project.not_found","params":{},"detail":null}'))).not.toContain("@oleafly/error");
  });

  it("explains empty blocks and the desktop requirement", () => {
    const preview = document.createElement("div");
    paintTypst(preview, "  ");
    expect(preview.textContent).toBe(enNotes.blocks.typst.empty);
    Reflect.deleteProperty(globalThis, "isTauri");
    paintTypst(preview, "$ y $");
    expect(preview.textContent).toBe(enNotes.blocks.typst.desktopOnly);
  });

  it("shows cached drawings on Home and a card otherwise, without calling Rust", async () => {
    const preview = document.createElement("div");
    paintTypstStill(preview, "$ never $");
    expect(preview.querySelector(".note-block-card-title")?.textContent).toBe("Typst");
    paintTypst(document.createElement("div"), "$ seen $");
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    paintTypstStill(preview, "$ seen $");
    expect(preview.querySelector("img")).not.toBeNull();
    expect(render).toHaveBeenCalledOnce();
  });

  it("renders at most two blocks at once and starts the next when one finishes", async () => {
    const finishers: ((svg: string) => void)[] = [];
    render.mockImplementation(() => new Promise((resolve) => finishers.push(resolve)));
    const previews = [0, 1, 2, 3].map(() => document.createElement("div"));
    for (const [index, preview] of previews.entries()) paintTypst(preview, `$ queue ${index} $`);
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    expect(render).toHaveBeenCalledTimes(MAX_TYPST_RENDERS);
    finishers[0]("<svg/>");
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(3);
    expect(previews[0].querySelector("img")).not.toBeNull();
    finishers[1]("<svg/>");
    finishers[2]("<svg/>");
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(4);
    finishers[3]("<svg/>");
    await vi.advanceTimersByTimeAsync(0);
    expect(previews.every((preview) => preview.querySelector("img"))).toBe(true);
  });

  it("shares one render between blocks with the same source", async () => {
    let finish: (svg: string) => void = () => undefined;
    render.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const left = document.createElement("div");
    const right = document.createElement("div");
    const dispose = paintTypst(left, "$ same $");
    paintTypst(right, " $ same $ ");
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    dispose?.();
    dispose?.();
    finish("<svg/>");
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledOnce();
    expect(left.querySelector("img")).toBeNull();
    expect(right.querySelector("img")).not.toBeNull();
  });

  it("drops a queued render nobody is waiting for", async () => {
    const finishers: ((svg: string) => void)[] = [];
    render.mockImplementation(() => new Promise((resolve) => finishers.push(resolve)));
    paintTypst(document.createElement("div"), "$ busy 1 $");
    paintTypst(document.createElement("div"), "$ busy 2 $");
    const waiting = document.createElement("div");
    const dispose = paintTypst(waiting, "$ gone away $");
    await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    dispose?.();
    finishers[0]("<svg/>");
    finishers[1]("<svg/>");
    await vi.advanceTimersByTimeAsync(0);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).not.toHaveBeenCalledWith("$ gone away $");
    expect(waiting.querySelector("img")).toBeNull();
  });

  it("waits until the block scrolls into view", async () => {
    const observers: { callback: IntersectionObserverCallback; disconnected: boolean }[] = [];
    class Observer {
      record: { callback: IntersectionObserverCallback; disconnected: boolean };
      constructor(callback: IntersectionObserverCallback) {
        this.record = { callback, disconnected: false };
        observers.push(this.record);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        this.record.disconnected = true;
      }
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    try {
      const preview = document.createElement("div");
      paintTypst(preview, "$ below the fold $");
      await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS * 2);
      expect(render).not.toHaveBeenCalled();
      const seen = (visible: boolean) =>
        observers[0].callback([{ isIntersecting: visible, target: preview } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      seen(false);
      await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
      expect(render).not.toHaveBeenCalled();
      seen(true);
      expect(observers[0].disconnected).toBe(true);
      await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
      expect(render).toHaveBeenCalledWith("$ below the fold $");
      const hidden = paintTypst(document.createElement("div"), "$ never seen $");
      hidden?.();
      expect(observers[1].disconnected).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("registers with a raw Typst template and evicts old drawings", async () => {
    expect(typstBlock.template?.()).toEqual({ info: "{=typst}", source: TYPST_TEMPLATE });
    expect(typstBlock.label()).toBe("Typst");
    const preview = document.createElement("div");
    typstBlock.paint(preview, "$ 0 $", { still: false });
    typstBlock.still !== "card" && typstBlock.still?.(preview, "$ 0 $", { still: true });
    for (let index = 0; index < 70; index += 1) {
      paintTypst(document.createElement("div"), `$ ${index} $`);
      await vi.advanceTimersByTimeAsync(TYPST_DELAY_MS);
    }
    const first = document.createElement("div");
    paintTypstStill(first, "$ 0 $");
    expect(first.querySelector("img")).toBeNull();
  });
});
