// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProjectInfo } from "@/lib/tauri";

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
  probeProjectAvailability: vi.fn(async () => []),
  revealProject: vi.fn(),
  removeLinkedProject: vi.fn(),
  recycleProject: vi.fn(),
  duplicateProject: vi.fn(),
  readCompiledPdf: vi.fn(),
  setProjectColor: vi.fn(async () => {}),
  locateProjectFolder: vi.fn(async () => "cancelled"),
  adoptReplacedFolder: vi.fn(async () => "cancelled"),
}));
vi.mock("@/features/collab/sharing/SharedWithYou", () => ({ SharedWithYou: () => null }));
vi.mock("@/features/collab/sharing/ShareDialog", () => ({ ShareDialog: () => null }));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { Library } from "@/components/library/Library";
import { useFavoritesStore } from "@/store/favorites";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useLibraryAvailabilityStore } from "@/store/library-availability";
import { useNotesViewStore } from "@/store/notes-view";
import { useSettingsStore } from "@/store/settings";

function project(id: string, name: string, extra: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name,
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

const PAPER = project("paper", "Paper");
const NOTE = project("masking", "Masking strategy", { kind: "note", main_doc: "note.md", engine: "markdown" });

const openLabel = (name: string) => enLibrary.projects.open.replace("{{name}}", name);

async function renderLibrary() {
  const view = render(<Library />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return view;
}

let openProject = vi.fn(async () => {});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  openProject = vi.fn(async () => {});
  useLibraryAvailabilityStore.getState().reset();
  useHomeViewStore.setState({ page: "library", queuedPageAfterProjectClose: null });
  useNotesViewStore.setState({ requestedNoteId: null });
  useFavoritesStore.setState({ favs: [] });
  useSettingsStore.setState({ bgPattern: "none", hoverPreview: false, homeProjectLayout: "grid", newProjectOpen: false });
  useFilesStore.setState({
    projectId: null,
    projectsLoaded: true,
    projects: [PAPER, NOTE],
    refreshProjects: vi.fn(async () => {}),
    openProject,
  });
});

function openKindFilter() {
  fireEvent.click(screen.getByRole("button", { name: enLibrary.home.advancedFilters }));
  const kind = screen.getByLabelText(enLibrary.home.filters.kind);
  fireEvent.pointerDown(kind, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return kind;
}

function searchBox() {
  return screen.getByRole("combobox", { name: enLibrary.home.searchLabel });
}

describe("Library notes while Notes is on", () => {
  beforeEach(() => {
    useSettingsStore.setState({ notes: true });
  });

  it("keeps notes out of the library", async () => {
    await renderLibrary();
    expect(await screen.findByRole("button", { name: openLabel(PAPER.name) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: openLabel(NOTE.name) })).toBeNull();
    expect(searchBox()).toHaveAttribute(
      "placeholder",
      enLibrary.home.searchPlaceholder_one.replace("{{total}}", "1"),
    );
  });

  it("leaves the note kind out of the kind filter", async () => {
    await renderLibrary();
    openKindFilter();
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      enLibrary.home.filters.kindAll,
      enLibrary.home.filters.kindDocument,
      enLibrary.home.filters.kindImage,
      enLibrary.home.filters.kindDiagram,
    ]);
  });

  it("treats a typed note kind as a custom filter and still shows no notes", async () => {
    await renderLibrary();
    fireEvent.change(searchBox(), { target: { value: "kind:note" } });
    fireEvent.click(screen.getByRole("button", { name: enLibrary.home.advancedFilters }));
    expect(screen.getByLabelText(enLibrary.home.filters.kind)).toHaveTextContent(enLibrary.home.customFilter);
    expect(screen.queryByRole("button", { name: openLabel(NOTE.name) })).toBeNull();
  });

  it("welcomes a library that only holds notes", async () => {
    useFilesStore.setState({ projects: [NOTE] });
    await renderLibrary();
    expect(screen.getByText(enLibrary.home.welcomeTitle)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: enLibrary.home.searchLabel })).toBeNull();
  });
});

describe("Library notes while Notes is off", () => {
  beforeEach(() => {
    useSettingsStore.setState({ notes: false });
  });

  it("opens a note card in the editor like any project", async () => {
    await renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: openLabel(NOTE.name) }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith(NOTE.id));
    expect(useHomeViewStore.getState().page).toBe("library");
    expect(useNotesViewStore.getState().requestedNoteId).toBeNull();
  });

  it("still opens other projects in the editor", async () => {
    await renderLibrary();
    fireEvent.click(await screen.findByRole("button", { name: openLabel(PAPER.name) }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith(PAPER.id));
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("names a note card's kind", async () => {
    await renderLibrary();
    const card = (await screen.findByRole("button", { name: openLabel(NOTE.name) })).parentElement as HTMLElement;
    expect(within(card).getByText(enLibrary.projects.kind.note)).toBeInTheDocument();
  });

  it("filters the library down to notes from the kind filter", async () => {
    await renderLibrary();
    const kind = openKindFilter();
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      enLibrary.home.filters.kindAll,
      enLibrary.home.filters.kindDocument,
      enLibrary.home.filters.kindImage,
      enLibrary.home.filters.kindDiagram,
      enLibrary.home.filters.kindNote,
    ]);
    fireEvent.click(screen.getByRole("option", { name: enLibrary.home.filters.kindNote }));
    expect(searchBox()).toHaveValue("kind:note");
    expect(kind).toHaveTextContent(enLibrary.home.filters.kindNote);
    expect(screen.getByRole("button", { name: openLabel(NOTE.name) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: openLabel(PAPER.name) })).toBeNull();
  });
});
