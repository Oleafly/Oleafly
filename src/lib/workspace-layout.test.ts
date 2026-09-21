// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { readWorkspaceLayout, restoreWorkspaceLayout } from "./workspace-layout";

beforeEach(() => {
  localStorage.clear();
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
