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

import { openPreviewWindow, reattachPreviewWindow, restorePreviewWindow } from "./preview-window";
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
