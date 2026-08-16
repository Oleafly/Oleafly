import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({ tauri: true }));
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
const { emit } = vi.hoisted(() => ({ emit: vi.fn(async () => {}) }));
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
vi.mock("@/lib/log", () => ({ logError }));
vi.mock("@/lib/project-state-revision", () => ({
  currentProjectStateRevision: () => 7,
}));

import { openPreviewWindow } from "./preview-window";

beforeEach(() => {
  state.tauri = true;
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
    getByLabel.mockResolvedValue({ setFocus });
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
    const [event, handler] = once.mock.calls[0] as unknown as [
      string,
      (e: { payload: unknown }) => void,
    ];
    expect(event).toBe("tauri://error");
    handler({ payload: "no display" });
    expect(logError).toHaveBeenCalledWith("preview-window", "no display");
  });
});
