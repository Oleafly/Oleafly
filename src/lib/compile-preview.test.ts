// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const recompile = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return { useFilesStore: create(() => ({ projectId: "p1" as string | null })) };
});
vi.mock("@/store/compile", async () => {
  const { create } = await import("zustand");
  return { useCompileStore: create(() => ({ recompile })) };
});

import { useSettingsStore } from "@/store/settings";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useZenStore } from "@/store/zen";
import { useFilesStore } from "@/store/files";
import { recompileWithPreview, revealPreviewForCompile, togglePreviewPane } from "./compile-preview";

function startZen() {
  useZenStore.getState().begin({
    projectId: "p1",
    snapshot: {
      showTree: true,
      railTab: "files",
      assistantOpen: false,
      workspaceHidden: false,
      viewMode: "editor",
      terminalOpen: false,
    },
    pdfVisibleAtStart: false,
    fullscreen: "none",
  });
}

beforeEach(() => {
  recompile.mockClear();
  useZenStore.getState().end();
  usePreviewDetachedStore.setState({ projectId: null });
  useSettingsStore.setState({ viewMode: "editor", zenShowPdfOnCompile: true });
});

describe("toggling the PDF preview", () => {
  it("shows the PDF beside the editor and hides it again", () => {
    expect(togglePreviewPane()).toBe(true);
    expect(useSettingsStore.getState().viewMode).toBe("split");
    expect(togglePreviewPane()).toBe(true);
    expect(useSettingsStore.getState().viewMode).toBe("editor");
  });

  it("goes to the editor alone from the PDF alone, and shows a hidden workspace", () => {
    useSettingsStore.setState({ viewMode: "pdf" });
    togglePreviewPane();
    expect(useSettingsStore.getState().viewMode).toBe("editor");
    useSettingsStore.setState({ viewMode: "split", workspaceHidden: true });
    togglePreviewPane();
    expect(useSettingsStore.getState()).toMatchObject({ viewMode: "split", workspaceHidden: false });
  });

  it("does nothing without a project or while the PDF is in its own window", () => {
    usePreviewDetachedStore.setState({ projectId: "p1" });
    expect(togglePreviewPane()).toBe(false);
    expect(useSettingsStore.getState().viewMode).toBe("editor");
    usePreviewDetachedStore.setState({ projectId: null });
    useFilesStore.setState({ projectId: null });
    expect(togglePreviewPane()).toBe(false);
    useFilesStore.setState({ projectId: "p1" });
  });
});

describe("revealing the preview for a compile", () => {
  it("opens the preview beside an editor-only view", () => {
    revealPreviewForCompile();
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("leaves a detached preview alone", () => {
    usePreviewDetachedStore.setState({ projectId: "p1" });
    revealPreviewForCompile();
    expect(useSettingsStore.getState().viewMode).toBe("editor");
  });

  it("opens the preview in Zen mode when it is set to show on compile", () => {
    startZen();
    revealPreviewForCompile();
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("keeps the editor alone in Zen mode when it is set not to show on compile", () => {
    startZen();
    useSettingsStore.setState({ zenShowPdfOnCompile: false });
    revealPreviewForCompile();
    expect(useSettingsStore.getState().viewMode).toBe("editor");
    void recompileWithPreview();
    expect(useSettingsStore.getState().viewMode).toBe("editor");
    expect(recompile).toHaveBeenCalledOnce();
  });

  it("still reveals the preview outside Zen mode when that setting is off", () => {
    useSettingsStore.setState({ zenShowPdfOnCompile: false });
    revealPreviewForCompile();
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });
});
