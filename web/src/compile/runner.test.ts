import { CompileStopped, type SyncTexIndex } from "@oleafly/compile-port";
import { createFakeEngine } from "@oleafly/compile-port/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebApi, WebText } from "../api";
import type { CollabOutputInfo, WebFile } from "../protocol";
import { ManualTimers } from "../testing/fake-socket";
import { initialCompileState, resetWebState, useWeb } from "../store";
import { outputKey, sharedOutputs } from "./outputs";
import { CompileRunner } from "./runner";

const MAIN = "\\documentclass{article}\n\\begin{document}\nHello there.\n\\end{document}\n";
const FILES: WebFile[] = [
  { fileId: "f-main", path: "main.tex", kind: "text", blob: null },
  { fileId: "f-fig", path: "fig.png", kind: "blob", blob: "h-fig" },
];

function pdfInfo(patch: Partial<CollabOutputInfo> = {}): CollabOutputInfo {
  return { kind: "pdf", size: 10, compiledBy: "me", compiledAt: 1_000, mainFile: "main.tex", ...patch };
}

function fakeApi(texts: WebText[] = [{ fileId: "f-main", path: "main.tex", text: MAIN }]) {
  const shared: CollabOutputInfo[] = [];
  return {
    texts: vi.fn(async () => texts),
    blob: vi.fn(async () => new Blob([new Uint8Array([7, 7])])),
    output: vi.fn(async () => new Uint8Array([31, 139, 8])),
    putOutput: vi.fn(async (_project: string, kind: "pdf" | "synctex", bytes: Uint8Array, mainFile: string) => {
      const info = pdfInfo({ kind, size: bytes.length, mainFile, compiledAt: 2_000 + shared.length });
      shared.push(info);
      return info;
    }),
  } as unknown as WebApi & { putOutput: ReturnType<typeof vi.fn>; output: ReturnType<typeof vi.fn> };
}

function setup(options: { api?: ReturnType<typeof fakeApi>; role?: "owner" | "editor" | "viewer"; delayMs?: number } = {}) {
  resetWebState({
    me: { accountId: "me", name: "Me", avatarUrl: null, login: null, email: null },
    projectId: "p1",
    role: options.role ?? "owner",
    files: FILES,
  });
  const api = options.api ?? fakeApi();
  const timers = new ManualTimers();
  let clock = 100_000;
  const index: SyncTexIndex = { forward: vi.fn(async () => null), inverse: vi.fn(async () => null), dispose: vi.fn() };
  const openSyncTex = vi.fn(async () => index);
  const runner = new CompileRunner({
    api,
    projectId: "p1",
    engines: async () => [createFakeEngine({ delayMs: options.delayMs })],
    openSyncTex,
    openText: () => null,
    setTimer: timers.setTimer,
    now: () => clock,
  });
  return { api, runner, timers, index, openSyncTex, advance: (ms: number) => (clock += ms) };
}

describe("CompileRunner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is ready only when an engine compiles the project's target", async () => {
    const { runner } = setup();
    await runner.start();
    expect(useWeb.getState().compile.ready).toBe(true);
    useWeb.setState({ compileSettings: { engine: "quarto" } });
    expect(useWeb.getState().compile.ready).toBe(false);
    runner.stop();
  });

  it("compiles the server's text, shows the result here and shares the PDF and SyncTeX", async () => {
    const { api, runner } = setup();
    await runner.start();
    await runner.compile();
    const compile = useWeb.getState().compile;
    expect(compile).toMatchObject({ status: "done", shown: "local", finishedAt: 100_000 });
    expect(compile.output?.target.mainDocument).toBe("main.tex");
    expect(api.texts).toHaveBeenCalledWith("p1", expect.any(AbortSignal));
    await vi.waitFor(() => expect(useWeb.getState().compile.share).toBe("shared"));
    expect(api.putOutput.mock.calls.map((call) => [call[1], call[3]])).toEqual([
      ["pdf", "main.tex"],
      ["synctex", "main.tex"],
    ]);
    expect(useWeb.getState().compile.sharedKey).toBe(outputKey(pdfInfo({ size: compile.output?.pdf?.length, compiledAt: 2_000 })));
    runner.stop();
  });

  it("doesn't share for a viewer", async () => {
    const { api, runner } = setup({ role: "viewer" });
    await runner.start();
    await runner.compile();
    expect(useWeb.getState().compile.status).toBe("done");
    expect(api.putOutput).not.toHaveBeenCalled();
    runner.stop();
  });

  it("shares at most once a minute, then the newest compile", async () => {
    const { api, runner, timers, advance } = setup();
    await runner.start();
    await runner.compile();
    await vi.waitFor(() => expect(api.putOutput).toHaveBeenCalledTimes(2));
    advance(10_000);
    await runner.compile();
    advance(5_000);
    await runner.compile();
    expect(api.putOutput).toHaveBeenCalledTimes(2);
    expect(timers.delays).toEqual([50_000]);
    advance(45_000);
    timers.runNext();
    await vi.waitFor(() => expect(api.putOutput).toHaveBeenCalledTimes(4));
    runner.stop();
  });

  it("marks a failed share and keeps the PDF here", async () => {
    const api = fakeApi();
    api.putOutput.mockRejectedValueOnce(new Error("too large"));
    const { runner } = setup({ api });
    await runner.start();
    await runner.compile();
    await vi.waitFor(() => expect(useWeb.getState().compile.share).toBe("failed"));
    expect(useWeb.getState().compile.output?.pdf).not.toBeNull();
    runner.stop();
  });

  it("recompiles after edits pause, once this browser compiled the project", async () => {
    const { api, runner, timers } = setup({ role: "viewer" });
    await runner.start();
    runner.edited();
    expect(timers.delays).toEqual([]);
    await runner.compile();
    runner.edited();
    runner.edited();
    expect(timers.delays).toEqual([1_200]);
    timers.runNext();
    await vi.waitFor(() => expect(api.texts).toHaveBeenCalledTimes(2));
    runner.stop();
  });

  it("reports a compile that could not run and ignores one a newer compile stopped", async () => {
    const api = fakeApi();
    api.texts = vi.fn().mockRejectedValueOnce(new CompileStopped()).mockRejectedValueOnce(new Error("offline"));
    const { runner } = setup({ api });
    await runner.start();
    await runner.compile();
    expect(useWeb.getState().compile).toMatchObject({ status: "running", error: null });
    await runner.compile();
    expect(useWeb.getState().compile).toMatchObject({ status: "failed", error: "offline", output: null });
    runner.stop();
  });

  it("switches to the shared PDF when someone else shares a newer one, not for its own", async () => {
    const { runner } = setup();
    await runner.start();
    await runner.compile();
    await vi.waitFor(() => expect(useWeb.getState().compile.share).toBe("shared"));
    const ours = pdfInfo({ size: useWeb.getState().compile.output?.pdf?.length, compiledAt: 2_000 });
    useWeb.setState({ output: [ours] });
    expect(useWeb.getState().compile.shown).toBe("local");
    useWeb.setState({ output: [pdfInfo({ compiledBy: "ana", compiledAt: 9_000 })] });
    expect(useWeb.getState().compile.shown).toBe("shared");
    runner.stop();
  });

  it("opens SyncTeX once per output: this browser's, or the shared one's from the server", async () => {
    const { api, runner, openSyncTex, index } = setup({ role: "viewer" });
    await runner.start();
    expect(await runner.syncIndex()).toBeNull();
    useWeb.setState((state) => ({
      output: [pdfInfo(), pdfInfo({ kind: "synctex", compiledAt: 1_001 })],
      compile: { ...state.compile, shownShared: outputKey(pdfInfo()) },
    }));
    expect(await runner.syncIndex()).toBe(index);
    expect(await runner.syncIndex()).toBe(index);
    expect(api.output).toHaveBeenCalledOnce();
    expect(openSyncTex).toHaveBeenLastCalledWith(new Uint8Array([31, 139, 8]), ["main.tex"]);
    await runner.compile();
    expect(await runner.syncIndex()).toBe(index);
    expect(openSyncTex).toHaveBeenCalledTimes(2);
    expect(index.dispose).toHaveBeenCalledOnce();
    runner.stop();
  });

  it("finds no SyncTeX while the pane still shows an older shared PDF than the newest output", async () => {
    const { runner, openSyncTex, index } = setup({ role: "viewer" });
    await runner.start();
    const older = pdfInfo();
    const newer = pdfInfo({ compiledBy: "ana", compiledAt: 5_000 });
    useWeb.setState((state) => ({
      output: [newer, pdfInfo({ kind: "synctex", compiledBy: "ana", compiledAt: 5_001 })],
      compile: { ...state.compile, shownShared: outputKey(older) },
    }));
    expect(await runner.syncIndex()).toBeNull();
    expect(openSyncTex).not.toHaveBeenCalled();
    useWeb.setState((state) => ({ compile: { ...state.compile, shownShared: outputKey(newer) } }));
    expect(await runner.syncIndex()).toBe(index);
    runner.stop();
  });

  it("has no SyncTeX for a shared PDF whose SyncTeX came from an older compile", () => {
    expect(sharedOutputs([pdfInfo(), pdfInfo({ kind: "synctex", compiledAt: 999 })]).synctex).toBeUndefined();
    expect(sharedOutputs([pdfInfo({ kind: "synctex" })]).pdf).toBeUndefined();
  });

  it("starts with nothing compiled", () => {
    expect(initialCompileState()).toMatchObject({ ready: false, status: "idle", output: null, shown: "shared" });
  });
});
