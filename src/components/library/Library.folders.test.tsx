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
import { RECENT_LIMIT } from "@/lib/library-projects";
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
      expect(within(folderCard).getByText("Tectonic")).toBeInTheDocument();
      expect(within(folderCard).getByText(EXTERNAL)).toBeInTheDocument();
      expect(within(folderCard).getByText(projectModifiedLabel(TODAY) as string)).toBeInTheDocument();
      expect(within(folderCard).queryByText(enLibrary.folder.badge)).toBeNull();
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
    expect(await within(thesis).findByText(label)).toBeInTheDocument();
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
    expect(within(list).queryByText(enLibrary.folder.badge)).toBeNull();
    expect(columns("Open Thesis")).toEqual([EXTERNAL, "Tectonic", projectModifiedLabel(TODAY)]);
    expect(columns("Open Slides")).toEqual([EXTERNAL, "Tectonic", enLibrary.folder.state.offline]);
    const slides = screen.getByRole("button", { name: "Open Slides" });
    expect(within(slides).getByText(enLibrary.folder.state.offline).closest("span.sm\\:hidden")).not.toBeNull();
    expect(within(slides).getByText(`Tectonic · ${EXTERNAL}`)).toHaveClass("hidden", "sm:block", "lg:hidden");
    expect(within(screen.getByRole("button", { name: "Open Thesis" })).getByText(`Tectonic · ${EXTERNAL}`)).toHaveClass("lg:hidden");
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
    expect(within(thesis).getByText("Tectonic")).toBeInTheDocument();
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
    expect(within(thesis).getByText(`Tectonic · ${EXTERNAL}`)).toHaveClass("lg:hidden");
    expect(columns("Open Thesis")).toEqual([EXTERNAL, "Tectonic", projectModifiedLabel(TODAY)]);
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
        enLibrary.projects.favoriteAdd,
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

  it("bookmarks from the menu", async () => {
    await renderLibrary();
    openActions("Thesis");
    fireEvent.click(await screen.findByRole("menuitem", { name: enLibrary.projects.favoriteAdd }));
    expect(useFavoritesStore.getState().favs).toContain("linked-thesis");
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

describe("scope chips", () => {
  it("stay hidden while the library holds no folders", async () => {
    seed([PAPER, library("notes", { name: "Notes" })]);
    await renderLibrary();
    expect(screen.queryByRole("group", { name: enLibrary.home.scope.label })).toBeNull();
    expect(screen.queryByTestId("library-recent")).toBeNull();
    expect(probeProjectAvailability).not.toHaveBeenCalled();
  });

  it("filter the shelf", async () => {
    await renderLibrary();
    const group = screen.getByRole("group", { name: enLibrary.home.scope.label });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual([
      `${enLibrary.home.scope.all}3`,
      `${enLibrary.home.scope.library}1`,
      `${enLibrary.home.scope.folders}2`,
    ]);
    expect(radios[0]).toBeChecked();

    fireEvent.click(radios[2]);
    expect(radios[2]).toBeChecked();
    expect(screen.queryByRole("button", { name: "Open Paper" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Thesis" })).toBeInTheDocument();

    fireEvent.click(radios[1]);
    expect(screen.getByRole("button", { name: "Open Paper" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Thesis" })).toBeNull();
  });

  it("fall back to everything when the last folder leaves", async () => {
    await renderLibrary();
    fireEvent.click(screen.getAllByRole("radio")[2]);
    act(() => seed([PAPER]));
    expect(screen.queryByRole("group", { name: enLibrary.home.scope.label })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Paper" })).toBeInTheDocument();
  });
});

describe("recent row", () => {
  const many = [
    THESIS,
    PAPER,
    SLIDES,
    ...Array.from({ length: RECENT_LIMIT }, (_, index) =>
      library(`extra-${index}`, { name: `Extra ${index}`, last_opened_at: index === 0 ? 150 : 0 }),
    ),
  ];

  it("mixes folders and library projects by when they were last opened", async () => {
    seed(many);
    await renderLibrary();
    const recent = screen.getByTestId("library-recent");
    const names = within(recent)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual([
      `Thesis${enLibrary.folder.badge}~/Desktop/thesis`,
      `Paper${enLibrary.home.scope.library}`,
      `Extra 0${enLibrary.home.scope.library}`,
      `Slides${enLibrary.folder.badge}~/Desktop/slides`,
    ]);
    fireEvent.click(within(recent).getAllByRole("button")[1]);
    expect(openProject).toHaveBeenCalledWith("paper");
  });

  it("hides while searching and when every project already fits on screen", async () => {
    seed(many);
    await renderLibrary();
    fireEvent.change(screen.getByRole("searchbox", { name: enLibrary.home.searchLabel }), {
      target: { value: "thesis" },
    });
    expect(screen.queryByTestId("library-recent")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: enLibrary.home.searchLabel }), {
      target: { value: "" },
    });
    expect(screen.getByTestId("library-recent")).toBeInTheDocument();

    act(() => seed([THESIS, PAPER, SLIDES]));
    expect(screen.queryByTestId("library-recent")).toBeNull();
  });

  it("keeps a long path's folder name in view", async () => {
    const deep = "~/Library/Mobile Documents/com~apple~CloudDocs/2024/thesis";
    seed([
      folder("linked-deep", "Deep", {
        last_opened_at: 500,
        location: { kind: "linked", display_path: deep, availability: "unknown" },
      }),
      ...Array.from({ length: RECENT_LIMIT }, (_, index) =>
        library(`extra-${index}`, { name: `Extra ${index}` }),
      ),
    ]);
    await renderLibrary();
    const path = within(screen.getByTestId("library-recent")).getByTitle(deep);
    expect(path).toHaveTextContent(deep);
    const tail = within(path).getByText("/2024/thesis");
    expect(tail).toHaveClass("shrink-0");
    expect(within(path).getByText("~/Library/Mobile Documents/com~apple~CloudDocs")).toHaveClass(
      "truncate",
    );
  });

  it("finds folders by their path", async () => {
    await renderLibrary();
    fireEvent.change(screen.getByRole("searchbox", { name: enLibrary.home.searchLabel }), {
      target: { value: "desktop/slides" },
    });
    expect(screen.getByRole("button", { name: "Open Slides" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Thesis" })).toBeNull();
  });
});
