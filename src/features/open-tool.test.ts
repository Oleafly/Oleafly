// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolById } from "@/lib/tool-catalog";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError } }));

import { openHomePage, openTool, openToolsGallery } from "./open-tool";

beforeEach(() => {
  vi.clearAllMocks();
  useHomeViewStore.setState({
    page: "library",
    activeConverter: null,
    activeReferenceTool: null,
    queuedPageAfterProjectClose: null,
  });
  useFilesStore.setState({
    projectId: null,
    closeProject: vi.fn().mockResolvedValue(undefined),
    createTypstProject: vi.fn().mockResolvedValue("typst-project"),
  });
  useSettingsStore.setState({ viewMode: "editor" });
});

describe("tool navigation", () => {
  it("opens ordinary home pages directly when no project is active", async () => {
    await openToolsGallery();
    expect(useHomeViewStore.getState().page).toBe("tools");
    expect(useFilesStore.getState().closeProject).not.toHaveBeenCalled();
  });

  it("keeps the active project for overlay tools", async () => {
    useFilesStore.setState({ projectId: "paper" });
    await openHomePage("symbols");
    expect(useHomeViewStore.getState().page).toBe("symbols");
    expect(useFilesStore.getState().closeProject).not.toHaveBeenCalled();
  });

  it("queues a standalone page until the active project closes", async () => {
    const closeProject = vi.fn().mockImplementation(async () => {
      useFilesStore.setState({ projectId: null });
    });
    useFilesStore.setState({ projectId: "paper", closeProject });
    await openHomePage("stats");
    expect(closeProject).toHaveBeenCalledOnce();
    expect(useHomeViewStore.getState().queuedPageAfterProjectClose).toBe("stats");
  });

  it("clears a queued page when project closing is declined", async () => {
    useFilesStore.setState({
      projectId: "paper",
      closeProject: vi.fn().mockResolvedValue(undefined),
    });
    await openHomePage("table");
    expect(useHomeViewStore.getState().queuedPageAfterProjectClose).toBeNull();
  });

  it("selects a converter before closing an active project", async () => {
    useFilesStore.setState({
      projectId: "paper",
      closeProject: vi.fn().mockImplementation(async () => {
        useFilesStore.setState({ projectId: null });
      }),
    });
    await openTool(toolById("markdown-to-latex"));
    expect(useHomeViewStore.getState().activeConverter).toBe("markdown-to-latex");
    expect(useHomeViewStore.getState().queuedPageAfterProjectClose).toBe("converter");
  });

  it("opens page-backed tools through the same navigation guard", async () => {
    await openTool(toolById("table-to-latex"));
    expect(useHomeViewStore.getState().page).toBe("table");
  });

  it("selects a reference workspace before navigating", async () => {
    await openTool(toolById("doi-to-bibtex"));
    expect(useHomeViewStore.getState()).toMatchObject({
      page: "reference",
      activeReferenceTool: "doi-to-bibtex",
    });
  });

  it.each([
    ["visual-typst-editor", "split"],
    ["typst-editor", "editor"],
  ] as const)("creates %s with the requested editor mode", async (id, mode) => {
    const createTypstProject = vi.fn().mockImplementation(async () => {
      // Project initialization restores its saved layout before resolving.
      useSettingsStore.setState({ viewMode: "split" });
      return "typst-project";
    });
    useFilesStore.setState({ createTypstProject });
    await openTool(toolById(id));
    expect(useSettingsStore.getState().viewMode).toBe(mode);
    expect(createTypstProject).toHaveBeenCalledWith("Untitled Typst document");
  });

  it("reports Typst project creation failures without leaving an unhandled rejection", async () => {
    const failure = new Error("disk full");
    useFilesStore.setState({ createTypstProject: vi.fn().mockRejectedValue(failure) });
    await openTool(toolById("typst-editor"));
    expect(mocks.logError).toHaveBeenCalledWith("open typst editor", failure);
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Oleafly couldn't start the Typst document.",
    );
  });
});
