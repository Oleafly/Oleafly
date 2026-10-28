import { describe, expect, it, vi } from "vitest";
import { type BrowserEngine, type CompileSources, createBrowserCompilePort, type EngineResult } from "./browser";
import { CompileStopped, type CompileTarget, type SyncTexIndex } from "./port";

const target: CompileTarget = { mainDocument: "main.tex", engine: "latex", texFlavor: null };

function sources(texts: Record<string, string>): CompileSources {
  return {
    files: Object.keys(texts).map((path) => ({ path, kind: "text" as const })),
    text: (path) => texts[path] ?? null,
    bytes: async () => null,
  };
}

function engine(run: BrowserEngine["run"], accepts: BrowserEngine["accepts"] = () => true): BrowserEngine {
  return { accepts, run };
}

const done: EngineResult = { ok: true, pdf: new Uint8Array([1]), synctex: new Uint8Array([2]), log: "" };
const index: SyncTexIndex = { forward: async () => null, inverse: async () => null, dispose: () => {} };

describe("createBrowserCompilePort", () => {
  it("supports a target only when an engine accepts it", () => {
    const port = createBrowserCompilePort({
      engines: [engine(async () => done, (wanted) => wanted.engine === "typst")],
      sources: async () => sources({}),
      openSyncTex: async () => index,
    });
    expect(port.supports({ ...target, engine: "typst" })).toBe(true);
    expect(port.supports(target)).toBe(false);
  });

  it("refuses a target no engine compiles", async () => {
    const port = createBrowserCompilePort({ engines: [], sources: async () => sources({}), openSyncTex: async () => index });
    await expect(port.compile(target)).rejects.toThrow(/latex/u);
  });

  it("hands the first engine that accepts the target the sources and times the compile", async () => {
    const run = vi.fn<BrowserEngine["run"]>(async () => done);
    const clock = [100, 145];
    const port = createBrowserCompilePort({
      engines: [engine(async () => done, () => false), engine(run)],
      sources: async () => sources({ "main.tex": "x" }),
      openSyncTex: async () => index,
      now: () => clock.shift() ?? 0,
    });
    const output = await port.compile(target);
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0].sources.text("main.tex")).toBe("x");
    expect(output).toMatchObject({ target, ok: true, timeMs: 45 });
    expect(output.pdf).toEqual(new Uint8Array([1]));
  });

  it("reads a TeX log when the engine gives no diagnostics", async () => {
    const log = "(./main.tex\n! Undefined control sequence.\nl.7 \\oops\n\n)\n";
    const port = createBrowserCompilePort({
      engines: [engine(async () => ({ ...done, ok: false, log }))],
      sources: async () => sources({ "main.tex": "" }),
      openSyncTex: async () => index,
    });
    const output = await port.compile(target);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", line: 7, message: expect.stringContaining("Undefined control") }),
    ]);
  });

  it("keeps the diagnostics an engine reads itself", async () => {
    const diagnostics = [{ severity: "warning" as const, message: "unknown font", file: "main.typ", line: 2, category: "info" as const }];
    const port = createBrowserCompilePort({
      engines: [engine(async () => ({ ...done, log: "! not a tex log", diagnostics }))],
      sources: async () => sources({}),
      openSyncTex: async () => index,
    });
    expect((await port.compile(target)).diagnostics).toEqual(diagnostics);
  });

  it("stops the running compile when a newer one starts", async () => {
    const seen: AbortSignal[] = [];
    const finish: Array<() => void> = [];
    const port = createBrowserCompilePort({
      engines: [
        engine(
          ({ signal }) =>
            new Promise((resolve) => {
              seen.push(signal);
              finish.push(() => resolve(done));
            }),
        ),
      ],
      sources: async () => sources({}),
      openSyncTex: async () => index,
    });
    const first = port.compile(target);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    const second = port.compile(target);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    for (const resolve of finish) resolve();
    await expect(first).rejects.toBeInstanceOf(CompileStopped);
    await expect(second).resolves.toMatchObject({ ok: true });
    expect(seen[0]?.aborted).toBe(true);
    expect(seen[1]?.aborted).toBe(false);
  });

  it("stops on request", async () => {
    const port = createBrowserCompilePort({
      engines: [engine(() => new Promise((resolve) => setTimeout(() => resolve(done), 5)))],
      sources: async () => sources({}),
      openSyncTex: async () => index,
    });
    const running = port.compile(target);
    port.stop();
    await expect(running).rejects.toBeInstanceOf(CompileStopped);
  });

  it("opens SyncTeX with the project's paths and has nothing for an output without it", async () => {
    const openSyncTex = vi.fn(async () => index);
    const port = createBrowserCompilePort({
      engines: [engine(async () => done)],
      sources: async () => sources({ "main.tex": "", "sections/intro.tex": "" }),
      openSyncTex,
    });
    const output = await port.compile(target);
    expect(await port.syncTex(output)).toBe(index);
    expect(openSyncTex).toHaveBeenCalledWith(new Uint8Array([2]), ["main.tex", "sections/intro.tex"]);
    expect(await port.syncTex({ ...output, synctex: null })).toBeNull();
  });
});
