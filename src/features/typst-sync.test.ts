import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  logError: vi.fn(),
  compiledSources: null as null | { fsEpoch: number; texts: Record<string, string> },
  listeners: [] as ((state: { projectId: string | null; engine: { id: string } }) => void)[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/store/compile", () => ({
  useCompileStore: { getState: () => ({ compiledSources: mocks.compiledSources }) },
}));
vi.mock("@/store/files", () => ({
  useFilesStore: {
    subscribe: (listener: (state: { projectId: string | null; engine: { id: string } }) => void) => {
      mocks.listeners.push(listener);
      return () => {
        mocks.listeners = mocks.listeners.filter((entry) => entry !== listener);
      };
    },
  },
}));

import { typstForward, typstInverse, watchTypstSyncProject } from "./typst-sync";

function emit(projectId: string | null, engine = "typst") {
  for (const listener of [...mocks.listeners]) listener({ projectId, engine: { id: engine } });
}

describe("typst sync bridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(null);
    mocks.logError.mockReset();
    mocks.compiledSources = null;
  });

  it("asks for a forward jump with the compiled sources", async () => {
    mocks.compiledSources = { fsEpoch: 3, texts: { "main.typ": "= A\nBody", "refs.bib": "@a{}" } };
    const rect = { page: 2, x: 70, y: 87, width: 96, height: 12 };
    mocks.invoke.mockResolvedValueOnce(rect);

    await expect(
      typstForward({ projectId: "p", mainDoc: "main.typ", file: "main.typ", line: 2, column: 3 }),
    ).resolves.toEqual(rect);

    expect(mocks.invoke).toHaveBeenCalledWith("typst_sync_forward", {
      request: {
        projectId: "p",
        mainDoc: "main.typ",
        file: "main.typ",
        line: 2,
        column: 3,
        sources: { "main.typ": "= A\nBody", "refs.bib": "@a{}" },
      },
    });
  });

  it("sends no sources when the compile kept no snapshot", async () => {
    await typstInverse({ projectId: "p", mainDoc: "main.typ", page: 1, x: 10, y: 20 });

    expect(mocks.invoke).toHaveBeenCalledWith("typst_sync_inverse", {
      request: { projectId: "p", mainDoc: "main.typ", page: 1, x: 10, y: 20, sources: {} },
    });
  });

  it("stops the preview server when its project closes or stops being Typst", async () => {
    watchTypstSyncProject("p");
    watchTypstSyncProject("p");
    emit("p");
    expect(mocks.invoke).not.toHaveBeenCalled();

    emit("q");
    expect(mocks.invoke).toHaveBeenCalledWith("typst_sync_stop", { projectId: "p" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    emit(null);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    watchTypstSyncProject("q");
    emit("q", "latex");
    expect(mocks.invoke).toHaveBeenLastCalledWith("typst_sync_stop", { projectId: "q" });
  });

  it("logs a failed stop instead of raising it", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("gone"));
    watchTypstSyncProject("p");
    emit(null);
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("typst sync stop", expect.any(Error)));
  });
});
