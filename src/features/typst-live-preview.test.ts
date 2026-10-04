import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create, type StoreApi } from "zustand";

interface FileEntry {
  content: string;
  dirty: boolean;
}

interface FakeFiles {
  projectId: string | null;
  activePath: string | null;
  mainDoc: string;
  loading: boolean;
  engineLoaded: boolean;
  engine: { source_format: string; typst_version: string | null; typst_options: { variants: string[] } | null };
  files: Record<string, FileEntry>;
  saveActive: () => Promise<void>;
}

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  apply: vi.fn(async () => true),
  setStatus: vi.fn(),
  wanted: { value: true },
  revision: { value: 4 },
  saveActive: vi.fn(async () => {}),
  reportSaveFailure: vi.fn(),
  logError: vi.fn(),
  offline: { value: false },
  variant: { value: null as string | null },
  liveStatus: { value: "starting" },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    mocks.handlers.set(name, handler);
    return () => mocks.handlers.delete(name);
  }),
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

const filesStore = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/store/files", () => ({
  useFilesStore: {
    getState: () => (filesStore.current as StoreApi<FakeFiles>).getState(),
    subscribe: (listener: (state: FakeFiles, previous: FakeFiles) => void) =>
      (filesStore.current as StoreApi<FakeFiles>).subscribe(listener),
  },
}));
vi.mock("@/store/settings", () => ({
  useSettingsStore: {
    getState: () => ({ offline: mocks.offline.value }),
    subscribe: () => () => {},
  },
}));
vi.mock("@/store/typst-variant", () => ({
  activeTypstVariant: () => mocks.variant.value,
  useTypstVariantStore: { subscribe: () => () => {} },
}));
vi.mock("@/lib/tex-root", () => ({
  resolveEffectiveMainDoc: () => ({ mainDoc: (filesStore.current as StoreApi<FakeFiles>).getState().mainDoc }),
}));
vi.mock("@/lib/main-document", () => ({ mainDocumentMissing: () => false }));
vi.mock("@/lib/document-engine", () => ({
  compileOfflineForEngine: (_engine: unknown, offline: boolean) => ({ offline, notice: null }),
}));
vi.mock("@/store/compile", () => ({
  applyTypstLiveResult: mocks.apply,
  compileProjectRevision: () => mocks.revision.value,
  reportCompileSaveFailure: mocks.reportSaveFailure,
  saveActiveForCompile: (files: FakeFiles) => files.saveActive(),
  typstLivePreviewWanted: () => mocks.wanted.value,
  useCompileStore: {
    getState: () => ({
      setLivePreviewStatus: mocks.setStatus,
      livePreview: { projectId: "project", status: mocks.liveStatus.value },
    }),
  },
}));

import {
  LIVE_SAVE_DEBOUNCE_MS,
  compileLive,
  disposeLivePreview,
  interruptLivePreview,
  stopLivePreview,
  syncLivePreview,
} from "./typst-live-preview";

function typstFiles(over: Partial<FakeFiles> = {}): FakeFiles {
  return {
    projectId: "project",
    activePath: "main.typ",
    mainDoc: "main.typ",
    loading: false,
    engineLoaded: true,
    engine: { source_format: "typst", typst_version: null, typst_options: { variants: [] } },
    files: { "main.typ": { content: "= Hello", dirty: false } },
    saveActive: mocks.saveActive,
    ...over,
  };
}

const store = create<FakeFiles>(() => typstFiles());
filesStore.current = store;

function emit(name: string, payload: unknown) {
  mocks.handlers.get(name)?.({ payload });
}

function edit(content: string) {
  store.setState((state) => ({
    files: { ...state.files, "main.typ": { content, dirty: true } },
  }));
}

function invokedWith(command: string) {
  return mocks.invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

beforeEach(async () => {
  vi.useFakeTimers();
  store.setState(typstFiles(), true);
  mocks.wanted.value = true;
  mocks.offline.value = false;
  mocks.variant.value = null;
  mocks.liveStatus.value = "starting";
  mocks.revision.value = 4;
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "typst_watch_start") return { sessionId: 7, started: true };
    if (command === "typst_watch_stop") return true;
    if (command === "typst_watch_compile") return { ok: true, output_revision: 9 };
    return undefined;
  });
  mocks.apply.mockClear();
  mocks.setStatus.mockClear();
  mocks.saveActive.mockReset().mockResolvedValue(undefined);
  mocks.reportSaveFailure.mockClear();
  mocks.logError.mockClear();
});

afterEach(async () => {
  await disposeLivePreview();
  vi.useRealTimers();
});

describe("Typst live preview", () => {
  it("starts one watch session with the project's variant and offline policy", async () => {
    mocks.offline.value = true;
    mocks.variant.value = "draft";
    await syncLivePreview();
    await syncLivePreview();
    expect(invokedWith("typst_watch_start")).toEqual([
      { projectId: "project", mainDoc: "main.typ", offline: true, typstVariant: "draft" },
    ]);
    expect(mocks.setStatus).toHaveBeenCalledWith("project", "on", null);
  });

  it("saves the active file once after the typing pause and never other files", async () => {
    await syncLivePreview();
    edit("= Hel");
    edit("= Hell");
    store.setState((state) => ({
      files: { ...state.files, "other.typ": { content: "x", dirty: true } },
    }));
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DEBOUNCE_MS - 1);
    expect(mocks.saveActive).not.toHaveBeenCalled();
    edit("= Hello again");
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DEBOUNCE_MS);
    expect(mocks.saveActive).toHaveBeenCalledTimes(1);
  });

  it("does not save while live preview is off", async () => {
    mocks.wanted.value = false;
    await syncLivePreview();
    edit("= Changed");
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DEBOUNCE_MS * 4);
    expect(mocks.saveActive).not.toHaveBeenCalled();
    expect(invokedWith("typst_watch_start")).toEqual([]);
  });

  it("reports a failed save the same way a compile save failure is reported", async () => {
    await syncLivePreview();
    mocks.saveActive.mockRejectedValueOnce(new Error("disk full"));
    edit("= Broken save");
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DEBOUNCE_MS);
    expect(mocks.reportSaveFailure).toHaveBeenCalledTimes(1);
  });

  it("hands each watch result to the compile store with the revision that was saved", async () => {
    await syncLivePreview();
    mocks.revision.value = 5;
    edit("= Saved text");
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DEBOUNCE_MS);
    mocks.revision.value = 6;
    edit("= Unsaved text");
    emit("typst-watch:status", { projectId: "project", mainDocument: "main.typ", sessionId: 7, state: "compiling", message: null });
    const result = { ok: true, output_revision: 3, output_id: "pdf-v1:1:0000000000000000" };
    emit("typst-watch:result", { projectId: "project", mainDocument: "main.typ", sessionId: 7, cycle: 1, result });
    expect(mocks.apply).toHaveBeenCalledWith({
      projectId: "project",
      mainDocument: "main.typ",
      projectRevision: 5,
      result,
    });
    expect(mocks.setStatus).toHaveBeenCalledWith("project", "compiling", null);
  });

  it("ignores results from another project or an older session", async () => {
    await syncLivePreview();
    emit("typst-watch:result", { projectId: "elsewhere", mainDocument: "main.typ", sessionId: 7, cycle: 1, result: { ok: true } });
    emit("typst-watch:result", { projectId: "project", mainDocument: "main.typ", sessionId: 6, cycle: 1, result: { ok: true } });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it("shows why the watcher gave up", async () => {
    await syncLivePreview();
    emit("typst-watch:status", { projectId: "project", mainDocument: "main.typ", sessionId: 7, state: "failed", message: "Typst crashed" });
    expect(mocks.setStatus).toHaveBeenLastCalledWith("project", "failed", "Typst crashed");
  });

  it("stops the session when the project closes or stops being Typst", async () => {
    await syncLivePreview();
    store.setState({ engine: { source_format: "latex", typst_version: null, typst_options: null } });
    mocks.wanted.value = false;
    await vi.waitFor(() => expect(invokedWith("typst_watch_stop")).toEqual([{ projectId: "project" }]));

    mocks.wanted.value = true;
    store.setState({ engine: { source_format: "typst", typst_version: null, typst_options: { variants: [] } } });
    await vi.waitFor(() => expect(invokedWith("typst_watch_start")).toHaveLength(2));
    mocks.wanted.value = false;
    store.setState({ projectId: null });
    await vi.waitFor(() => expect(invokedWith("typst_watch_stop")).toHaveLength(2));
  });

  it("restarts with new arguments when the Typst version changes", async () => {
    await syncLivePreview();
    store.setState({ engine: { source_format: "typst", typst_version: "0.13.1", typst_options: { variants: [] } } });
    await vi.waitFor(() => expect(invokedWith("typst_watch_start")).toHaveLength(2));
  });

  it("starts again on the next save after the watcher went idle", async () => {
    await syncLivePreview();
    emit("typst-watch:status", { projectId: "project", mainDocument: "main.typ", sessionId: 7, state: "idle", message: null });
    edit("= Back again");
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(invokedWith("typst_watch_start")).toHaveLength(2));
  });

  it("compiles through the watcher and remembers the running session", async () => {
    const result = await compileLive({
      projectId: "project",
      mainDoc: "main.typ",
      offline: false,
      typstVariant: null,
      fresh: true,
    });
    expect(result).toEqual({ ok: true, output_revision: 9 });
    expect(invokedWith("typst_watch_compile")).toEqual([
      { projectId: "project", mainDoc: "main.typ", offline: false, typstVariant: null, fresh: true },
    ]);
    await syncLivePreview();
    expect(invokedWith("typst_watch_start")).toEqual([]);
    await stopLivePreview();
    expect(invokedWith("typst_watch_stop")).toEqual([{ projectId: "project" }]);
  });

  it("stops a running cycle and waits for the next edit before Typst starts again", async () => {
    await syncLivePreview();
    mocks.liveStatus.value = "compiling";
    mocks.setStatus.mockClear();
    await interruptLivePreview();
    expect(invokedWith("typst_watch_stop")).toEqual([{ projectId: "project" }]);
    expect(mocks.setStatus).toHaveBeenCalledWith("project", "on", null);
    await syncLivePreview();
    expect(invokedWith("typst_watch_start")).toHaveLength(1);

    edit("= After the stop");
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(invokedWith("typst_watch_start")).toHaveLength(2));
  });

  it("drops a pending save when compilation is stopped", async () => {
    await syncLivePreview();
    edit("= Typed just before stop");
    await interruptLivePreview();
    await vi.advanceTimersByTimeAsync(LIVE_SAVE_DEBOUNCE_MS * 2);
    expect(mocks.saveActive).not.toHaveBeenCalled();
  });

  it("leaves a watcher that gave up alone", async () => {
    await syncLivePreview();
    mocks.liveStatus.value = "failed";
    mocks.setStatus.mockClear();
    await interruptLivePreview();
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it("does nothing without a watch session", async () => {
    await interruptLivePreview();
    expect(invokedWith("typst_watch_stop")).toEqual([]);
  });

  it("reports a watched compile that was stopped as stopped", async () => {
    let reject: (error: unknown) => void = () => {};
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "typst_watch_start") return { sessionId: 7, started: true };
      if (command === "typst_watch_stop") {
        reject("the live preview stopped");
        return true;
      }
      if (command === "typst_watch_compile") return new Promise((_resolve, fail) => { reject = fail; });
      return undefined;
    });
    await syncLivePreview();
    const pending = compileLive({ projectId: "project", mainDoc: "main.typ", offline: false, typstVariant: null, fresh: true });
    await vi.waitFor(() => expect(invokedWith("typst_watch_compile")).toHaveLength(1));
    await interruptLivePreview();
    await expect(pending).resolves.toMatchObject({ ok: false, stopped: true, has_pdf: false });
  });

  it("still fails a watched compile that broke on its own", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "typst_watch_compile") throw new Error("Typst crashed");
      return undefined;
    });
    await expect(
      compileLive({ projectId: "project", mainDoc: "main.typ", offline: false, typstVariant: null, fresh: true }),
    ).rejects.toThrow("Typst crashed");
  });

  it("keeps the session while the project reloads", async () => {
    await syncLivePreview();
    store.setState({ loading: true });
    await syncLivePreview();
    store.setState({ loading: false });
    await syncLivePreview();

    expect(invokedWith("typst_watch_stop")).toEqual([]);
    expect(invokedWith("typst_watch_start")).toHaveLength(1);
  });

  it("shows why the watcher could not start", async () => {
    const failure = new Error("typst missing");
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "typst_watch_start") throw failure;
      return undefined;
    });

    await syncLivePreview();

    expect(mocks.logError).toHaveBeenCalledWith("start live preview", failure);
    expect(mocks.setStatus).toHaveBeenLastCalledWith("project", "failed", "typst missing");
  });

  it("logs a watcher that could not be stopped or interrupted", async () => {
    await syncLivePreview();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "typst_watch_stop") throw new Error("already gone");
      return undefined;
    });

    await interruptLivePreview();
    await stopLivePreview();

    expect(mocks.logError.mock.calls.filter(([what]) => what === "stop live preview")).toHaveLength(2);
  });

  it("logs a watch result the compile store could not apply", async () => {
    await syncLivePreview();
    mocks.apply.mockRejectedValueOnce(new Error("bad pdf"));

    emit("typst-watch:result", { projectId: "project", mainDocument: "main.typ", sessionId: 7, cycle: 1, result: { ok: true } });
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("live preview", expect.any(Error)));
  });

  it("ignores status from another project and has no status for a stopped watcher", async () => {
    await syncLivePreview();
    mocks.setStatus.mockClear();

    emit("typst-watch:status", { projectId: "elsewhere", mainDocument: "main.typ", sessionId: 7, state: "failed", message: "x" });
    emit("typst-watch:status", { projectId: "project", mainDocument: "main.typ", sessionId: 7, state: "stopped", message: null });

    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it("stops a compile that started before any watch session", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "typst_watch_compile") return new Promise((resolve) => (finish = resolve));
      return true;
    });
    const pending = compileLive({ projectId: "project", mainDoc: "main.typ", offline: false, typstVariant: null, fresh: false });
    await vi.waitFor(() => expect(invokedWith("typst_watch_compile")).toHaveLength(1));

    await interruptLivePreview();
    finish({ ok: true, output_revision: 2 });

    await expect(pending).resolves.toEqual({ ok: true, output_revision: 2 });
    expect(invokedWith("typst_watch_stop")).toEqual([{ projectId: "project" }]);
    await syncLivePreview();
    expect(invokedWith("typst_watch_start")).toEqual([]);
  });
});
