// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { useZenStore } from "@/store/zen";
import { readWorkspaceLayout, restoreWorkspaceLayout } from "./workspace-layout";

beforeEach(() => {
  localStorage.clear();
  useZenStore.getState().end();
  useSettingsStore.setState({ defaultView: "editor-only", openInTree: true });
});

describe("project workspace preferences", () => {
  it("closes the terminal on project open, including layouts saved by older versions", () => {
    localStorage.setItem("oleafly.workspace.first", JSON.stringify({ version: 1, terminalOpen: true, assistantOpen: true }));
    useSettingsStore.setState({ terminalOpen: true });
    const off = restoreWorkspaceLayout("first");
    expect(useSettingsStore.getState()).toMatchObject({ terminalOpen: false, assistantOpen: true });
    useSettingsStore.setState({ terminalOpen: true, viewMode: "split" });
    expect(readWorkspaceLayout("first")).not.toHaveProperty("terminalOpen");
    off();
  });

  it("opens new projects in Source with the file tree and no optional panels", () => {
    const off = restoreWorkspaceLayout("new");
    expect(useSettingsStore.getState()).toMatchObject({ viewMode: "editor", showTree: true, assistantOpen: false, terminalOpen: false });
    off();
  });

  it("restores each project's layout independently", () => {
    let off = restoreWorkspaceLayout("first");
    useSettingsStore.setState({ viewMode: "split", showTree: false, assistantOpen: true });
    off();
    off = restoreWorkspaceLayout("other");
    expect(useSettingsStore.getState()).toMatchObject({ viewMode: "editor", showTree: true, assistantOpen: false });
    useSettingsStore.setState({ viewMode: "pdf" });
    off();
    off = restoreWorkspaceLayout("first");
    expect(useSettingsStore.getState()).toMatchObject({ viewMode: "split", showTree: false, assistantOpen: true });
    off();
    expect(readWorkspaceLayout("other").viewMode).toBe("pdf");
  });

  it("ignores malformed and unknown saved values without changing unrelated preferences", () => {
    localStorage.setItem("oleafly.workspace.bad", JSON.stringify({ version: 1, viewMode: "bad", showTree: "yes", assistantOpen: false, workspaceHidden: true, appFontSize: 99 }));
    expect(readWorkspaceLayout("bad")).toEqual({ assistantOpen: false, workspaceHidden: false });
    localStorage.setItem("oleafly.workspace.bad", "{oops");
    expect(readWorkspaceLayout("bad")).toEqual({});
  });
});

describe("Zen mode and the saved layout", () => {
  it("does not save the layout Zen mode shows, so a restart never starts in Zen", () => {
    const off = restoreWorkspaceLayout("zen");
    useSettingsStore.setState({ viewMode: "split", showTree: true, assistantOpen: true });
    const saved = localStorage.getItem("oleafly.workspace.zen");
    expect(saved).not.toBeNull();

    useZenStore.getState().begin({
      projectId: "zen",
      snapshot: {
        showTree: true,
        railTab: "files",
        assistantOpen: true,
        workspaceHidden: false,
        viewMode: "split",
        terminalOpen: false,
      },
      pdfVisibleAtStart: true,
      fullscreen: "none",
    });
    useSettingsStore.setState({ showTree: false, assistantOpen: false, viewMode: "editor" });
    expect(localStorage.getItem("oleafly.workspace.zen")).toBe(saved);

    useSettingsStore.setState({ showTree: true, assistantOpen: true, viewMode: "split" });
    useZenStore.getState().end();
    expect(localStorage.getItem("oleafly.workspace.zen")).toBe(saved);
    expect(readWorkspaceLayout("zen")).toMatchObject({ showTree: true, assistantOpen: true, viewMode: "split" });
    off();
  });

  it("saves layout changes again once Zen mode has ended", () => {
    const off = restoreWorkspaceLayout("zen-after");
    useZenStore.getState().begin({
      projectId: "zen-after",
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
    useZenStore.getState().end();
    useSettingsStore.setState({ viewMode: "split" });
    expect(readWorkspaceLayout("zen-after").viewMode).toBe("split");
    off();
  });
});
