// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProjectInfo } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({ sharedWithYou: vi.fn(), dialog: vi.fn() }));

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
vi.mock("@/features/collab/sharing/SharedWithYou", () => ({
  SharedWithYou: () => {
    mocks.sharedWithYou();
    return <section>{"Shared with you stub"}</section>;
  },
}));
vi.mock("@/features/collab/sharing/ShareDialog", () => ({
  ShareDialog: ({ projectId }: { projectId: string }) => {
    mocks.dialog(projectId);
    return <div role="dialog">{projectId}</div>;
  },
}));

import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { Library } from "@/components/library/Library";
import { useShareDialog } from "@/components/collab/share-dialog";
import { useFavoritesStore } from "@/store/favorites";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useLibraryAvailabilityStore } from "@/store/library-availability";
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

const GRANT = project("grant", "Grant", { shared: { server_name: "Smith Lab", role: "owner" } });
const PAPER = project("paper", "Paper");

function card(name: string) {
  return screen.getByRole("button", { name }).parentElement as HTMLElement;
}

function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: enLibrary.home.advancedFilters }));
}

function locationSelect() {
  return screen.queryByLabelText(enLibrary.home.filters.location);
}

async function chooseLocation(label: string) {
  fireEvent.pointerDown(locationSelect() as HTMLElement, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

async function renderLibrary() {
  const view = render(<Library />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return view;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  useLibraryAvailabilityStore.getState().reset();
  useHomeViewStore.setState({ page: "library" });
  useFavoritesStore.setState({ favs: [] });
  useShareDialog.setState({ projectId: null, fromCopy: false });
  useSettingsStore.setState({ bgPattern: "none", hoverPreview: false, homeProjectLayout: "grid", newProjectOpen: false });
  useFilesStore.setState({
    projectsLoaded: true,
    projects: [GRANT, PAPER],
    refreshProjects: vi.fn(async () => {}),
    openProject: vi.fn(async () => {}),
  });
});

afterEach(() => {
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("Library with live collaboration on", () => {
  beforeEach(() => {
    useSettingsStore.setState({ liveCollaboration: true });
  });

  it("labels shared projects and lists what others shared", async () => {
    await renderLibrary();
    await waitFor(() => expect(within(card("Open Grant")).getByText(enCollab.library.kind)).toBeInTheDocument());
    expect(within(card("Open Paper")).queryByText(enCollab.library.kind)).toBeNull();
    expect(await screen.findByText("Shared with you stub")).toBeInTheDocument();
  });

  it("filters by Shared and keeps In Oleafly to projects that are not shared", async () => {
    await renderLibrary();
    await waitFor(() => expect(within(card("Open Grant")).getByText(enCollab.library.kind)).toBeInTheDocument());
    openFilters();
    fireEvent.pointerDown(locationSelect() as HTMLElement, { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      enLibrary.home.filters.locationAll,
      enCollab.library.locationNotShared,
      enCollab.library.location,
    ]);
    fireEvent.click(screen.getByRole("option", { name: enCollab.library.location }));
    const search = screen.getByRole("combobox", { name: enLibrary.home.searchLabel });
    expect(search).toHaveValue("is:shared");
    expect(locationSelect()).toHaveTextContent(enCollab.library.location);
    expect(screen.getByRole("button", { name: "Open Grant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Paper" })).toBeNull();

    await chooseLocation(enCollab.library.locationNotShared);
    expect(search).toHaveValue("is:library -is:shared");
    expect(locationSelect()).toHaveTextContent(enCollab.library.locationNotShared);
    expect(screen.getByRole("button", { name: "Open Paper" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Grant" })).toBeNull();
  });

  it("offers Share in the project menu", async () => {
    await renderLibrary();
    await waitFor(() => expect(within(card("Open Grant")).getByText(enCollab.library.kind)).toBeInTheDocument());
    fireEvent.pointerDown(
      screen.getAllByRole("button", { name: enLibrary.projects.actions.replace("{{name}}", "Paper") })[0],
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: enCollab.share.button }));
    expect(useShareDialog.getState().projectId).toBe("paper");
    expect(await screen.findByRole("dialog")).toHaveTextContent("paper");
  });
});

describe("Library with live collaboration off", () => {
  it("shows no sharing labels, filters, menu items or lists", async () => {
    await renderLibrary();
    expect(within(card("Open Grant")).queryByText(enCollab.library.kind)).toBeNull();
    openFilters();
    expect(locationSelect()).toBeNull();
    fireEvent.pointerDown(
      screen.getAllByRole("button", { name: enLibrary.projects.actions.replace("{{name}}", "Paper") })[0],
      { button: 0, ctrlKey: false, pointerType: "mouse" },
    );
    await screen.findAllByRole("menuitem");
    expect(screen.queryByRole("menuitem", { name: enCollab.share.button })).toBeNull();
    expect(mocks.sharedWithYou).not.toHaveBeenCalled();
  });
});
