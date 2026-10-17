// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  tauri: true,
  fullscreen: false,
  failSetFullscreen: false,
  isFullscreen: vi.fn(async () => host.fullscreen),
  setFullscreen: vi.fn(async (value: boolean) => {
    if (host.failSetFullscreen) throw new Error("denied");
    host.fullscreen = value;
  }),
  reattach: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => host.tauri }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: host.isFullscreen,
    setFullscreen: host.setFullscreen,
  }),
}));
vi.mock("@/lib/preview-window", () => ({ reattachPreviewWindow: host.reattach }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return { useFilesStore: create(() => ({ projectId: "p1" as string | null })) };
});
vi.mock("@/store/tours", async () => {
  const { create } = await import("zustand");
  return { useTourStore: create(() => ({ activeTourId: null as string | null })) };
});

import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { useZenStore } from "@/store/zen";
import {
  enterZenMode,
  exitZenMode,
  openZenCompileLog,
  toggleZenCompileLog,
  toggleZenMode,
  zenFullscreenSettled,
} from "./zen-mode";

const FULL_LAYOUT = {
  showTree: true,
  railTab: "source" as const,
  assistantOpen: true,
  workspaceHidden: false,
  viewMode: "split" as const,
  terminalOpen: true,
  zenFullScreen: true,
  zenShowPdfOnCompile: true,
};

function layout() {
  const s = useSettingsStore.getState();
  return {
    showTree: s.showTree,
    railTab: s.railTab,
    assistantOpen: s.assistantOpen,
    workspaceHidden: s.workspaceHidden,
    viewMode: s.viewMode,
    terminalOpen: s.terminalOpen,
  };
}

beforeEach(() => {
  host.tauri = true;
  host.fullscreen = false;
  host.failSetFullscreen = false;
  host.isFullscreen.mockClear();
  host.setFullscreen.mockClear();
  host.reattach.mockClear();
  useFilesStore.setState({ projectId: "p1" });
  useTourStore.setState({ activeTourId: null });
  usePreviewDetachedStore.setState({ projectId: null });
  useSettingsStore.setState({ ...FULL_LAYOUT, browserOpen: false });
  useZenStore.getState().end();
});

describe("entering Zen mode", () => {
  it("hides the sidebar, assistant and terminal and keeps the editor and PDF", async () => {
    expect(enterZenMode()).toBe(true);
    await zenFullscreenSettled();

    expect(useZenStore.getState()).toMatchObject({ active: true, projectId: "p1" });
    expect(layout()).toEqual({
      showTree: false,
      railTab: "source",
      assistantOpen: false,
      workspaceHidden: false,
      viewMode: "split",
      terminalOpen: false,
    });
    expect(useZenStore.getState().pdfVisibleAtStart).toBe(true);
  });

  it("starts editor-alone when the PDF was not showing", () => {
    useSettingsStore.setState({ viewMode: "editor" });
    enterZenMode();
    expect(layout().viewMode).toBe("editor");
    expect(useZenStore.getState().pdfVisibleAtStart).toBe(false);
  });

  it("brings the editor back from a PDF-only view and keeps the PDF", () => {
    useSettingsStore.setState({ viewMode: "pdf" });
    enterZenMode();
    expect(layout().viewMode).toBe("split");
    expect(useZenStore.getState().pdfVisibleAtStart).toBe(true);
  });

  it("brings the editor back from the assistant-only layout without a PDF", () => {
    useSettingsStore.setState({ viewMode: "split", workspaceHidden: true, assistantOpen: true });
    enterZenMode();
    expect(layout()).toMatchObject({ workspaceHidden: false, assistantOpen: false, viewMode: "editor" });
    expect(useZenStore.getState().pdfVisibleAtStart).toBe(false);
  });

  it("leaves the view mode alone while the preview lives in its own window", () => {
    usePreviewDetachedStore.setState({ projectId: "p1" });
    enterZenMode();
    expect(layout().viewMode).toBe("split");
    expect(useZenStore.getState().pdfVisibleAtStart).toBe(false);
  });

  it("does nothing without an open project", () => {
    useFilesStore.setState({ projectId: null });
    expect(enterZenMode()).toBe(false);
    expect(useZenStore.getState().active).toBe(false);
    expect(layout()).toMatchObject({ showTree: true, assistantOpen: true, terminalOpen: true });
  });

  it("does not start in the middle of a tour", () => {
    useTourStore.setState({ activeTourId: "workspace" });
    expect(enterZenMode()).toBe(false);
    expect(useZenStore.getState().active).toBe(false);
    expect(layout().showTree).toBe(true);
  });

  it("is idempotent while already on", () => {
    enterZenMode();
    useSettingsStore.setState({ showTree: true });
    expect(enterZenMode()).toBe(true);
    expect(useZenStore.getState().snapshot?.showTree).toBe(true);
    expect(useSettingsStore.getState().showTree).toBe(true);
  });

  it("leaves the separate browser window alone", () => {
    useSettingsStore.setState({ webBrowser: true, browserOpen: true });
    enterZenMode();
    expect(useSettingsStore.getState().browserOpen).toBe(true);
    exitZenMode();
    expect(useSettingsStore.getState().browserOpen).toBe(true);
  });
});

describe("leaving Zen mode", () => {
  it("restores exactly the layout from before", async () => {
    enterZenMode();
    await zenFullscreenSettled();
    exitZenMode();
    await zenFullscreenSettled();

    expect(useZenStore.getState()).toMatchObject({ active: false, snapshot: null, projectId: null });
    expect(layout()).toEqual({
      showTree: true,
      railTab: "source",
      assistantOpen: true,
      workspaceHidden: false,
      viewMode: "split",
      terminalOpen: true,
    });
  });

  it.each([
    { viewMode: "editor", assistantOpen: false, showTree: false, terminalOpen: false, railTab: "files" },
    { viewMode: "pdf", assistantOpen: true, showTree: true, terminalOpen: false, railTab: "refs" },
  ] as const)("restores %o", (before) => {
    useSettingsStore.setState({ ...before, workspaceHidden: false });
    enterZenMode();
    exitZenMode();
    expect(layout()).toEqual({ ...before, workspaceHidden: false });
  });

  it("restores the assistant-only layout", () => {
    useSettingsStore.setState({ workspaceHidden: true, assistantOpen: true, viewMode: "split" });
    enterZenMode();
    exitZenMode();
    expect(layout()).toMatchObject({ workspaceHidden: true, assistantOpen: true, viewMode: "split" });
  });

  it("undoes panels toggled on and off while it was on", () => {
    enterZenMode();
    useSettingsStore.setState({ showTree: true, railTab: "refs", terminalOpen: true, viewMode: "editor" });
    exitZenMode();
    expect(layout()).toEqual({
      showTree: true,
      railTab: "source",
      assistantOpen: true,
      workspaceHidden: false,
      viewMode: "split",
      terminalOpen: true,
    });
  });

  it("keeps the layout it finds when told the project changed", () => {
    enterZenMode();
    useSettingsStore.setState({ showTree: true, viewMode: "editor" });
    exitZenMode({ restoreLayout: false });
    expect(useZenStore.getState().active).toBe(false);
    expect(layout()).toMatchObject({ showTree: true, viewMode: "editor" });
  });

  it("is a no-op when it is not on", () => {
    exitZenMode();
    expect(layout()).toMatchObject({ showTree: true, assistantOpen: true });
    expect(host.setFullscreen).not.toHaveBeenCalled();
  });

  it("toggles on and off", () => {
    expect(toggleZenMode()).toBe(true);
    expect(useZenStore.getState().active).toBe(true);
    expect(toggleZenMode()).toBe(false);
    expect(useZenStore.getState().active).toBe(false);
    expect(layout().showTree).toBe(true);
  });
});

describe("full screen", () => {
  it("goes full screen on entering and back on leaving", async () => {
    expect(enterZenMode()).toBe(true);
    expect(useZenStore.getState().fullscreen).toBe("entering");
    await zenFullscreenSettled();
    expect(host.setFullscreen).toHaveBeenCalledWith(true);
    expect(host.fullscreen).toBe(true);
    expect(useZenStore.getState().fullscreen).toBe("on");

    exitZenMode();
    await zenFullscreenSettled();
    expect(host.setFullscreen).toHaveBeenLastCalledWith(false);
    expect(host.fullscreen).toBe(false);
    expect(useZenStore.getState().fullscreen).toBe("none");
  });

  it("leaves a window that was already full screen full screen", async () => {
    host.fullscreen = true;
    enterZenMode();
    await zenFullscreenSettled();
    expect(host.setFullscreen).not.toHaveBeenCalled();
    expect(useZenStore.getState().fullscreen).toBe("none");

    exitZenMode();
    await zenFullscreenSettled();
    expect(host.setFullscreen).not.toHaveBeenCalled();
    expect(host.fullscreen).toBe(true);
  });

  it("stays windowed when Go full screen is off", async () => {
    useSettingsStore.setState({ zenFullScreen: false });
    enterZenMode();
    await zenFullscreenSettled();
    exitZenMode();
    await zenFullscreenSettled();
    expect(host.isFullscreen).not.toHaveBeenCalled();
    expect(host.setFullscreen).not.toHaveBeenCalled();
    expect(useZenStore.getState().fullscreen).toBe("none");
  });

  it("does not touch the window outside the desktop app", async () => {
    host.tauri = false;
    enterZenMode();
    await zenFullscreenSettled();
    exitZenMode();
    await zenFullscreenSettled();
    expect(host.isFullscreen).not.toHaveBeenCalled();
    expect(useZenStore.getState().fullscreen).toBe("none");
  });

  it("falls back to the windowed strip when the window refuses", async () => {
    host.failSetFullscreen = true;
    enterZenMode();
    await zenFullscreenSettled();
    expect(useZenStore.getState().active).toBe(true);
    expect(useZenStore.getState().fullscreen).toBe("none");
    exitZenMode();
    await zenFullscreenSettled();
    expect(host.setFullscreen).toHaveBeenCalledTimes(1);
  });

  it("restores the window even when Zen ends before it finished entering", async () => {
    enterZenMode();
    exitZenMode();
    await zenFullscreenSettled();
    expect(host.fullscreen).toBe(false);
    expect(useZenStore.getState().fullscreen).toBe("none");
  });

  it("restores the window when the project changes", async () => {
    enterZenMode();
    await zenFullscreenSettled();
    exitZenMode({ restoreLayout: false });
    await zenFullscreenSettled();
    expect(host.fullscreen).toBe(false);
  });
});

describe("the compile log", () => {
  beforeEach(() => {
    enterZenMode();
  });

  it("opens the log and shows the PDF pane beside the editor", () => {
    useSettingsStore.setState({ viewMode: "editor" });
    openZenCompileLog();
    expect(useZenStore.getState().logsOpen).toBe(true);
    expect(layout().viewMode).toBe("split");
  });

  it("shows the log even when the PDF is not meant to open on compile", () => {
    useSettingsStore.setState({ viewMode: "editor", zenShowPdfOnCompile: false });
    openZenCompileLog();
    expect(layout().viewMode).toBe("split");
    expect(useZenStore.getState().logsOpen).toBe(true);
  });

  it("brings a detached preview window back first", async () => {
    usePreviewDetachedStore.setState({ projectId: "p1" });
    openZenCompileLog();
    await vi.waitFor(() => expect(host.reattach).toHaveBeenCalledOnce());
    expect(useZenStore.getState().logsOpen).toBe(true);
  });

  it("toggles the log closed again", () => {
    toggleZenCompileLog();
    expect(useZenStore.getState().logsOpen).toBe(true);
    toggleZenCompileLog();
    expect(useZenStore.getState().logsOpen).toBe(false);
  });

  it("forgets the log when Zen ends", () => {
    openZenCompileLog();
    exitZenMode();
    expect(useZenStore.getState().logsOpen).toBe(false);
  });
});

describe("the window permission", () => {
  it("lets the main window change its own full screen state", () => {
    const capability = JSON.parse(
      readFileSync(resolve(process.cwd(), "src-tauri/capabilities/default.json"), "utf8"),
    ) as { windows: string[]; permissions: string[] };
    expect(capability.windows).toContain("main");
    expect(capability.permissions).toContain("core:window:allow-set-fullscreen");
  });
});
