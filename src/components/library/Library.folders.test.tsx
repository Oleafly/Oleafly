// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProjectAvailability, ProjectAvailabilityReport, ProjectInfo } from "@/lib/tauri";

const probeProjectAvailability = vi.fn<(ids: string[]) => Promise<ProjectAvailabilityReport[]>>();
const revealProject = vi.fn<(projectId: string, path?: string | null) => Promise<void>>();
const removeLinkedProject = vi.fn<(projectId: string) => Promise<void>>();
const recycleProject = vi.fn(async () => {});
const readCompiledPdf = vi.fn(async () => new Uint8Array([1]));
const copyIntoLibrary = vi.fn<(projectId: string, name: string) => Promise<string | null>>();
const toastSuccess = vi.fn();
const notifyError = vi.fn();

vi.mock("@/components/library/HomeDock", () => ({
  HomeDock: () => null,
  HOME_DOCK_GLASS_SURFACE: "",
}));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@/components/layout/LeafLogo", () => ({ LeafLogo: () => null }));
vi.mock("@/components/pdf/PdfViewer", () => ({ PdfViewer: () => null }));
vi.mock("@/components/library/ProjectImportMenu", () => ({
  ProjectImportMenu: ({ trigger }: { trigger: (busy: boolean) => ReactNode }) => trigger(false),
}));
vi.mock("@/lib/tauri", () => ({
  appendAppLog: vi.fn(async () => {}),
  probeProjectAvailability: (ids: string[]) => probeProjectAvailability(ids),
  revealProject: (projectId: string, path?: string | null) => revealProject(projectId, path),
  removeLinkedProject: (projectId: string) => removeLinkedProject(projectId),
  recycleProject: (...args: unknown[]) => recycleProject(...(args as [])),
  duplicateProject: vi.fn(),
  readCompiledPdf: (...args: unknown[]) => readCompiledPdf(...(args as [])),
  setProjectColor: vi.fn(async () => {}),
  locateProjectFolder: vi.fn(async () => "cancelled"),
  adoptReplacedFolder: vi.fn(async () => "cancelled"),
}));
vi.mock("@/store/copy-into-library", () => ({
  copyIntoLibrary: (projectId: string, name: string) => copyIntoLibrary(projectId, name),
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
import { projectModifiedLabel } from "@/lib/project-format";
import { useFavoritesStore } from "@/store/favorites";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useLibraryAvailabilityStore } from "@/store/library-availability";
import { useSettingsStore } from "@/store/settings";

const openProject = vi.fn(async () => {});
const refreshProjects = vi.fn(async () => {});

function library(id: string, extra: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    main_doc: "main.tex",
    engine: "tectonic",
    kind: "document",
    created_at: 1,
    updated_at: 1,
    color: "#287fd1",
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    location: { kind: "library" },
    ...extra,
  };
}

function folder(
  id: string,
  name: string,
  extra: Partial<ProjectInfo> = {},
  availability: ProjectAvailability = "unknown",
): ProjectInfo {
  return library(id, {
    name,
    location: { kind: "linked", display_path: `~/Desktop/${name.toLowerCase()}`, availability },
    ...extra,
  });
}

const TODAY = Math.floor(Date.now() / 1000);
const EXTERNAL = enLibrary.projects.kind.external;
const THESIS = folder("linked-thesis", "Thesis", {
  main_doc: "paper/main.tex",
  last_opened_at: 300,
  updated_at: TODAY,
});
const SLIDES = folder("linked-slides", "Slides", { main_doc: "", last_opened_at: 100, updated_at: TODAY });
const PAPER = library("paper", { name: "Paper", last_opened_at: 200 });

function seed(projects: ProjectInfo[]) {
  useFilesStore.setState({ projectsLoaded: true, projects, refreshProjects, openProject });
}

function reportAll(entries: Record<string, ProjectAvailability>) {
  probeProjectAvailability.mockResolvedValue(
    Object.entries(entries).map(([project_id, availability]) => ({ project_id, availability })),
  );
}

async function renderLibrary() {
  const view = render(<Library />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return view;
}

function card(name: string) {
  return screen.getByRole("button", { name }).parentElement as HTMLElement;
}

function columns(name: string) {
  return Array.from(card(name).children)
    .slice(1, 4)
    .map((cell) => cell.textContent);
}

function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: enLibrary.home.advancedFilters }));
}

function locationSelect() {
  return screen.queryByLabelText(enLibrary.home.filters.location);
}

async function chooseLocation(label: string) {
  fireEvent.pointerDown(locationSelect() as HTMLElement, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

function resetFilters() {
  return screen.getByRole("button", { name: enLibrary.home.resetFilters });
}

function openActions(name: string) {
  fireEvent.pointerDown(
    screen.getAllByRole("button", {
      name: enLibrary.projects.actions.replace("{{name}}", name),
    })[0],
    { button: 0, ctrlKey: false, pointerType: "mouse" },
  );
}

beforeEach(() => {
  localStorage.clear();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  for (const mock of [
    probeProjectAvailability,
    revealProject,
    removeLinkedProject,
    recycleProject,
    copyIntoLibrary,
    toastSuccess,
    notifyError,
    openProject,
    refreshProjects,
  ]) {
    mock.mockReset();
  }
  probeProjectAvailability.mockResolvedValue([]);
  revealProject.mockResolvedValue(undefined);
  removeLinkedProject.mockResolvedValue(undefined);
  copyIntoLibrary.mockResolvedValue("copy-1");
  useLibraryAvailabilityStore.getState().reset();
  useHomeViewStore.setState({ page: "library" });
  useFavoritesStore.setState({ favs: [] });
  useSettingsStore.setState({
    bgPattern: "none",
    hoverPreview: false,
    homeProjectLayout: "grid",
    newProjectOpen: false,
  });
  seed([THESIS, PAPER, SLIDES]);
});

describe("folder cards", () => {
  it("read like library cards, with External as their kind and when they were updated", async () => {
    await renderLibrary();
    for (const name of ["Open Thesis", "Open Slides"]) {
      const folderCard = card(name);
      expect(within(folderCard).getByText("LaTeX")).toBeInTheDocument();
      expect(within(folderCard).getByText(EXTERNAL)).toBeInTheDocument();
      expect(within(folderCard).getByText(projectModifiedLabel(TODAY) as string)).toBeInTheDocument();
      expect(within(folderCard).queryByText("No main document")).toBeNull();
      expect(folderCard.textContent).not.toContain("Desktop");
      for (const state of Object.values(enLibrary.folder.state)) {
        expect(within(folderCard).queryByText(state)).toBeNull();
      }
      expect(folderCard.querySelector(".grayscale")).toBeNull();
    }
    expect(within(card("Open Thesis")).queryByText("paper/main.tex")).toBeNull();
    const paper = card("Open Paper");
    expect(within(paper).getByText(enLibrary.projects.kind.document)).toBeInTheDocument();
    expect(within(paper).queryByText(EXTERNAL)).toBeNull();
  });

  it("show a change the folder check found after the first paint", async () => {
    const lastMonth = TODAY - 40 * 86_400;
    seed([folder("linked-thesis", "Thesis", { updated_at: lastMonth }), PAPER]);
    probeProjectAvailability.mockResolvedValue([
      { project_id: "linked-thesis", availability: "ok", modified_at_ms: TODAY * 1000 },
    ]);
    render(<Library />);
    expect(
      within(card("Open Thesis")).getByText(projectModifiedLabel(lastMonth) as string),
    ).toBeInTheDocument();
    expect(
      await within(card("Open Thesis")).findByText(projectModifiedLabel(TODAY) as string),
    ).toBeInTheDocument();
  });

  it.each(["grid", "list"] as const)(
    "move a folder up in the %s once the folder check finds a newer change",
    async (layout) => {
      useSettingsStore.setState({ homeProjectLayout: layout });
      seed([
        library("paper", { name: "Paper", updated_at: TODAY - 7 * 86_400 }),
        folder("linked-thesis", "Thesis", { updated_at: TODAY - 40 * 86_400 }),
      ]);
      probeProjectAvailability.mockResolvedValue([
        { project_id: "linked-thesis", availability: "ok", modified_at_ms: TODAY * 1000 },
      ]);
      const first = () => screen.getAllByRole("button", { name: /^Open (Paper|Thesis)$/ })[0];
      render(<Library />);
      expect(first()).toBe(screen.getByRole("button", { name: "Open Paper" }));
      await waitFor(() =>
        expect(first()).toBe(screen.getByRole("button", { name: "Open Thesis" })),
      );
    },
  );

  it("check folders only after the first paint and only for folders", async () => {
    render(<Library />);
    expect(probeProjectAvailability).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(probeProjectAvailability).toHaveBeenCalledWith(["linked-thesis", "linked-slides"]),
    );
  });

  it.each([
    ["missing", enLibrary.folder.state.missing, enLibrary.folder.unavailable.missing.title],
    ["offline", enLibrary.folder.state.offline, enLibrary.folder.unavailable.offline.title],
    ["replaced", enLibrary.folder.state.replaced, enLibrary.folder.unavailable.replaced.title],
    [
      "permission_denied",
      enLibrary.folder.state.permissionDenied,
      enLibrary.folder.unavailable.permissionDenied.title,
    ],
  ] as const)("show the %s state and explain it instead of opening", async (state, label, title) => {
    reportAll({ "linked-thesis": state, "linked-slides": "ok" });
    await renderLibrary();
    const thesis = card("Open Thesis");
    const stateLine = (await within(thesis).findByText(label)).parentElement as HTMLElement;
    expect(stateLine).toHaveClass("text-amber-700");
    expect(stateLine.querySelector("svg")).toBeNull();
    expect(within(thesis).getByText(EXTERNAL)).toBeInTheDocument();
    expect(within(thesis).queryByText(projectModifiedLabel(TODAY) as string)).toBeNull();
    expect(thesis.querySelector(".grayscale")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Thesis" }));

    expect(
      await screen.findByRole("heading", { name: title.replace("{{name}}", "Thesis") }),
    ).toBeInTheDocument();
    expect(openProject).not.toHaveBeenCalled();
  });

  it("open reachable folders and folders still being checked", async () => {
    reportAll({ "linked-thesis": "ok" });
    await renderLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Open Thesis" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Slides" }));
    expect(openProject).toHaveBeenNthCalledWith(1, "linked-thesis");
    expect(openProject).toHaveBeenNthCalledWith(2, "linked-slides");
  });

  it("list like library rows, with their state where the date would be", async () => {
    useSettingsStore.setState({ homeProjectLayout: "list" });
    reportAll({ "linked-slides": "offline" });
    await renderLibrary();
    const list = screen.getByTestId("project-list");
    expect(await within(card("Open Slides")).findAllByText(enLibrary.folder.state.offline)).not.toHaveLength(0);
    expect(list.textContent).not.toContain("Desktop");
    expect(columns("Open Thesis")).toEqual([EXTERNAL, "LaTeX", projectModifiedLabel(TODAY)]);
    expect(columns("Open Slides")).toEqual([EXTERNAL, "LaTeX", enLibrary.folder.state.offline]);
    const slides = screen.getByRole("button", { name: "Open Slides" });
    expect(within(slides).getByText(enLibrary.folder.state.offline).closest("span.sm\\:hidden")).not.toBeNull();
    expect(within(slides).getByText(`LaTeX · ${EXTERNAL}`)).toHaveClass("hidden", "sm:block", "lg:hidden");
    expect(within(screen.getByRole("button", { name: "Open Thesis" })).getByText(`LaTeX · ${EXTERNAL}`)).toHaveClass("lg:hidden");
  });

  it("label the date column Modified whether or not folders are listed", async () => {
    useSettingsStore.setState({ homeProjectLayout: "list" });
    await renderLibrary();
    expect(within(screen.getByTestId("project-list")).getByText(enLibrary.home.columns.modified)).toBeInTheDocument();

    act(() => seed([PAPER]));
    expect(within(screen.getByTestId("project-list")).getByText(enLibrary.home.columns.modified)).toBeInTheDocument();
  });
});

describe("project cards and rows", () => {
  const today = Math.floor(Date.now() / 1000);
  const RECOVERY = library("recovery", {
    name: "Rescue",
    main_doc: "",
    engine: "",
    kind: "",
    updated_at: 0,
    recovery_pending: true,
  });
  const NOTES = library("notes", {
    name: "Notes",
    main_doc: "notes.md",
    engine: "markdown",
    kind: "image",
    updated_at: today,
  });
  const UNOPENED = folder("linked-unopened", "Unopened", { updated_at: today });

  it("label recovery and library cards in the grid", async () => {
    seed([RECOVERY, NOTES, THESIS]);
    await renderLibrary();
    const rescue = card("Open to recover Rescue");
    expect(within(rescue).getByText(enLibrary.projects.recoveryRequired)).toBeInTheDocument();
    expect(within(rescue).getAllByText(enLibrary.projects.openToRecover)).toHaveLength(2);
    expect(
      within(rescue).queryByRole("button", { name: enLibrary.projects.favoriteAdd }),
    ).toBeNull();

    const notes = card("Open Notes");
    expect(within(notes).getByText("Markdown")).toBeInTheDocument();
    expect(within(notes).getByText(enLibrary.projects.kind.image)).toBeInTheDocument();
    expect(within(notes).getByText(projectModifiedLabel(today) as string)).toBeInTheDocument();
    expect(
      within(notes).getByRole("button", { name: enLibrary.projects.favoriteAdd }),
    ).toBeInTheDocument();

    const thesis = card("Open Thesis");
    expect(within(thesis).getByText("LaTeX")).toBeInTheDocument();
    expect(within(thesis).getByText(EXTERNAL)).toBeInTheDocument();
    expect(within(thesis).queryByText("paper/main.tex")).toBeNull();
    expect(within(thesis).queryByText(enLibrary.projects.kind.document)).toBeNull();
  });

  it("fill the list columns and the caption under each name", async () => {
    useSettingsStore.setState({ homeProjectLayout: "list" });
    seed([RECOVERY, NOTES, THESIS, UNOPENED]);
    await renderLibrary();

    const rescue = screen.getByRole("button", { name: "Open to recover Rescue" });
    expect(within(rescue).getByText(enLibrary.projects.openToRecover)).toHaveClass(
      "text-amber-600",
    );
    expect(columns("Open to recover Rescue")).toEqual([
      enLibrary.projects.recoveryShort,
      enLibrary.projects.recoveryMetadata,
      enLibrary.projects.recoveryModified,
    ]);

    const notes = screen.getByRole("button", { name: "Open Notes" });
    expect(within(notes).getByText(`Markdown · ${enLibrary.projects.kind.image}`)).toHaveClass(
      "lg:hidden",
    );
    expect(within(notes).queryByTitle(/Desktop/)).toBeNull();
    expect(columns("Open Notes")).toEqual([
      enLibrary.projects.kind.image,
      "Markdown",
      projectModifiedLabel(today),
    ]);

    const thesis = screen.getByRole("button", { name: "Open Thesis" });
    expect(within(thesis).queryByTitle(/Desktop/)).toBeNull();
    expect(within(thesis).getByText(`LaTeX · ${EXTERNAL}`)).toHaveClass("lg:hidden");
    expect(columns("Open Thesis")).toEqual([EXTERNAL, "LaTeX", projectModifiedLabel(TODAY)]);
    expect(columns("Open Unopened")[2]).toBe(projectModifiedLabel(today));
  });
});

describe("folder menu", () => {
  it("offers folder actions and never Delete or Fork", async () => {
    await renderLibrary();
    openActions("Thesis");
    const menu = await screen.findByRole("menu");
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim());
    expect(items).toEqual(
      expect.arrayContaining([
        enLibrary.projects.openProject,
        enLibrary.folder.menu.copyToLibrary,
        enLibrary.folder.menu.remove,
        enLibrary.projects.changeColor,
      ]),
    );
    expect(
      items.some((item) =>
        [
          enLibrary.folder.menu.showInFinder,
          enLibrary.folder.menu.showInExplorer,
          enLibrary.folder.menu.showInFileManager,
        ].includes(item ?? ""),
      ),
    ).toBe(true);
    expect(items).not.toContain(enLibrary.projects.delete);
    expect(items).not.toContain(enLibrary.projects.fork);
    expect(items).not.toContain(enLibrary.projects.favoriteAdd);
    expect(items).not.toContain(enLibrary.projects.favoriteRemove);
  });

  it("reveals the folder by id only", async () => {
    await renderLibrary();
    openActions("Thesis");
    const menu = await screen.findByRole("menu");
    const reveal = within(menu)
      .getAllByRole("menuitem")
      .find((item) => /^Show in /.test(item.textContent?.trim() ?? ""));
    fireEvent.click(reveal as HTMLElement);
    await waitFor(() => expect(revealProject).toHaveBeenCalledWith("linked-thesis", undefined));
  });

  it("copies the folder into the library", async () => {
    await renderLibrary();
    openActions("Thesis");
    fireEvent.click(await screen.findByRole("menuitem", { name: enLibrary.folder.menu.copyToLibrary }));
    expect(copyIntoLibrary).toHaveBeenCalledWith("linked-thesis", "Thesis");
  });

  it("leaves bookmarking to the bookmark on the card", async () => {
    await renderLibrary();
    fireEvent.click(
      within(card("Open Thesis")).getByRole("button", { name: enLibrary.projects.favoriteAdd }),
    );
    expect(useFavoritesStore.getState().favs).toContain("linked-thesis");
    expect(
      within(card("Open Thesis")).getByRole("button", { name: enLibrary.projects.favoriteRemove }),
    ).toBeInTheDocument();
  });

  it("disables reveal and copy while the folder cannot be reached", async () => {
    reportAll({ "linked-thesis": "missing" });
    await renderLibrary();
    await screen.findByText(enLibrary.folder.state.missing);
    openActions("Thesis");
    const copy = await screen.findByRole("menuitem", { name: enLibrary.folder.menu.copyToLibrary });
    expect(copy).toHaveAttribute("data-disabled");
  });
});

describe("remove from Oleafly", () => {
  it("confirms that the files stay and then removes the folder", async () => {
    await renderLibrary();
    openActions("Thesis");
    fireEvent.click(await screen.findByRole("menuitem", { name: enLibrary.folder.menu.remove }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(enLibrary.folder.remove.title.replace("{{name}}", "Thesis")),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(enLibrary.folder.remove.description)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(enLibrary.folder.remove.confirm) }));

    await waitFor(() => expect(removeLinkedProject).toHaveBeenCalledWith("linked-thesis"));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        enLibrary.folder.remove.done.replace("{{name}}", "Thesis"),
      ),
    );
    expect(refreshProjects).toHaveBeenCalled();
    expect(recycleProject).not.toHaveBeenCalled();
  });

  it("reports a failure once and keeps the folder", async () => {
    removeLinkedProject.mockRejectedValueOnce(new Error("locked"));
    await renderLibrary();
    openActions("Thesis");
    fireEvent.click(await screen.findByRole("menuitem", { name: enLibrary.folder.menu.remove }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: new RegExp(enLibrary.folder.remove.confirm),
      }),
    );
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(notifyError.mock.calls[0][2]).toBe(
      enLibrary.folder.remove.failed.replace("{{name}}", "Thesis"),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps the dialog on the problem it opened with when a later check finds the folder", async () => {
    reportAll({ "linked-thesis": "offline", "linked-slides": "ok" });
    await renderLibrary();
    await screen.findByText(enLibrary.folder.state.offline);
    fireEvent.click(screen.getByRole("button", { name: "Open Thesis" }));
    const dialog = await screen.findByRole("dialog");
    const back = enLibrary.folder.unavailable.back.title.replace("{{name}}", "Thesis");

    act(() =>
      useLibraryAvailabilityStore.setState({
        checked: { "linked-thesis": "ok", "linked-slides": "ok" },
      }),
    );

    expect(
      within(dialog).queryByRole("heading", {
        name: enLibrary.folder.unavailable.missing.title.replace("{{name}}", "Thesis"),
      }),
    ).toBeNull();
    expect(within(dialog).getByRole("heading", { name: back })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: enCommon.actions.open }));
    expect(openProject).toHaveBeenCalledWith("linked-thesis");
  });

  it("can be reached from the unavailable-folder dialog", async () => {
    reportAll({ "linked-thesis": "missing" });
    await renderLibrary();
    await screen.findByText(enLibrary.folder.state.missing);
    fireEvent.click(screen.getByRole("button", { name: "Open Thesis" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: enLibrary.folder.menu.remove }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("location filter", () => {
  it("is only offered while the library holds external projects", async () => {
    seed([PAPER, library("notes", { name: "Notes" })]);
    await renderLibrary();
    openFilters();
    expect(screen.getByRole("heading", { name: enLibrary.home.filtersTitle })).toBeInTheDocument();
    expect(locationSelect()).toBeNull();
    expect(screen.queryByTestId("library-scope")).toBeNull();
    expect(probeProjectAvailability).not.toHaveBeenCalled();
  });

  it("shows only external projects or only library projects until the filters are reset", async () => {
    await renderLibrary();
    expect(screen.queryByTestId("library-scope")).toBeNull();
    openFilters();
    expect(locationSelect()).toHaveTextContent(enLibrary.home.filters.locationAll);
    expect(resetFilters()).toBeDisabled();

    fireEvent.pointerDown(locationSelect() as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      enLibrary.home.filters.locationAll,
      enLibrary.home.filters.locationLibrary,
      enLibrary.home.filters.locationExternal,
    ]);
    fireEvent.click(screen.getByRole("option", { name: enLibrary.home.filters.locationExternal }));

    expect(locationSelect()).toHaveTextContent(enLibrary.home.filters.locationExternal);
    expect(screen.queryByRole("button", { name: "Open Paper" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Thesis" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Slides" })).toBeInTheDocument();
    expect(resetFilters()).toBeEnabled();

    await chooseLocation(enLibrary.home.filters.locationLibrary);
    expect(screen.getByRole("button", { name: "Open Paper" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Thesis" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Slides" })).toBeNull();

    fireEvent.click(resetFilters());
    expect(locationSelect()).toHaveTextContent(enLibrary.home.filters.locationAll);
    for (const name of ["Open Paper", "Open Thesis", "Open Slides"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(resetFilters()).toBeDisabled();
  });

  it("combines with the other filters and the search", async () => {
    useFavoritesStore.setState({ favs: ["linked-slides", "paper"] });
    await renderLibrary();
    openFilters();
    await chooseLocation(enLibrary.home.filters.locationExternal);
    fireEvent.pointerDown(screen.getByLabelText(enLibrary.home.filters.bookmark), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByRole("option", { name: enLibrary.home.filters.bookmarkYes }));
    expect(screen.getByRole("button", { name: "Open Slides" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Thesis" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Paper" })).toBeNull();

    const search = screen.getByRole("combobox", { name: enLibrary.home.searchLabel });
    expect(search).toHaveValue("is:folder is:bookmarked");
    fireEvent.change(search, { target: { value: "is:folder is:bookmarked paper" } });
    expect(screen.getByText(enLibrary.home.noMatchesTitle)).toBeInTheDocument();
  });

  it("falls back to all projects when the last external project leaves", async () => {
    await renderLibrary();
    openFilters();
    await chooseLocation(enLibrary.home.filters.locationExternal);
    expect(screen.queryByRole("button", { name: "Open Paper" })).toBeNull();

    act(() => seed([PAPER]));
    expect(locationSelect()).toBeNull();
    expect(screen.getByRole("button", { name: "Open Paper" })).toBeInTheDocument();
    expect(resetFilters()).toBeDisabled();

    act(() => seed([THESIS, PAPER, SLIDES]));
    expect(locationSelect()).toHaveTextContent(enLibrary.home.filters.locationAll);
    expect(screen.getByRole("button", { name: "Open Paper" })).toBeInTheDocument();
  });
});

describe("project order", () => {
  const DAY = 86_400;
  const OPENED = library("opened", {
    name: "Opened",
    updated_at: TODAY - 7 * DAY,
    last_opened_at: TODAY,
  });
  const EDITED = library("edited", {
    name: "Edited",
    updated_at: TODAY - DAY,
    last_opened_at: TODAY - 30 * DAY,
  });
  const CHANGED = folder("linked-changed", "Changed", { updated_at: TODAY - 40 * DAY });
  const order = () =>
    screen
      .getAllByRole("button", { name: /^Open (Opened|Edited|Changed)$/ })
      .map((button) => button.getAttribute("aria-label"));

  it.each(["grid", "list"] as const)(
    "puts the most recent open or edit first in the %s and keeps the edit date on each item",
    async (layout) => {
      useSettingsStore.setState({ homeProjectLayout: layout });
      seed([CHANGED, EDITED, OPENED]);
      probeProjectAvailability.mockResolvedValue([
        { project_id: "linked-changed", availability: "ok", modified_at_ms: (TODAY - 3600) * 1000 },
      ]);
      render(<Library />);
      expect(order()).toEqual(["Open Opened", "Open Edited", "Open Changed"]);
      await waitFor(() =>
        expect(order()).toEqual(["Open Opened", "Open Changed", "Open Edited"]),
      );
      expect(
        within(card("Open Opened")).getAllByText(projectModifiedLabel(TODAY - 7 * DAY) as string),
      ).not.toHaveLength(0);
      expect(
        within(card("Open Opened")).queryByText(projectModifiedLabel(TODAY) as string),
      ).toBeNull();
      expect(
        within(card("Open Edited")).getAllByText(projectModifiedLabel(TODAY - DAY) as string),
      ).not.toHaveLength(0);
    },
  );
});

describe("folder search", () => {
  it("finds folders by their path", async () => {
    await renderLibrary();
    fireEvent.change(screen.getByRole("combobox", { name: enLibrary.home.searchLabel }), {
      target: { value: "desktop/slides" },
    });
    expect(screen.getByRole("button", { name: "Open Slides" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Thesis" })).toBeNull();
  });
});

describe("folder menu outcomes", () => {
  it("opens a reachable folder from its menu", async () => {
    await renderLibrary();
    openActions("Thesis");

    fireEvent.click(await screen.findByRole("menuitem", { name: enLibrary.projects.openProject }));

    await waitFor(() => expect(openProject).toHaveBeenCalledWith("linked-thesis"));
  });

  it("keeps the folder when the removal is cancelled", async () => {
    await renderLibrary();
    openActions("Thesis");
    fireEvent.click(await screen.findByRole("menuitem", { name: enLibrary.folder.menu.remove }));

    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }),
    );

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(removeLinkedProject).not.toHaveBeenCalled();
  });

  it("confirms a removal even when the library list cannot refresh afterwards", async () => {
    await renderLibrary();
    refreshProjects.mockRejectedValue(new Error("list failed"));
    openActions("Thesis");
    fireEvent.click(await screen.findByRole("menuitem", { name: enLibrary.folder.menu.remove }));

    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: new RegExp(enLibrary.folder.remove.confirm) }),
    );

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(enLibrary.folder.remove.done.replace("{{name}}", "Thesis")),
    );
    expect(notifyError).not.toHaveBeenCalled();
  });
});
