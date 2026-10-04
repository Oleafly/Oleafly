import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({ tauri: true }));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
const { emit } = vi.hoisted(() => ({ emit: vi.fn(async () => {}) }));
const { availableMonitors } = vi.hoisted(() => ({ availableMonitors: vi.fn() }));
const { WebviewWindow, getByLabel, once, setFocus } = vi.hoisted(() => {
  const once = vi.fn();
  const setFocus = vi.fn();
  const getByLabel = vi.fn();
  const WebviewWindow = vi.fn(
    class {
      once = once;
    },
  );
  (WebviewWindow as unknown as { getByLabel: unknown }).getByLabel = getByLabel;
  return { WebviewWindow, getByLabel, once, setFocus };
});

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => state.tauri }));
vi.mock("@tauri-apps/api/event", () => ({ emit }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({ WebviewWindow }));
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors }));
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/project-state-revision", () => ({
  currentProjectStateRevision: () => 7,
}));

import {
  isPreviewWindowState,
  openPreviewWindow,
  reattachPreviewWindow,
  refreshPreviewWindow,
  restorePreviewWindow,
  retargetPreviewWindow,
} from "./preview-window";
import { createCompileSuccessCheckpoint } from "@/lib/compile-checkpoint";
import { setPreviewDetached, usePreviewDetachedStore, wantsDetachedPreview } from "@/store/preview-detached";

beforeEach(async () => {
  state.tauri = true;
  getByLabel.mockReset().mockResolvedValue(null);
  await restorePreviewWindow(null, "");
  localStorage.clear();
  availableMonitors.mockReset().mockResolvedValue([{ position: { x: 0, y: 0 }, size: { width: 3840, height: 2160 }, scaleFactor: 2 }]);
  logError.mockReset();
  emit.mockClear();
  WebviewWindow.mockClear();
  getByLabel.mockReset();
  once.mockReset();
  setFocus.mockReset();
});

describe("openPreviewWindow", () => {
  it("does nothing in the browser dev server", async () => {
    state.tauri = false;
    await openPreviewWindow("p1", "Paper");
    expect(getByLabel).not.toHaveBeenCalled();
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("retargets and focuses an open window rather than making a second one", async () => {
    getByLabel.mockResolvedValue({ setFocus, once });
    await openPreviewWindow("p2", "Paper");
    expect(emit).toHaveBeenCalledWith("preview:project", { projectId: "p2" });
    expect(setFocus).toHaveBeenCalledTimes(1);
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("carries the project and title into the new window", async () => {
    getByLabel.mockResolvedValue(null);
    await openPreviewWindow("p3", "Thesis");
    const [label, options] = WebviewWindow.mock.calls[0] as unknown as [
      string,
      { url: string; title: string },
    ];
    expect(label).toBe("preview");
    expect(options.url).toContain("project=p3");
    expect(options.url).toContain("view=preview");
    expect(options.title).toBe("Preview: Thesis");
  });

  it("falls back to the app name when the project has no title", async () => {
    getByLabel.mockResolvedValue(null);
    await openPreviewWindow("p4", "");
    const [, options] = WebviewWindow.mock.calls[0] as unknown as [
      string,
      { title: string },
    ];
    expect(options.title).toBe("Preview: Oleafly");
  });

  it("reports a window that fails to open instead of failing silently", async () => {
    getByLabel.mockResolvedValue(null);
    await openPreviewWindow("p5", "Paper");
    const [event, handler] = once.mock.calls.find(([name]) => name === "tauri://error") as unknown as [
      string,
      (e: { payload: unknown }) => void,
    ];
    expect(event).toBe("tauri://error");
    handler({ payload: "no display" });
    expect(logError).toHaveBeenCalledWith("preview-window", "no display");
  });

  it("restores saved logical bounds on a connected scaled monitor", async () => {
    const geometry = { x: 120, y: 80, width: 800, height: 600 };
    localStorage.setItem("oleafly.preview.geometry.paper", JSON.stringify(geometry));
    await openPreviewWindow("paper", "Paper");
    expect(WebviewWindow).toHaveBeenCalledWith("preview", expect.objectContaining({ ...geometry, center: false }));
  });

  it.each([
    { x: -1000, y: 0 }, { x: 2000, y: 0 }, { x: 0, y: -100 }, { x: 0, y: 1100 },
  ])("recenters saved bounds outside the current display: %j", async (position) => {
    localStorage.setItem("oleafly.preview.geometry.paper", JSON.stringify({ ...position, width: 800, height: 600 }));
    await openPreviewWindow("paper", "Paper");
    expect(WebviewWindow).toHaveBeenCalledWith("preview", expect.objectContaining({ width: 800, height: 600, center: true }));
    const [, options] = WebviewWindow.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(options).not.toHaveProperty("x");
    expect(options).not.toHaveProperty("y");
  });

  it("keeps the saved size if the monitor query fails", async () => {
    localStorage.setItem("oleafly.preview.geometry.paper", JSON.stringify({ x: 100, y: 100, width: 800, height: 600 }));
    availableMonitors.mockRejectedValue(new Error("display unavailable"));
    await openPreviewWindow("paper", "Paper");
    expect(WebviewWindow).toHaveBeenCalledWith("preview", expect.objectContaining({ width: 800, height: 600, center: true }));
  });

  it("updates the saved detached preference only for the currently tracked window", async () => {
    await openPreviewWindow("first", "First");
    const created = once.mock.calls.find(([event]) => event === "tauri://created")?.[1];
    const destroyed = once.mock.calls.find(([event]) => event === "tauri://destroyed")?.[1];
    created();
    expect(wantsDetachedPreview("first")).toBe(true);
    expect(usePreviewDetachedStore.getState().projectId).toBe("first");

    once.mockClear();
    await openPreviewWindow("second", "Second");
    created();
    destroyed();
    expect(wantsDetachedPreview("first")).toBe(true);
    once.mock.calls.find(([event]) => event === "tauri://created")?.[1]();
    expect(usePreviewDetachedStore.getState().projectId).toBe("second");
    once.mock.calls.find(([event]) => event === "tauri://destroyed")?.[1]();
    expect(usePreviewDetachedStore.getState().projectId).toBeNull();
    expect(wantsDetachedPreview("second")).toBe(false);
  });
});

describe("restoring detached previews", () => {
  it("destroys the previous window and restores the next project's saved layout", async () => {
    setPreviewDetached("old", true);
    setPreviewDetached("next", true);
    const destroy = vi.fn(async () => {});
    getByLabel.mockResolvedValueOnce({ destroy }).mockResolvedValue(null);
    await restorePreviewWindow("next", "Next");
    expect(destroy).toHaveBeenCalledOnce();
    expect(wantsDetachedPreview("old")).toBe(true);
    expect(WebviewWindow).toHaveBeenCalledWith("preview", expect.objectContaining({ title: "Preview: Next" }));
  });

  it("keeps projects with an attached preview in the main window", async () => {
    const destroy = vi.fn(async () => {});
    getByLabel.mockResolvedValue({ destroy });
    await restorePreviewWindow("attached", "Paper");
    expect(destroy).toHaveBeenCalledOnce();
    expect(WebviewWindow).not.toHaveBeenCalled();
    expect(usePreviewDetachedStore.getState().projectId).toBeNull();
  });

  it("leaves an already tracked project window open", async () => {
    await openPreviewWindow("paper", "Paper");
    getByLabel.mockClear();
    WebviewWindow.mockClear();
    await restorePreviewWindow("paper", "Paper");
    expect(getByLabel).not.toHaveBeenCalled();
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("ignores a stale window lookup after a newer project switch", async () => {
    let resolveLookup!: (value: null) => void;
    getByLabel.mockReturnValueOnce(new Promise((resolve) => { resolveLookup = resolve; })).mockResolvedValue(null);
    setPreviewDetached("old", true);
    setPreviewDetached("next", true);
    const older = restorePreviewWindow("old", "Old");
    await restorePreviewWindow("next", "Next");
    resolveLookup(null);
    await older;
    expect(WebviewWindow).toHaveBeenCalledOnce();
    expect(WebviewWindow).toHaveBeenCalledWith("preview", expect.objectContaining({ title: "Preview: Next" }));
  });

  it("does not reopen a project after switching away while its old window closes", async () => {
    let finishDestroy!: () => void;
    const destroy = vi.fn(() => new Promise<void>((resolve) => { finishDestroy = resolve; }));
    getByLabel.mockResolvedValueOnce({ destroy }).mockResolvedValue(null);
    setPreviewDetached("old", true);
    const older = restorePreviewWindow("old", "Old");
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
    await restorePreviewWindow(null, "");
    finishDestroy();
    await older;
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("does not create a window if the project changes during monitor lookup", async () => {
    let resolveMonitors!: (value: []) => void;
    availableMonitors.mockReturnValue(new Promise((resolve) => { resolveMonitors = resolve; }));
    localStorage.setItem("oleafly.preview.geometry.paper", JSON.stringify({ x: 0, y: 0, width: 800, height: 600 }));
    const opening = openPreviewWindow("paper", "Paper");
    await vi.waitFor(() => expect(availableMonitors).toHaveBeenCalledOnce());
    await restorePreviewWindow(null, "");
    resolveMonitors([]);
    await opening;
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("does nothing outside Tauri", async () => {
    state.tauri = false;
    await restorePreviewWindow("paper", "Paper");
    expect(getByLabel).not.toHaveBeenCalled();
  });

  it("closes the detached window when reattaching and tolerates an already closed window", async () => {
    const close = vi.fn(async () => {});
    getByLabel.mockResolvedValueOnce({ close }).mockResolvedValueOnce(null);
    await reattachPreviewWindow();
    await reattachPreviewWindow();
    expect(close).toHaveBeenCalledOnce();
  });
});

const identity = { projectId: "p1", mainDocument: "main.tex", projectRevision: 3, requestGeneration: 4 };
const checkpoint = createCompileSuccessCheckpoint({
  ...identity,
  outputKind: "standard",
  producerId: "main",
  outputRevision: 1,
  outputId: "pdf-v1:1:0123456789abcdef",
  previousCompletedAt: null,
  now: 1,
});

describe("preview window state", () => {
  it("sends a stamped refresh and project switches to the detached window", () => {
    refreshPreviewWindow({ identity, status: "compiling", checkpoint: null });
    refreshPreviewWindow();
    retargetPreviewWindow("p2");
    expect(emit.mock.calls).toEqual([
      ["preview:refresh", { identity, status: "compiling", checkpoint: null, projectStateRevision: 7 }],
      ["preview:refresh", undefined],
      ["preview:project", { projectId: "p2" }],
    ]);
  });

  it("sends nothing outside the desktop shell", () => {
    state.tauri = false;
    refreshPreviewWindow({ identity, status: "not_run", checkpoint: null, projectStateRevision: 2 });
    retargetPreviewWindow("p2");
    expect(emit).not.toHaveBeenCalled();
  });

  it("hands an initial state to an open window and to a new window", async () => {
    getByLabel.mockResolvedValueOnce({ setFocus, once });
    const initial = { identity, status: "success" as const, checkpoint, projectStateRevision: 9 };
    await openPreviewWindow("p1", "Paper", initial);
    expect(emit).toHaveBeenCalledWith("preview:refresh", initial);

    getByLabel.mockResolvedValueOnce(null);
    await restorePreviewWindow(null, "");
    getByLabel.mockResolvedValueOnce(null);
    await openPreviewWindow("p1", "Paper", { identity, status: "error", checkpoint: null, message: "failed" });
    const [, options] = WebviewWindow.mock.calls.at(-1) as unknown as [string, { url: string }];
    const url = new URLSearchParams(options.url.split("?")[1]);
    expect(JSON.parse(url.get("state") ?? "null")).toEqual({
      identity,
      status: "error",
      checkpoint: null,
      message: "failed",
      projectStateRevision: 7,
    });
  });

  it.each([
    ["nothing", null],
    ["a non-object", "state"],
    ["a negative revision", { projectStateRevision: -1, identity, status: "not_run", checkpoint: null }],
    ["an identity without a main document", { projectStateRevision: 1, identity: { ...identity, mainDocument: "" }, status: "not_run", checkpoint: null }],
    ["a missing identity", { projectStateRevision: 1, status: "not_run", checkpoint: null }],
    ["an unknown status", { projectStateRevision: 1, identity, status: "done", checkpoint: null }],
    ["a malformed checkpoint", { projectStateRevision: 1, identity, status: "error", checkpoint: { projectId: "p1" } }],
    ["a non-text message", { projectStateRevision: 1, identity, status: "error", checkpoint: null, message: 5 }],
    ["an overlong message", { projectStateRevision: 1, identity, status: "error", checkpoint: null, message: "x".repeat(4_097) }],
    ["a success without its checkpoint", { projectStateRevision: 1, identity, status: "success", checkpoint: null }],
    ["a checkpoint from another request", { projectStateRevision: 1, identity: { ...identity, requestGeneration: 5 }, status: "error", checkpoint }],
  ])("rejects %s", (_label, value) => {
    expect(isPreviewWindowState(value)).toBe(false);
  });

  it("accepts a success with its exact checkpoint and failures that keep it", () => {
    expect(isPreviewWindowState({ projectStateRevision: 1, identity, status: "success", checkpoint })).toBe(true);
    expect(isPreviewWindowState({ projectStateRevision: 1, identity, status: "error", checkpoint, message: "x" })).toBe(true);
  });
});
