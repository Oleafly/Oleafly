// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pickSavePath: vi.fn(async () => "/tmp/out.zip"),
  downloadProjectZip: vi.fn(async () => {}),
  duplicateProject: vi.fn(async () => "p2"),
  exportDocument: vi.fn(async () => {}),
  revealInDir: vi.fn(async () => {}),
  ensurePandoc: vi.fn(async () => true),
  exportCurrentDocument: vi.fn(async () => {}),
  exportCurrentPdf: vi.fn(async () => {}),
  exportCurrentImagePng: vi.fn(async () => {}),
  success: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }),
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  downloadProjectZip: mocks.downloadProjectZip,
  duplicateProject: mocks.duplicateProject,
  exportDocument: mocks.exportDocument,
  revealInDir: mocks.revealInDir,
}));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));
vi.mock("@/features/export", () => ({
  exportCurrentDocument: mocks.exportCurrentDocument,
  exportCurrentPdf: mocks.exportCurrentPdf,
  exportCurrentImagePng: mocks.exportCurrentImagePng,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: vi.fn(), info: vi.fn() },
  notifyError: mocks.notifyError,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { TopToolbar } from "./TopToolbar";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { ThemeProvider } from "@/lib/theme";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { i18n } from "@/i18n";

const toolbar = enShell.toolbar;

function renderToolbar() {
  return render(
    <ThemeProvider>
      <TopToolbar />
    </ThemeProvider>,
  );
}

function forkButton(): HTMLElement {
  return screen.getByRole("menuitem", { name: toolbar.forkProject });
}

const renameProject = vi.fn(async (_name: string) => {});
const refreshProjects = vi.fn(async () => {});
const openProject = vi.fn(async () => {});
const closeProject = vi.fn(async () => {});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.pickSavePath.mockResolvedValue("/tmp/out.zip");
  mocks.ensurePandoc.mockResolvedValue(true);
  mocks.duplicateProject.mockResolvedValue("p2");
  renameProject.mockReset().mockResolvedValue(undefined);
  refreshProjects.mockReset().mockResolvedValue(undefined);
  openProject.mockClear();
  usePreviewDetachedStore.setState({ projectId: null });
  useFilesStore.setState({
    projectId: "p1",
    projectName: "Retrieval study",
    projectKind: "",
    projects: [],
    engine: LATEX_ENGINE,
    engineError: null,
    files: { "main.tex": { content: "\\documentclass{article}" } },
    mainDoc: "main.tex",
    activePath: "main.tex",
    renameProject,
    refreshProjects,
    openProject,
    closeProject,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({ status: "success", pdfBytes: new Uint8Array([1]) });
  useSettingsStore.setState({
    viewMode: "split",
    assistantOpen: false,
    workspaceHidden: false,
  });
});

describe("TopToolbar title", () => {
  it("renames the project from the title field and lets the title show it", async () => {
    renameProject.mockImplementation(async (name: string) => {
      useFilesStore.setState({ projectName: name });
    });
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("project-title"));
    const field = await screen.findByLabelText(toolbar.projectName);
    await user.clear(field);
    await user.type(field, "New name{Enter}");
    await waitFor(() => expect(renameProject).toHaveBeenCalledWith("New name"));
    await waitFor(() =>
      expect(screen.getByTestId("project-title")).toHaveTextContent("New name"),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("saves the name from its own button", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("project-title"));
    const field = await screen.findByLabelText(toolbar.projectName);
    await user.clear(field);
    await user.type(field, "Second name");
    await user.click(screen.getByLabelText(toolbar.saveNameAriaLabel));
    await waitFor(() => expect(renameProject).toHaveBeenCalledWith("Second name"));
  });

  it("abandons the rename on escape and on cancel", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("project-title"));
    await user.type(await screen.findByLabelText(toolbar.projectName), "{Escape}");
    await waitFor(() =>
      expect(screen.queryByLabelText(toolbar.projectName)).not.toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("project-title"));
    await user.click(
      await screen.findByLabelText(enCommon.actions.cancel),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText(toolbar.projectName)).not.toBeInTheDocument(),
    );
    expect(renameProject).not.toHaveBeenCalled();
  });

  it("keeps the old name when the rename fails", async () => {
    const failure = new Error("project rename task failed: taken");
    renameProject.mockRejectedValueOnce(failure);
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("project-title"));
    const field = await screen.findByLabelText(toolbar.projectName);
    await user.clear(field);
    await user.type(field, "Clash{Enter}");
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "rename project",
        failure,
        i18n.t(($) => $.shell.toolbar.renameFailed),
      ),
    );
    expect(screen.getByTestId("project-title")).toHaveTextContent("Retrieval study");
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("logs a list refresh that failed after the rename went through", async () => {
    const failure = new Error("list unavailable");
    renameProject.mockImplementationOnce(async (name: string) => {
      useFilesStore.setState({ projectName: name });
      throw failure;
    });
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("project-title"));
    const field = await screen.findByLabelText(toolbar.projectName);
    await user.clear(field);
    await user.type(field, "Renamed{Enter}");
    await waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith("refresh projects after rename", failure),
    );
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-title")).toHaveTextContent("Renamed");
  });

  it("falls back to an untitled label", () => {
    useFilesStore.setState({ projectName: "" });
    renderToolbar();
    expect(screen.getByTestId("project-title")).toHaveTextContent(
      toolbar.untitledProject,
    );
  });
});

describe("TopToolbar view and layout", () => {
  it("keeps compile and its options visible while the preview is detached", () => {
    usePreviewDetachedStore.setState({ projectId: "p1" });
    renderToolbar();
    expect(screen.getByTestId("compile-button")).toBeVisible();
    expect(screen.getByTestId("compile-options-button")).toBeVisible();
  });

  it("switches the view mode", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.views.pdf));
    expect(useSettingsStore.getState().viewMode).toBe("pdf");
    await user.click(screen.getByLabelText(toolbar.views.editor));
    expect(useSettingsStore.getState().viewMode).toBe("editor");
  });

  it("lists every layout preset and applies the one chosen", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: toolbar.layout }));
    const menu = (await screen.findAllByRole("menu")).at(-1);
    if (!menu) throw new Error("layout submenu did not open");
    for (const label of Object.values(toolbar.layouts)) {
      expect(menu).toHaveTextContent(label);
    }
    const item = screen.getByRole("menuitem", { name: toolbar.layouts.aiOnly });
    item.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(useSettingsStore.getState().assistantOpen).toBe(true),
    );
  });
});

describe("TopToolbar export menu", () => {
  it("exports the project sources as a zip", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    await user.click(
      await screen.findByRole("menuitem", { name: toolbar.exportSourceZip }),
    );
    await waitFor(() =>
      expect(mocks.exportCurrentDocument).toHaveBeenCalledWith("zip"),
    );
  });

  it("leaves the save dialog to the export feature", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    await user.click(
      await screen.findByRole("menuitem", { name: toolbar.exportSourceZip }),
    );
    await waitFor(() => expect(mocks.exportCurrentDocument).toHaveBeenCalled());
    expect(mocks.pickSavePath).not.toHaveBeenCalled();
    expect(mocks.downloadProjectZip).not.toHaveBeenCalled();
  });

  it("reopens the export menu after an export finishes", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    await user.click(
      await screen.findByRole("menuitem", { name: toolbar.exportSourceZip }),
    );
    await waitFor(() => expect(mocks.exportCurrentDocument).toHaveBeenCalledTimes(1));
    await user.click(screen.getByLabelText(toolbar.export));
    await user.click(
      await screen.findByRole("menuitem", { name: toolbar.exportSourceZip }),
    );
    await waitFor(() => expect(mocks.exportCurrentDocument).toHaveBeenCalledTimes(2));
  });

  it("exports the compiled PDF", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    await user.click(await screen.findByRole("menuitem", { name: toolbar.exportPdf }));
    await waitFor(() => expect(mocks.exportCurrentPdf).toHaveBeenCalled());
  });

  it("converts the document through the registry route", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    await user.click(
      await screen.findByRole("menuitem", { name: "Export as Word (.docx)" }),
    );
    await waitFor(() =>
      expect(mocks.exportCurrentDocument).toHaveBeenCalledWith("docx"),
    );
  });

  it("offers every registry export route the engine supports", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    await screen.findByRole("menuitem", { name: "Export as Word (.docx)" });
    const names = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim());
    expect(names).toEqual(
      expect.arrayContaining([
        "Export as Word (.docx)",
        "Export as HTML (MathML)",
        "Export as Markdown (.md)",
        "Export as Typst (.typ)",
      ]),
    );
  });

  it("asks for a compile before an export when there is no PDF", async () => {
    useCompileStore.setState({ pdfBytes: null });
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    expect(await screen.findByText(toolbar.compilePdfFirst)).toBeInTheDocument();
  });

  it("offers the slide export for a beamer document", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "\\documentclass{beamer}" } },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    expect(
      await screen.findByRole("menuitem", { name: toolbar.exportPptx }),
    ).toBeInTheDocument();
  });

  it("offers the book export for a report class", async () => {
    useFilesStore.setState({
      files: { "main.tex": { content: "\\documentclass{report}" } },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    expect(
      await screen.findByRole("menuitem", { name: toolbar.exportEpub }),
    ).toBeInTheDocument();
  });

  it("offers raster and vector exports for a figure project", async () => {
    useFilesStore.setState({ projectKind: "image" });
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(toolbar.export));
    expect(
      await screen.findByRole("menuitem", { name: toolbar.exportPdfVector }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("menuitem", { name: toolbar.exportPngRaster }),
    );
    await waitFor(() => expect(mocks.exportCurrentImagePng).toHaveBeenCalled());
  });
});

describe("TopToolbar fork dialog", () => {
  it("forks the project under a new name", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("workspace-menu"));
    await user.click(forkButton());
    const field = await screen.findByPlaceholderText(toolbar.newProjectName);
    expect(field).toHaveValue("Retrieval study (copy)");
    await user.clear(field);
    await user.type(field, "Fork one{Enter}");
    await waitFor(() =>
      expect(mocks.duplicateProject).toHaveBeenCalledWith("p1", "Fork one"),
    );
    expect(refreshProjects).toHaveBeenCalled();
    expect(openProject).toHaveBeenCalledWith("p2");
  });

  it("opens the fork even when the library list fails to refresh", async () => {
    const failure = new Error("list unavailable");
    refreshProjects.mockRejectedValueOnce(failure);
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("workspace-menu"));
    await user.click(forkButton());
    await user.click(await screen.findByRole("button", { name: toolbar.fork }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("p2"));
    expect(mocks.duplicateProject).toHaveBeenCalledOnce();
    expect(mocks.logError).toHaveBeenCalledWith("refresh projects after fork", failure);
    expect(mocks.notifyError).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(toolbar.newProjectName)).not.toBeInTheDocument(),
    );
  });

  it("reports a failed fork", async () => {
    mocks.duplicateProject.mockRejectedValueOnce(new Error("no space"));
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("workspace-menu"));
    await user.click(forkButton());
    await user.click(await screen.findByRole("button", { name: toolbar.fork }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "fork project",
        expect.anything(),
        toolbar.forkFailed,
      ),
    );
  });

  it("explains why the backend refused a fork", async () => {
    const refusal = `@oleafly/error:${JSON.stringify({ code: "project.linked_not_duplicable", params: {}, detail: null })}`;
    mocks.duplicateProject.mockRejectedValueOnce(refusal as never);
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("workspace-menu"));
    await user.click(forkButton());
    await user.click(await screen.findByRole("button", { name: toolbar.fork }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith("fork project", refusal, undefined),
    );
    expect(openProject).not.toHaveBeenCalled();
  });

  it("closes the fork dialog from the backdrop", async () => {
    renderToolbar();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("workspace-menu"));
    await user.click(forkButton());
    await user.click(await screen.findByLabelText(toolbar.closeForkDialog));
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText(toolbar.newProjectName),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("TopToolbar engine error", () => {
  it("shows the engine error next to the compile controls", () => {
    useFilesStore.setState({
      engineError: { code: "@oleafly/error:tex.no_host_binary" },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
    renderToolbar();
    const banner = document.querySelector(".text-destructive");
    expect(banner?.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});
