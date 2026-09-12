// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const recycleProject = vi.fn(async () => {});
const duplicateProject = vi.fn(async () => "fork-1");
const readCompiledPdf = vi.fn(async () => new Uint8Array([1, 2]));
const setProjectColorCommand = vi.fn(async () => {});
const pdfPageToPng = vi.fn(async () => "data:image/png;base64,preview");
const toastSuccess = vi.fn();
const notifyError = vi.fn();

vi.mock("@/components/library/HomeDock", () => ({
  HomeDock: () => null,
  HOME_DOCK_GLASS_SURFACE: "",
}));
vi.mock("@/components/layout/WindowControls", () => ({
  WindowControls: () => null,
}));
vi.mock("@/components/layout/LeafLogo", () => ({ LeafLogo: () => null }));
vi.mock("@/components/pdf/PdfViewer", () => ({
  PdfViewer: ({ data }: { data: Uint8Array | null }) => (
    <div data-testid="library-pdf-viewer">{data?.byteLength ?? 0}</div>
  ),
}));
vi.mock("@/components/library/ProjectImportMenu", () => ({
  ProjectImportMenu: ({ trigger }: { trigger: (busy: boolean) => ReactNode }) =>
    trigger(false),
}));
vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn(async () => {}),
  recycleProject: (...args: unknown[]) => recycleProject(...(args as [])),
  duplicateProject: (...args: unknown[]) => duplicateProject(...(args as [])),
  readCompiledPdf: (...args: unknown[]) => readCompiledPdf(...(args as [])),
  setProjectColor: (...args: unknown[]) =>
    setProjectColorCommand(...(args as [])),
}));
vi.mock("@/lib/pdf-image", () => ({
  pdfPageToPng: (...args: unknown[]) => pdfPageToPng(...(args as [])),
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
    update: vi.fn(),
    dismiss: vi.fn(),
  },
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { Library } from "@/components/library/Library";
import { useFavoritesStore } from "@/store/favorites";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

const openProject = vi.fn(async () => {});
const refreshProjects = vi.fn(async () => {});

const PAPER = {
  id: "paper",
  name: "Research paper",
  main_doc: "main.tex",
  engine: "tectonic",
  kind: "document",
  color: "#287fd1",
  created_at: 1,
  updated_at: 1,
  has_preview: true,
  exports: [
    {
      filename: "paper.pdf",
      format: "pdf",
      path: "/tmp/paper.pdf",
      date: 1_700_000_000,
    },
  ],
  forked_from: "origin-paper",
  recovery_pending: false,
};

const NOTE = {
  ...PAPER,
  id: "note",
  name: "Typst note",
  main_doc: "main.typ",
  engine: "typst",
  kind: "diagram",
  has_preview: false,
  exports: [],
  forked_from: null,
};

function seedProjects(projects: unknown[] = [PAPER, NOTE]) {
  useFilesStore.setState({
    projectsLoaded: true,
    projects: projects as never,
    refreshProjects,
    openProject,
  });
}

async function openListActions(name: string) {
  fireEvent.click(
    screen.getByRole("button", { name: enLibrary.home.listView }),
  );
  fireEvent.pointerDown(
    screen.getByRole("button", {
      name: enLibrary.projects.actions.replace("{{name}}", name),
    }),
    { button: 0, ctrlKey: false, pointerType: "mouse" },
  );
}

beforeEach(() => {
  localStorage.clear();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  recycleProject.mockReset();
  recycleProject.mockResolvedValue(undefined);
  duplicateProject.mockReset();
  duplicateProject.mockResolvedValue("fork-1");
  readCompiledPdf.mockReset();
  readCompiledPdf.mockResolvedValue(new Uint8Array([1, 2]));
  setProjectColorCommand.mockReset();
  pdfPageToPng.mockReset();
  pdfPageToPng.mockResolvedValue("data:image/png;base64,preview");
  toastSuccess.mockReset();
  notifyError.mockReset();
  openProject.mockReset();
  refreshProjects.mockReset();
  useHomeViewStore.setState({ page: "library" });
  useFavoritesStore.setState({ favs: ["paper"] });
  useSettingsStore.setState({
    bgPattern: "none",
    hoverPreview: false,
    homeProjectLayout: "grid",
    newProjectOpen: false,
  });
  seedProjects();
});

describe("Library states", () => {
  it("renders nothing when another page is active", () => {
    useHomeViewStore.setState({ page: "deadlines" });
    const { container } = render(<Library />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the loading state before the project list arrives", () => {
    useFilesStore.setState({ projects: [], projectsLoaded: false });
    render(<Library />);
    expect(screen.getByText(enLibrary.home.loading)).toBeInTheDocument();
  });

  it("invites a first project when the library is empty", () => {
    useFilesStore.setState({ projects: [], projectsLoaded: true });
    render(<Library />);
    expect(
      screen.getByText(enLibrary.home.welcomeTitle),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-first-project"));
    expect(useSettingsStore.getState().newProjectOpen).toBe(true);
  });

  it("explains an empty bookmark filter", async () => {
    useFavoritesStore.setState({ favs: [] });
    render(<Library />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.home.advancedFilters }),
    );
    fireEvent.pointerDown(
      screen.getByLabelText(enLibrary.home.filters.bookmark),
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    fireEvent.click(
      await screen.findByRole("option", {
        name: enLibrary.home.filters.bookmarkYes,
      }),
    );
    expect(
      screen.getByText(enLibrary.home.noBookmarksTitle),
    ).toBeInTheDocument();
  });
});

describe("Library advanced filters", () => {
  async function chooseFilter(label: string, option: string) {
    fireEvent.pointerDown(screen.getByLabelText(label), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: option }));
  }

  it("filters by engine and resets", async () => {
    render(<Library />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.home.advancedFilters }),
    );
    await chooseFilter(enLibrary.home.filters.engine, "Typst");
    expect(screen.getByTestId("project-grid")).toHaveTextContent(NOTE.name);
    expect(screen.getByTestId("project-grid")).not.toHaveTextContent(
      PAPER.name,
    );

    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.home.resetFilters }),
    );
    expect(screen.getByTestId("project-grid")).toHaveTextContent(PAPER.name);
  });

  it("filters by project kind", async () => {
    render(<Library />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.home.advancedFilters }),
    );
    await chooseFilter(
      enLibrary.home.filters.kind,
      enLibrary.home.filters.kindDiagram,
    );
    expect(screen.getByTestId("project-grid")).toHaveTextContent(NOTE.name);
    expect(screen.getByTestId("project-grid")).not.toHaveTextContent(
      PAPER.name,
    );
  });

  it("filters by preview availability", async () => {
    render(<Library />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.home.advancedFilters }),
    );
    await chooseFilter(
      enLibrary.home.filters.preview,
      enLibrary.home.filters.previewNo,
    );
    expect(screen.getByTestId("project-grid")).toHaveTextContent(NOTE.name);
    expect(screen.getByTestId("project-grid")).not.toHaveTextContent(
      PAPER.name,
    );
  });

  it("filters by creation window", async () => {
    seedProjects([
      PAPER,
      { ...NOTE, created_at: Math.floor(Date.now() / 1000) },
    ]);
    render(<Library />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.home.advancedFilters }),
    );
    await chooseFilter(
      enLibrary.home.filters.created,
      enLibrary.home.filters.last7Days,
    );
    expect(screen.getByTestId("project-grid")).toHaveTextContent(NOTE.name);
    expect(screen.getByTestId("project-grid")).not.toHaveTextContent(
      PAPER.name,
    );
  });

  it("filters by modification window", async () => {
    seedProjects([
      PAPER,
      { ...NOTE, updated_at: Math.floor(Date.now() / 1000) },
    ]);
    render(<Library />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.home.advancedFilters }),
    );
    await chooseFilter(
      enLibrary.home.filters.modified,
      enLibrary.home.filters.last30Days,
    );
    expect(screen.getByTestId("project-grid")).toHaveTextContent(NOTE.name);
  });
});

describe("Library project dialogs", () => {
  it("shows read-only project details", async () => {
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: enLibrary.projects.details,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(enLibrary.projects.detailsDialog.title);
    expect(dialog).toHaveTextContent(PAPER.id);
    expect(dialog).toHaveTextContent(PAPER.main_doc);
    expect(dialog).toHaveTextContent(
      enLibrary.projects.detailsDialog.forkedFrom,
    );
    expect(dialog).toHaveTextContent(enCommon.actions.yes);
    expect(dialog).toHaveTextContent(
      enLibrary.projects.detailsDialog.previewAvailable,
    );
  });

  it("lists the export history", async () => {
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: enLibrary.projects.exportHistory,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(enLibrary.projects.exportsDialog.title);
    expect(dialog).toHaveTextContent("paper.pdf");
    expect(dialog).toHaveTextContent("/tmp/paper.pdf");
  });

  it("reports a project with no exports", async () => {
    render(<Library />);
    await openListActions(NOTE.name);
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: enLibrary.projects.exportHistory,
      }),
    );
    expect(
      await screen.findByText(enLibrary.projects.exportsDialog.empty),
    ).toBeInTheDocument();
  });

  it("forks a project with the typed name", async () => {
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: enLibrary.projects.fork }),
    );
    const input = await screen.findByPlaceholderText(
      enLibrary.projects.forkDialog.namePlaceholder,
    );
    fireEvent.change(input, { target: { value: "Second draft" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: enLibrary.projects.forkDialog.confirm,
      }),
    );
    await waitFor(() =>
      expect(duplicateProject).toHaveBeenCalledWith("paper", "Second draft"),
    );
    expect(setProjectColorCommand).toHaveBeenCalled();
    expect(refreshProjects).toHaveBeenCalled();
  });

  it("forks from the Enter key using the default name", async () => {
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: enLibrary.projects.fork }),
    );
    const input = await screen.findByPlaceholderText(
      enLibrary.projects.forkDialog.namePlaceholder,
    );
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(duplicateProject).toHaveBeenCalledWith(
        "paper",
        enLibrary.projects.forkDialog.copySuffix.replace(
          "{{name}}",
          PAPER.name,
        ),
      ),
    );
  });

  it("reports a failed fork", async () => {
    duplicateProject.mockRejectedValue(new Error("no space"));
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: enLibrary.projects.fork }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: enLibrary.projects.forkDialog.confirm,
      }),
    );
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
  });

  it("closes the fork dialog", async () => {
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: enLibrary.projects.fork }),
    );
    await screen.findByPlaceholderText(
      enLibrary.projects.forkDialog.namePlaceholder,
    );
    fireEvent.mouseDown(
      screen.getByRole("button", {
        name: enLibrary.projects.forkDialog.close,
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText(
          enLibrary.projects.forkDialog.namePlaceholder,
        ),
      ).not.toBeInTheDocument(),
    );
  });

  it("moves a project to the recycle bin", async () => {
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: enLibrary.projects.delete }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: enLibrary.projects.deleteDialog.confirm,
      }),
    );
    await waitFor(() => expect(recycleProject).toHaveBeenCalledWith("paper"));
    expect(toastSuccess).toHaveBeenCalledWith(
      enLibrary.projects.deleteDialog.moved.replace("{{name}}", PAPER.name),
    );
  });

  it("reports a failed deletion", async () => {
    recycleProject.mockRejectedValue(new Error("locked"));
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: enLibrary.projects.delete }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: enLibrary.projects.deleteDialog.confirm,
      }),
    );
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
  });

  it("reports a preview that cannot be loaded", async () => {
    readCompiledPdf.mockRejectedValue(new Error("no pdf"));
    render(<Library />);
    fireEvent.click(
      screen.getByRole("button", { name: enLibrary.home.listView }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: enLibrary.projects.previewNamed.replace("{{name}}", PAPER.name),
      }),
    );
    expect(
      await screen.findByText(enLibrary.projects.preview.failed),
    ).toBeInTheDocument();
  });

  it("opens a project from the action menu", async () => {
    render(<Library />);
    await openListActions(PAPER.name);
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: enLibrary.projects.openProject,
      }),
    );
    expect(openProject).toHaveBeenCalledWith("paper");
  });
});

describe("Library hover previews", () => {
  it("rasterizes a thumbnail on hover and reuses the cache", async () => {
    useSettingsStore.setState({ hoverPreview: true });
    render(<Library />);
    fireEvent.mouseEnter(
      screen.getByRole("button", {
        name: enLibrary.projects.open.replace("{{name}}", PAPER.name),
      }),
    );
    await waitFor(() => expect(pdfPageToPng).toHaveBeenCalledTimes(1));

    fireEvent.mouseLeave(
      screen.getByRole("button", {
        name: enLibrary.projects.open.replace("{{name}}", PAPER.name),
      }),
    );
    fireEvent.mouseEnter(
      screen.getByRole("button", {
        name: enLibrary.projects.open.replace("{{name}}", PAPER.name),
      }),
    );
    await waitFor(() => expect(pdfPageToPng).toHaveBeenCalledTimes(1));
  });

  it("survives a thumbnail failure", async () => {
    useSettingsStore.setState({ hoverPreview: true });
    readCompiledPdf.mockRejectedValue(new Error("no pdf"));
    render(<Library />);
    fireEvent.mouseEnter(
      screen.getByRole("button", {
        name: enLibrary.projects.open.replace("{{name}}", NOTE.name),
      }),
    );
    await waitFor(() => expect(readCompiledPdf).toHaveBeenCalled());
    expect(screen.getByTestId("project-grid")).toBeInTheDocument();
  });
});
