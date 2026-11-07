// @vitest-environment jsdom

import { createLayout, group, groupOfView, groupsOf, split, type LayoutNode, type WorkspaceLayout } from "@oleafly/workspace";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { ArtifactPanel as ArtifactPanelComponent } from "./ArtifactPanel";
import type { NoteDocument as NoteDocumentComponent } from "./NoteDocument";
import type { NotesHome as NotesHomeComponent } from "./NotesHome";
import type { NotesLibrary as NotesLibraryComponent } from "./NotesLibrary";
import type { ArtifactItem, NoteItem } from "./types";

const env = vi.hoisted(() => ({ mac: false, fullscreen: false }));
const probe = vi.hoisted(() => ({ mounts: new Map<string, number>() }));
const label = vi.hoisted(() => ({
  library: "Library",
  libraryHome: "Library home",
  libraryNewNote: "Library new note",
  startNote: "Home start note",
  sendSelection: "Send selection",
  markSaving: "Mark saving",
  markFailed: "Mark failed",
  markSaved: "Mark saved",
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    get isMac() {
      return env.mac;
    },
  };
});
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => env.fullscreen }));

vi.mock("./NoteDocument", async () => {
  const { useEffect } = await import("react");
  return {
    NoteDocument: function NoteDocumentStandIn({
      note,
      insertRequest,
      onSendToPaper,
      onStatusChange,
    }: Parameters<typeof NoteDocumentComponent>[0]) {
      useEffect(() => {
        probe.mounts.set(note.id, (probe.mounts.get(note.id) ?? 0) + 1);
      }, [note.id]);
      return (
        <div data-testid={`document-${note.id}`}>
          <output data-testid={`insert-${note.id}`}>{insertRequest ? `${insertRequest.snippet} #${insertRequest.id}` : "none"}</output>
          <button type="button" onClick={() => onSendToPaper(`Selected in ${note.title}`)}>
            {label.sendSelection}
          </button>
          <button type="button" onClick={() => onStatusChange?.("saving")}>
            {label.markSaving}
          </button>
          <button type="button" onClick={() => onStatusChange?.("failed")}>
            {label.markFailed}
          </button>
          <button type="button" onClick={() => onStatusChange?.("saved")}>
            {label.markSaved}
          </button>
        </div>
      );
    },
  };
});

vi.mock("./NotesLibrary", async () => {
  const { useNotesData } = await import("./notes-data");
  return {
    NotesLibrary: function NotesLibraryStandIn({
      iconFor,
      activeNoteId,
      activeArtifactId,
      onHome,
      onNewNote,
      onOpenNote,
      onOpenNoteInNewTab,
      onOpenArtifact,
    }: Parameters<typeof NotesLibraryComponent>[0]) {
      const data = useNotesData();
      return (
        <aside aria-label={label.library}>
          <output data-testid="library-active">{`${activeNoteId ?? "none"} ${activeArtifactId ?? "none"}`}</output>
          <button type="button" onClick={onHome}>
            {label.libraryHome}
          </button>
          <button type="button" disabled={!onNewNote} onClick={onNewNote}>
            {label.libraryNewNote}
          </button>
          {data.notes.map((note) => (
            <button key={note.id} type="button" data-icon={iconFor(note) ?? ""} onClick={() => onOpenNote(note.id)}>
              {`Library note ${note.id}`}
            </button>
          ))}
          {onOpenNoteInNewTab &&
            data.notes.map((note) => (
              <button key={note.id} type="button" onClick={() => onOpenNoteInNewTab(note.id)}>
                {`Library new tab ${note.id}`}
              </button>
            ))}
          {data.artifacts.map((artifact) => (
            <button key={artifact.id} type="button" onClick={() => onOpenArtifact(artifact)}>
              {`Library artifact ${artifact.id}`}
            </button>
          ))}
        </aside>
      );
    },
  };
});

vi.mock("./NotesHome", async () => {
  const { useNotesData } = await import("./notes-data");
  return {
    NotesHome: function NotesHomeStandIn({ iconFor, onOpenNote, onOpenArtifact, onStartNote }: Parameters<typeof NotesHomeComponent>[0]) {
      const data = useNotesData();
      return (
        <section data-testid="home">
          {data.notes.map((note) => (
            <button key={note.id} type="button" data-icon={iconFor(note) ?? ""} onClick={() => onOpenNote(note.id)}>
              {`Home note ${note.id}`}
            </button>
          ))}
          {data.artifacts.map((artifact) => (
            <button key={artifact.id} type="button" onClick={() => onOpenArtifact(artifact)}>
              {`Home artifact ${artifact.id}`}
            </button>
          ))}
          {onStartNote && (
            <button type="button" onClick={() => onStartNote("Write up run 42")}>
              {label.startNote}
            </button>
          )}
        </section>
      );
    },
  };
});

vi.mock("./ArtifactPanel", async () => {
  const { useNotesData } = await import("./notes-data");
  return {
    ArtifactPanel: function ArtifactPanelStandIn({ note, selectedId, onSelect, onInsert, onNewProject }: Parameters<typeof ArtifactPanelComponent>[0]) {
      const data = useNotesData();
      const own = data.artifacts.filter((artifact) => artifact.projectId === note.relatedProjectId);
      return (
        <section data-testid="artifact-panel">
          <output data-testid="panel-state">{`${note.id} ${selectedId ?? "none"}`}</output>
          {own.map((artifact) => (
            <div key={artifact.id}>
              <button type="button" onClick={() => onSelect(artifact.id)}>
                {`Select ${artifact.id}`}
              </button>
              {onInsert && (
                <button type="button" onClick={() => void onInsert(artifact)}>
                  {`Insert ${artifact.id}`}
                </button>
              )}
              {onNewProject && (
                <button type="button" onClick={() => onNewProject(artifact)}>
                  {`Project from ${artifact.id}`}
                </button>
              )}
            </div>
          ))}
        </section>
      );
    },
  };
});

import { NotesDataProvider, type NotesData } from "./notes-data";
import { defaultNotesLayout, NOTES_LAYOUT_KEY, noteView } from "./notes-layout";
import { NotesWorkspace } from "./NotesWorkspace";

type WorkspaceProps = Parameters<typeof NotesWorkspace>[0];

const copy = enNotes.workspace;
const NOW = Date.UTC(2026, 10, 7, 12);

const notes: NoteItem[] = [
  {
    id: "n1",
    title: "Masking ablation",
    project: "Vision",
    relatedProjectId: "p1",
    updatedAt: NOW - 60_000,
    author: "agent",
    agent: "Codex",
    summary: "Masking ratio sweep across three seeds",
  },
  {
    id: "n2",
    title: "Reading list",
    project: "Language",
    updatedAt: NOW - 120_000,
    author: "you",
    icon: "🧠",
    summary: "Papers to read this week",
  },
  {
    id: "n3",
    title: "Older vision note",
    project: "Vision",
    relatedProjectId: "p1",
    updatedAt: NOW - 600_000,
    author: "you",
    summary: "First pass at the masking idea",
  },
];

function artifact(id: string, title: string, projectId: string, kind: ArtifactItem["kind"]): ArtifactItem {
  return {
    id,
    taskId: `task-${id}`,
    path: `out/${id}`,
    title,
    kind,
    projectId,
    project: "Vision",
    updatedAt: NOW - 30_000,
    agent: "Codex",
    chat: "Ablation chat",
    summary: "",
  };
}

const artifacts: ArtifactItem[] = [
  artifact("a1", "Loss curve", "p1", "figure"),
  artifact("a2", "Run table", "p1", "data"),
  artifact("a3", "Stray report", "p9", "report"),
];

const papers = [
  { id: "paper-1", label: "Masking paper" },
  { id: "paper-2", label: "Survey draft" },
];

const VIEWS = {
  home: { type: "home" },
  artifacts: { type: "artifacts" },
  "note:n1": noteView("n1"),
  "note:n2": noteView("n2"),
};

function fakeData(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes,
    artifacts,
    experiments: [],
    agents: [],
    citations: [],
    papers,
    copyArtifact: vi.fn((_noteId: string, item: ArtifactItem) => Promise.resolve(`files/${item.id}.png`)),
    proposeEdits: vi.fn(),
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(props: WorkspaceProps = {}, data: NotesData = fakeData()) {
  const tree = (next: WorkspaceProps) => (
    <NotesDataProvider value={data}>
      <NotesWorkspace {...next} />
    </NotesDataProvider>
  );
  const utils = render(tree(props));
  return { ...utils, data, rerenderWith: (next: WorkspaceProps) => utils.rerender(tree(next)) };
}

function seedLayout(layout: WorkspaceLayout) {
  localStorage.setItem(NOTES_LAYOUT_KEY, JSON.stringify(layout));
}

function storedLayout(): WorkspaceLayout | null {
  return JSON.parse(localStorage.getItem(NOTES_LAYOUT_KEY) ?? "null") as WorkspaceLayout | null;
}

function hidePage() {
  window.dispatchEvent(new Event("pagehide"));
}

function savedLayout(): WorkspaceLayout {
  hidePage();
  const layout = storedLayout();
  if (!layout) throw new Error("no saved layout");
  return layout;
}

function groupViews(layout: WorkspaceLayout | null): string[][] {
  return layout ? groupsOf(layout.root).map((candidate) => candidate.views) : [];
}

function shownViews(): string[] {
  return [...document.querySelectorAll('[role="tabpanel"][data-shown="true"]')].map((element) => element.getAttribute("data-view") ?? "").sort();
}

function viewHost(element: HTMLElement): HTMLElement | null {
  return element.closest('[role="tabpanel"]');
}

function savedGroups(): string[][] {
  return groupViews(savedLayout());
}

function savedWeights(): number[] {
  const root: LayoutNode = savedLayout().root;
  return root.kind === "split" ? root.weights : [1];
}

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", { name });
}

function tabNames(): string[] {
  return screen
    .queryAllByRole("tab")
    .map((element) => element.querySelector(":scope > span:not([aria-hidden])")?.textContent ?? "");
}

function panel(name: string): HTMLElement {
  return screen.getByRole("tabpanel", { name });
}

function groupIdOf(element: HTMLElement): string | null {
  return element.closest("[data-group]")?.getAttribute("data-group") ?? null;
}

function libraryState(): string | null {
  return screen.getByTestId("library-active").textContent;
}

function artifactsToggle(total: number): HTMLElement {
  return screen.getByRole("button", { name: copy.artifacts.replace("{{total}}", String(total)) });
}

function homePanel(): HTMLElement {
  return within(panel(copy.home)).getByTestId("home");
}

function spacer(): Element | null {
  return document.querySelector(".w-\\[70px\\]");
}

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  env.mac = false;
  env.fullscreen = false;
  probe.mounts.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("NotesWorkspace layout", () => {
  it("opens on Home beside the library", () => {
    renderWorkspace();
    expect(tabNames()).toEqual([copy.home]);
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "true");
    expect(shownViews()).toEqual(["home"]);
    expect(homePanel()).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Library" })).toBeInTheDocument();
    expect(libraryState()).toBe("none none");
    expect(savedLayout()).toEqual(defaultNotesLayout());
  });

  it("hands the note icons to the library and Home", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: "Library note n2" })).toHaveAttribute("data-icon", "🧠");
    expect(screen.getByRole("button", { name: "Library note n1" })).toHaveAttribute("data-icon", "");
    expect(within(homePanel()).getByRole("button", { name: "Home note n2" })).toHaveAttribute("data-icon", "🧠");
  });

  it("puts the sidebar toggle and the Artifacts button in a tab bar that drags the window", () => {
    renderWorkspace();
    const strip = screen.getByRole("tablist");
    const area = strip.closest("[data-strip]") as HTMLElement;
    const bar = area.parentElement as HTMLElement;
    const root = strip.closest("[data-group]")?.parentElement as HTMLElement;
    expect(strip).toHaveAttribute("data-tauri-drag-region");
    expect(area).toHaveAttribute("data-tauri-drag-region");
    expect(bar).toHaveAttribute("data-tauri-drag-region");
    expect(within(area).getByRole("button", { name: copy.newTab }).parentElement).toHaveAttribute("data-tauri-drag-region");
    expect(root).toHaveAttribute("data-tauri-drag-region");
    const sidebar = within(bar).getByRole("button", { name: copy.hideSidebar });
    expect(sidebar).toHaveAttribute("aria-expanded", "true");
    const toggle = within(bar).getByRole("button", { name: copy.artifacts.replace("{{total}}", "0") });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).not.toHaveClass("bg-accent");
    expect(toggle).toHaveTextContent("");
    expect(sidebar.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: copy.maximize })).not.toBeInTheDocument();
  });

  it("opens the note it was asked to show next to Home", () => {
    renderWorkspace({ initialNoteId: "n1" });
    expect(tabNames()).toEqual([copy.home, "Masking ablation"]);
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "false");
    expect(groupIdOf(tab("Masking ablation"))).toBe(groupIdOf(tab(copy.home)));
    const note = panel("Masking ablation");
    expect(within(note).getByText("Vision")).toBeInTheDocument();
    expect(within(note).getByText(copy.saved)).toBeInTheDocument();
    expect(within(note).getByTestId("document-n1")).toBeInTheDocument();
    expect(shownViews()).toEqual(["note:n1"]);
    expect(libraryState()).toBe("n1 none");
    expect(artifactsToggle(2)).toHaveTextContent("2");
    expect(savedGroups()).toEqual([["home", "note:n1"]]);
  });

  it("counts no artifacts for a note without a project", () => {
    renderWorkspace({ initialNoteId: "n2" });
    expect(artifactsToggle(0)).toHaveTextContent("");
  });

  it("opens notes as tabs next to Home and reuses a tab that is already open", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library note n2" }));
    expect(tab("Reading list")).toHaveAttribute("aria-selected", "true");
    expect(groupIdOf(tab("Reading list"))).toBe(groupIdOf(tab(copy.home)));
    await user.click(screen.getByRole("button", { name: "Library note n1" }));
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Library note n2" }));
    expect(tabNames()).toEqual([copy.home, "Reading list", "Masking ablation"]);
    expect(tab("Reading list")).toHaveAttribute("aria-selected", "true");
    expect(libraryState()).toBe("n2 none");
  });

  it("opens a note picked on Home in place of the Home tab", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(within(homePanel()).getByRole("button", { name: "Home note n3" }));
    expect(tabNames()).toEqual(["Older vision note"]);
    expect(tab("Older vision note")).toHaveAttribute("aria-selected", "true");
    expect(libraryState()).toBe("n3 none");
    expect(savedGroups()).toEqual([["note:n3"]]);
  });

  it("fills the Home view with Home itself", () => {
    renderWorkspace();
    expect(homePanel().parentElement).toBe(panel(copy.home));
  });

  it("keeps each note's editor mounted while switching tabs", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library note n1" }));
    await user.click(screen.getByRole("button", { name: "Library note n2" }));
    await user.click(tab("Masking ablation"));
    expect(viewHost(screen.getByTestId("document-n1"))).toHaveAttribute("data-shown", "true");
    expect(viewHost(screen.getByTestId("document-n2"))).toHaveAttribute("data-shown", "false");
    expect(viewHost(screen.getByTestId("document-n2"))).toHaveAttribute("aria-hidden", "true");
    await user.click(tab("Reading list"));
    await user.click(tab(copy.home));
    await user.click(tab("Masking ablation"));
    expect(shownViews()).toEqual(["note:n1"]);
    expect(screen.getByTestId("document-n2")).toBeInTheDocument();
    expect(Object.fromEntries(probe.mounts)).toEqual({ n1: 1, n2: 1 });
  });

  it("shows whether the note is saving or failed to save", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    const note = panel("Masking ablation");
    await user.click(within(note).getByRole("button", { name: "Mark saving" }));
    expect(within(note).getByText(copy.saving)).toHaveClass("text-muted-foreground");
    expect(within(note).queryByText(copy.saved)).not.toBeInTheDocument();
    await user.click(within(note).getByRole("button", { name: "Mark failed" }));
    expect(within(note).getByText(copy.saveFailed)).toHaveClass("text-destructive");
    await user.click(within(note).getByRole("button", { name: "Mark saved" }));
    expect(within(note).getByText(copy.saved)).not.toHaveClass("text-destructive");
  });

  it("explains a note that is no longer in the library", () => {
    renderWorkspace({ initialNoteId: "gone" });
    const untitled = enNotes.document.untitled;
    expect(tab(untitled)).toHaveAttribute("aria-selected", "true");
    expect(within(panel(untitled)).getByText(copy.missing)).toBeInTheDocument();
    expect(screen.queryByTestId("document-gone")).not.toBeInTheDocument();
    expect(libraryState()).toBe("gone none");
    expect(artifactsToggle(0)).toBeInTheDocument();
  });

  it("closes the tab of a note that is no longer in the library", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "gone" });
    await user.click(within(panel(enNotes.document.untitled)).getByRole("button", { name: copy.closeMissing }));
    expect(tabNames()).toEqual([copy.home]);
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "true");
    expect(savedLayout()).toEqual(defaultNotesLayout());
  });

  it("closes a note tab from its close button", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: copy.closeTab.replace("{{title}}", "Masking ablation") }));
    expect(tabNames()).toEqual([copy.home]);
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "true");
    expect(savedLayout()).toEqual(defaultNotesLayout());
  });

  it("hides and shows the library", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    expect(screen.queryByRole("complementary", { name: "Library" })).not.toBeInTheDocument();
    const show = screen.getByRole("button", { name: copy.showSidebar });
    expect(show).toHaveAttribute("aria-expanded", "false");
    await user.click(show);
    expect(screen.getByRole("complementary", { name: "Library" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enShell.home.ariaLabel })).not.toBeInTheDocument();
  });

  it("leaves room for the macOS window buttons only while the library is hidden", async () => {
    env.mac = true;
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    expect(spacer()).toBeNull();
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    expect(spacer()).toHaveAttribute("aria-hidden", "true");
    expect(spacer()?.parentElement).toContainElement(screen.getByRole("button", { name: copy.showSidebar }));
  });

  it("leaves no room for window buttons in fullscreen or off macOS", async () => {
    env.mac = true;
    env.fullscreen = true;
    const user = userEvent.setup();
    const { unmount } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    expect(spacer()).toBeNull();
    unmount();
    env.mac = false;
    env.fullscreen = false;
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    expect(spacer()).toBeNull();
  });
});

describe("NotesWorkspace Home", () => {
  it("goes Home from a note, then leaves Notes from Home", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onExit });
    await user.click(screen.getByRole("button", { name: "Library home" }));
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "true");
    expect(onExit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Library home" }));
    expect(onExit).toHaveBeenCalledOnce();
    expect(tabNames()).toEqual([copy.home, "Masking ablation"]);
  });

  it("leaves Notes from Home once Home has been focused", async () => {
    const onExit = vi.fn();
    renderWorkspace({ onExit });
    fireEvent.pointerDown(homePanel());
    fireEvent.click(screen.getByRole("button", { name: "Library home" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("leaves Notes from the first Home click when Notes opened on Home", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderWorkspace({ onExit });
    await user.click(screen.getByRole("button", { name: "Library home" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("reopens Home after it was closed", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onExit });
    await user.click(screen.getByRole("button", { name: copy.closeTab.replace("{{title}}", copy.home) }));
    expect(tabNames()).toEqual(["Masking ablation"]);
    await user.click(screen.getByRole("button", { name: "Library home" }));
    expect(tabNames()).toEqual(["Masking ablation", copy.home]);
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "true");
    expect(onExit).not.toHaveBeenCalled();
  });

  it("stays on Home when there is nowhere to leave to", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library home" }));
    await user.click(screen.getByRole("button", { name: "Library home" }));
    expect(tabNames()).toEqual([copy.home]);
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "true");
  });

  it("offers Home when every tab is closed", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: copy.closeTab.replace("{{title}}", copy.home) }));
    expect(tabNames()).toEqual([]);
    await user.click(screen.getByRole("button", { name: copy.home }));
    expect(tabNames()).toEqual([copy.home]);
    expect(shownViews()).toEqual(["home"]);
  });

  it("offers the brand button while the library is hidden", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderWorkspace({ initialNoteId: "n2", onExit });
    await user.click(screen.getByRole("button", { name: copy.hideSidebar }));
    const brand = screen.getByRole("button", { name: enShell.home.ariaLabel });
    expect(brand.closest("[data-group]")).toContainElement(screen.getByRole("tablist"));
    await user.click(brand);
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "true");
    expect(onExit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: enShell.home.ariaLabel }));
    expect(onExit).toHaveBeenCalledOnce();
  });
});

describe("NotesWorkspace Home tabs", () => {
  function newTabIn(groupId: string): HTMLElement {
    const owner = document.querySelector<HTMLElement>(`[data-group="${groupId}"]`);
    if (!owner) throw new Error(`no group ${groupId}`);
    return within(owner).getByRole("button", { name: copy.newTab });
  }

  function homeIn(viewId: string): HTMLElement {
    const host = document.querySelector<HTMLElement>(`[role="tabpanel"][data-view="${viewId}"]`);
    if (!host) throw new Error(`no view ${viewId}`);
    return within(host).getByTestId("home");
  }

  it("opens a new Home tab after the last tab of the group", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(newTabIn("g1"));
    expect(tabNames()).toEqual([copy.home, "Masking ablation", copy.home]);
    expect(screen.getAllByRole("tab", { name: copy.home })[1]).toHaveAttribute("aria-selected", "true");
    expect(shownViews()).toEqual(["home:2"]);
    expect(libraryState()).toBe("n1 none");
    await user.click(newTabIn("g1"));
    expect(savedGroups()).toEqual([["home", "note:n1", "home:2", "home:3"]]);
  });

  it("opens the new tab in the group whose button was pressed", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(split("s1", "row", [group("g1", ["home", "note:n1"]), group("g2", ["note:n2"])]), {
        home: VIEWS.home,
        "note:n1": VIEWS["note:n1"],
        "note:n2": VIEWS["note:n2"],
      }),
    );
    renderWorkspace();
    await user.click(newTabIn("g2"));
    expect(savedGroups()).toEqual([["home", "note:n1"], ["note:n2", "home:2"]]);
  });

  it("names the new tab Home again once the first Home is closed", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: copy.closeTab.replace("{{title}}", copy.home) }));
    await user.click(newTabIn("g1"));
    expect(savedGroups()).toEqual([["note:n1", "home"]]);
  });

  it("replaces only the Home tab the note was picked on, in its place", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(group("g1", ["home", "home:2", "note:n1"], "home:2"), { home: VIEWS.home, "home:2": VIEWS.home, "note:n1": VIEWS["note:n1"] }),
    );
    renderWorkspace();
    await user.click(within(homeIn("home:2")).getByRole("button", { name: "Home note n2" }));
    expect(tabNames()).toEqual([copy.home, "Reading list", "Masking ablation"]);
    expect(tab("Reading list")).toHaveAttribute("aria-selected", "true");
    expect(libraryState()).toBe("n2 none");
    expect(savedGroups()).toEqual([["home", "note:n2", "note:n1"]]);
  });

  it("brings a note open in another group to the Home tab it was picked on", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(split("s1", "row", [group("g1", ["home:2"]), group("g2", ["home", "note:n1"], "note:n1")]), {
        "home:2": VIEWS.home,
        home: VIEWS.home,
        "note:n1": VIEWS["note:n1"],
      }),
    );
    probe.mounts.clear();
    renderWorkspace();
    await user.click(within(homeIn("home:2")).getByRole("button", { name: "Home note n1" }));
    expect(savedGroups()).toEqual([["note:n1"], ["home"]]);
    expect(probe.mounts.get("n1")).toBe(1);
  });

  it("keeps the Home tab when a note is opened from the library", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(newTabIn("g1"));
    await user.click(screen.getByRole("button", { name: "Library note n1" }));
    expect(savedGroups()).toEqual([["home", "home:2", "note:n1"]]);
  });

  it("opens an artifact picked on a Home tab in place of that tab", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(newTabIn("g1"));
    await user.click(within(homeIn("home:2")).getByRole("button", { name: "Home artifact a2" }));
    expect(savedGroups()).toEqual([["home", "note:n1"], ["artifacts"]]);
    expect(screen.getByTestId("panel-state")).toHaveTextContent("n1 a2");
    expect(libraryState()).toBe("n1 a2");
  });

  it("goes to the first Home tab from a note, then leaves Notes", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    seedLayout(
      createLayout(split("s1", "row", [group("g1", ["note:n1", "home:4"], "note:n1"), group("g2", ["home"])]), {
        "note:n1": VIEWS["note:n1"],
        "home:4": VIEWS.home,
        home: VIEWS.home,
      }),
    );
    renderWorkspace({ onExit });
    await user.click(screen.getByRole("button", { name: "Library home" }));
    expect(shownViews()).toEqual(["home", "home:4"]);
    expect(groupOfView(savedLayout(), "home:4")?.active).toBe("home:4");
    expect(onExit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Library home" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("leaves Notes from any Home tab that is in front", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    renderWorkspace({ onExit, initialNoteId: "n1" });
    await user.click(newTabIn("g1"));
    await user.click(screen.getByRole("button", { name: "Library home" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("restores Home tabs saved in the layout", () => {
    seedLayout(createLayout(group("g1", ["home", "home:2"], "home:2"), { home: VIEWS.home, "home:2": VIEWS.home }));
    renderWorkspace();
    expect(tabNames()).toEqual([copy.home, copy.home]);
    expect(shownViews()).toEqual(["home:2"]);
  });
});

describe("NotesWorkspace open in new tab", () => {
  it("adds the note as a new tab in the stage group and keeps Home", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library new tab n1" }));
    expect(tabNames()).toEqual([copy.home, "Masking ablation"]);
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
    expect(libraryState()).toBe("n1 none");
  });

  it("does not replace the Home tab in front", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: copy.newTab }));
    await user.click(screen.getByRole("button", { name: "Library new tab n2" }));
    expect(savedGroups()).toEqual([["home", "home:2", "note:n2"]]);
  });

  it("uses the stage group rather than the group in focus", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(
        split("s1", "row", [group("g1", ["home"]), group("g2", ["note:n1"])]),
        { home: VIEWS.home, "note:n1": VIEWS["note:n1"] },
        "g1",
      ),
    );
    renderWorkspace();
    fireEvent.pointerDown(screen.getByTestId("document-n1"));
    await user.click(screen.getByRole("button", { name: "Library new tab n2" }));
    expect(savedGroups()).toEqual([["home", "note:n2"], ["note:n1"]]);
  });

  it("reveals a note that is already open instead of moving it", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(
        split("s1", "row", [group("g1", ["home", "note:n2"], "note:n2"), group("g2", ["note:n1", "home:2"], "home:2")]),
        { home: VIEWS.home, "note:n2": VIEWS["note:n2"], "note:n1": VIEWS["note:n1"], "home:2": VIEWS.home },
        "g1",
      ),
    );
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library new tab n1" }));
    expect(savedGroups()).toEqual([["home", "note:n2"], ["note:n1", "home:2"]]);
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
    expect(libraryState()).toBe("n1 none");
  });
});

describe("NotesWorkspace empty panels", () => {
  const empty = copy.emptyPanel;

  function emptyBeside(): WorkspaceLayout {
    return createLayout(
      split("s1", "row", [group("g1", ["home", "note:n1"], "note:n1"), group("g2", [])]),
      { home: VIEWS.home, "note:n1": VIEWS["note:n1"] },
      "g2",
    );
  }

  function emptyPanel(): HTMLElement {
    const owner = screen.getByText(empty).closest("[data-group]");
    if (!(owner instanceof HTMLElement)) throw new Error("no empty panel");
    return owner;
  }

  it("offers a new note and Home in an empty panel", () => {
    seedLayout(emptyBeside());
    renderWorkspace({ onNewNote: vi.fn(() => Promise.resolve(null)) });
    const owner = emptyPanel();
    expect(owner).toHaveAttribute("data-group", "g2");
    expect(within(owner).getByRole("button", { name: enNotes.library.newNote })).toHaveClass("bg-primary");
    expect(within(owner).getByRole("button", { name: copy.home })).toHaveClass("border-input");
  });

  it("offers only Home when notes cannot be created", () => {
    seedLayout(emptyBeside());
    renderWorkspace();
    expect(within(emptyPanel()).queryByRole("button", { name: enNotes.library.newNote })).not.toBeInTheDocument();
    expect(within(emptyPanel()).getByRole("button", { name: copy.home })).toBeInTheDocument();
  });

  it("creates a note in the empty panel", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn(() => Promise.resolve("n2"));
    seedLayout(emptyBeside());
    renderWorkspace({ onNewNote });
    await user.click(within(emptyPanel()).getByRole("button", { name: enNotes.library.newNote }));
    expect(await screen.findByRole("tab", { name: "Reading list" })).toHaveAttribute("aria-selected", "true");
    expect(onNewNote).toHaveBeenCalledOnce();
    expect(savedGroups()).toEqual([["home", "note:n1"], ["note:n2"]]);
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
  });

  it("opens a Home tab in the empty panel even while Home is open elsewhere", async () => {
    const user = userEvent.setup();
    seedLayout(emptyBeside());
    renderWorkspace();
    await user.click(within(emptyPanel()).getByRole("button", { name: copy.home }));
    expect(savedGroups()).toEqual([["home", "note:n1"], ["home:2"]]);
    expect(shownViews()).toEqual(["home:2", "note:n1"]);
  });

  it("closes an empty panel and opens notes beside Home again", async () => {
    const user = userEvent.setup();
    seedLayout(emptyBeside());
    renderWorkspace();
    await user.click(within(emptyPanel()).getByRole("button", { name: copy.closePanel }));
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(savedLayout().stage).toBe("g1");
    await user.click(screen.getByRole("button", { name: "Library note n2" }));
    expect(savedGroups()).toEqual([["home", "note:n1", "note:n2"]]);
  });

  it("hands the stage to a group with notes rather than to Artifacts", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(
        split("s1", "row", [group("g1", ["artifacts"]), group("g2", []), group("g3", ["note:n1"])]),
        { artifacts: VIEWS.artifacts, "note:n1": VIEWS["note:n1"] },
        "g2",
      ),
    );
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: copy.closePanel }));
    expect(savedLayout().stage).toBe("g3");
    await user.click(screen.getByRole("button", { name: "Library note n2" }));
    expect(savedGroups()).toEqual([["artifacts"], ["note:n1", "note:n2"]]);
  });

  it("offers no close button when the empty panel is the only one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: copy.closeTab.replace("{{title}}", copy.home) }));
    expect(screen.getByText(empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.closePanel })).not.toBeInTheDocument();
  });
});

describe("NotesWorkspace artifacts", () => {
  it("opens Artifacts at the right of the note and closes it again", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(artifactsToggle(2));
    expect(artifactsToggle(2)).toHaveAttribute("aria-pressed", "true");
    expect(artifactsToggle(2)).toHaveClass("bg-accent");
    expect(groupIdOf(tab(enNotes.artifacts.title))).not.toBe(groupIdOf(tab("Masking ablation")));
    expect(groupIdOf(artifactsToggle(2))).toBe(groupIdOf(tab(enNotes.artifacts.title)));
    expect(groupIdOf(screen.getByRole("button", { name: copy.hideSidebar }))).toBe(groupIdOf(tab("Masking ablation")));
    expect(within(panel(enNotes.artifacts.title)).getByTestId("panel-state")).toHaveTextContent("n1 none");
    expect(savedGroups()).toEqual([["home", "note:n1"], ["artifacts"]]);
    const [stage, side] = savedWeights();
    expect(stage).toBeCloseTo(0.68);
    expect(side).toBeCloseTo(0.32);
    expect(screen.getAllByRole("button", { name: copy.maximize })).toHaveLength(2);
    expect(screen.getByRole("separator", { name: copy.resize })).toBeInTheDocument();
    expect(shownViews()).toEqual(["artifacts", "note:n1"]);
    await user.click(artifactsToggle(2));
    expect(artifactsToggle(2)).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("tab", { name: enNotes.artifacts.title })).not.toBeInTheDocument();
    expect(savedGroups()).toEqual([["home", "note:n1"]]);
  });

  it("opens Artifacts beside the group of the focused note", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(split("s1", "row", [group("g1", ["home", "note:n2"], "note:n2"), group("g2", ["note:n1"])]), {
        home: VIEWS.home,
        "note:n1": VIEWS["note:n1"],
        "note:n2": VIEWS["note:n2"],
      }),
    );
    renderWorkspace();
    expect(libraryState()).toBe("n2 none");
    await user.click(tab("Masking ablation"));
    expect(libraryState()).toBe("n1 none");
    await user.click(artifactsToggle(2));
    expect(savedGroups()).toEqual([["home", "note:n2"], ["note:n1"], ["artifacts"]]);
    const weights = savedWeights();
    expect(weights[0]).toBeCloseTo(0.5);
    expect(weights[1]).toBeCloseTo(0.34);
    expect(weights[2]).toBeCloseTo(0.16);
    await user.click(artifactsToggle(2));
    await user.click(tab("Reading list"));
    await user.click(artifactsToggle(0));
    expect(savedGroups()).toEqual([["home", "note:n2"], ["artifacts"], ["note:n1"]]);
  });

  it("keeps the note area when its last tab closes beside Artifacts", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(artifactsToggle(0));
    await user.click(screen.getByRole("button", { name: copy.closeTab.replace("{{title}}", copy.home) }));
    expect(savedGroups()).toEqual([[], ["artifacts"]]);
    expect(screen.getByRole("button", { name: copy.home })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Library note n1" }));
    expect(savedGroups()).toEqual([["note:n1"], ["artifacts"]]);
    expect(groupIdOf(tab("Masking ablation"))).not.toBe(groupIdOf(tab(enNotes.artifacts.title)));
  });

  it("asks for a note when Artifacts opens with none open", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(artifactsToggle(0));
    expect(within(panel(enNotes.artifacts.title)).getByText(enNotes.artifacts.noNote)).toBeInTheDocument();
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();
    expect(savedGroups()).toEqual([["home"], ["artifacts"]]);
  });

  it("opens Artifacts once when the toggle is pressed twice before it redraws", () => {
    renderWorkspace({ initialNoteId: "n1" });
    const toggle = artifactsToggle(2);
    act(() => {
      toggle.click();
      toggle.click();
    });
    expect(screen.getAllByRole("tab", { name: enNotes.artifacts.title })).toHaveLength(1);
    expect(artifactsToggle(2)).toHaveAttribute("aria-pressed", "true");
    expect(savedGroups()).toEqual([["home", "note:n1"], ["artifacts"]]);
  });

  it("opens an artifact from the library inside the newest note about its project", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library artifact a2" }));
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
    expect(within(panel(enNotes.artifacts.title)).getByTestId("panel-state")).toHaveTextContent("n1 a2");
    expect(libraryState()).toBe("n1 a2");
    expect(savedGroups()).toEqual([["home", "note:n1"], ["artifacts"]]);
    expect(savedWeights()[1]).toBeCloseTo(0.32);
    await user.click(screen.getByRole("button", { name: "Library artifact a1" }));
    expect(screen.getByTestId("panel-state")).toHaveTextContent("n1 a1");
    expect(savedGroups()).toEqual([["home", "note:n1"], ["artifacts"]]);
    await user.click(artifactsToggle(2));
    expect(libraryState()).toBe("n1 none");
  });

  it("opens an artifact picked on Home", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(within(homePanel()).getByRole("button", { name: "Home artifact a1" }));
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("panel-state")).toHaveTextContent("n1 a1");
  });

  it("opens an artifact beside its note when another note's group comes first", async () => {
    const user = userEvent.setup();
    seedLayout(
      createLayout(split("s1", "row", [group("g1", ["home", "note:n2"]), group("g2", ["note:n1"])]), {
        home: VIEWS.home,
        "note:n1": VIEWS["note:n1"],
        "note:n2": VIEWS["note:n2"],
      }),
    );
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library artifact a1" }));
    expect(savedGroups()).toEqual([["home", "note:n2"], ["note:n1"], ["artifacts"]]);
    expect(libraryState()).toBe("n1 a1");
  });

  it("ignores an artifact that no note is about", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library artifact a3" }));
    expect(tabNames()).toEqual([copy.home]);
    expect(libraryState()).toBe("none none");
    expect(savedLayout()).toEqual(defaultNotesLayout());
  });

  it("selects another artifact in the panel", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(artifactsToggle(2));
    await user.click(screen.getByRole("button", { name: "Select a2" }));
    expect(screen.getByTestId("panel-state")).toHaveTextContent("n1 a2");
    expect(libraryState()).toBe("n1 a2");
  });

  it("inserts an artifact into its own note only", async () => {
    const user = userEvent.setup();
    const { data } = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library note n2" }));
    await user.click(screen.getByRole("button", { name: "Library note n1" }));
    await user.click(artifactsToggle(2));
    await user.click(screen.getByRole("button", { name: "Insert a1" }));
    await waitFor(() => expect(screen.getByTestId("insert-n1")).toHaveTextContent("![Loss curve](files/a1.png) #1"));
    expect(data.copyArtifact).toHaveBeenCalledWith("n1", artifacts[0]);
    expect(screen.getByTestId("insert-n2")).toHaveTextContent("none");
    await user.click(screen.getByRole("button", { name: "Insert a2" }));
    await waitFor(() => expect(screen.getByTestId("insert-n1")).toHaveTextContent("[Run table](files/a2.png) #2"));
    await user.click(tab("Reading list"));
    expect(screen.getByTestId("panel-state")).toHaveTextContent("n2 none");
    expect(screen.getByTestId("insert-n2")).toHaveTextContent("none");
    expect(screen.getByTestId("insert-n1")).toHaveTextContent("#2");
  });

  it("offers no insert when artifacts cannot be copied into notes", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" }, fakeData({ copyArtifact: undefined }));
    await user.click(artifactsToggle(2));
    expect(screen.getByRole("button", { name: "Select a1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Insert a1" })).not.toBeInTheDocument();
  });
});

describe("NotesWorkspace focus", () => {
  it("keeps the focused note while Artifacts is used", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: "Library note n3" }));
    await user.click(artifactsToggle(2));
    expect(screen.getByTestId("panel-state")).toHaveTextContent("n3 none");
    fireEvent.pointerDown(screen.getByTestId("artifact-panel"));
    await user.click(tab(enNotes.artifacts.title));
    expect(screen.getByTestId("panel-state")).toHaveTextContent("n3 none");
    expect(libraryState()).toBe("n3 none");
    await user.click(tab("Masking ablation"));
    expect(screen.getByTestId("panel-state")).toHaveTextContent("n1 none");
  });

  it("follows pointer and keyboard focus into notes in other groups", () => {
    seedLayout(
      createLayout(split("s1", "row", [group("g1", ["home", "note:n2"], "note:n2"), group("g2", ["note:n1"])]), {
        home: VIEWS.home,
        "note:n1": VIEWS["note:n1"],
        "note:n2": VIEWS["note:n2"],
      }),
    );
    renderWorkspace();
    expect(libraryState()).toBe("n2 none");
    fireEvent.pointerDown(screen.getByTestId("document-n1"));
    expect(libraryState()).toBe("n1 none");
    act(() => within(panel("Reading list")).getByRole("button", { name: "Mark saved" }).focus());
    expect(libraryState()).toBe("n2 none");
  });

  it("falls back to the active note of the focused view's group", async () => {
    seedLayout(
      createLayout(split("s1", "row", [group("g1", ["home", "note:n1"], "home"), group("g2", ["note:n2"])]), {
        home: VIEWS.home,
        "note:n1": VIEWS["note:n1"],
        "note:n2": VIEWS["note:n2"],
      }),
    );
    renderWorkspace();
    fireEvent.click(tab(copy.home));
    expect(libraryState()).toBe("n1 none");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (!this.hasAttribute("data-strip")) return box(0, 0, 0, 0);
      return groupIdOf(this as HTMLElement) === "g1" ? box(0, 0, 400, 36) : box(400, 0, 400, 36);
    });
    fireEvent.pointerDown(tab("Reading list"), { button: 0, clientX: 450, clientY: 10 });
    act(() => {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 10, bubbles: true }));
    });
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 10, bubbles: true }));
    });
    await act(async () => {});
    expect(savedGroups()).toEqual([["home", "note:n1", "note:n2"]]);
    expect(groupOfView(savedLayout(), "note:n2")?.active).toBe("note:n2");
    expect(tab(copy.home)).toHaveAttribute("aria-selected", "false");
    expect(libraryState()).toBe("n2 none");
  });

  it("falls back to the first open note once the focused note closes", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: "Library note n2" }));
    expect(libraryState()).toBe("n2 none");
    await user.click(screen.getByRole("button", { name: copy.closeTab.replace("{{title}}", "Reading list") }));
    expect(tabNames()).toEqual([copy.home, "Masking ablation"]);
    expect(libraryState()).toBe("n1 none");
  });

  it("has no focused note once every note closes", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    await user.click(screen.getByRole("button", { name: copy.closeTab.replace("{{title}}", "Masking ablation") }));
    expect(libraryState()).toBe("none none");
    expect(artifactsToggle(0)).toBeInTheDocument();
  });
});

describe("NotesWorkspace persistence", () => {
  it("saves the layout 150 ms after the last change", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderWorkspace();
    expect(storedLayout()).toBeNull();
    act(() => vi.advanceTimersByTime(149));
    expect(storedLayout()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(storedLayout()).toEqual(defaultNotesLayout());
    fireEvent.click(screen.getByRole("button", { name: "Library note n1" }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole("button", { name: "Library note n2" }));
    act(() => vi.advanceTimersByTime(100));
    expect(storedLayout()).toEqual(defaultNotesLayout());
    act(() => vi.advanceTimersByTime(50));
    expect(groupViews(storedLayout())).toEqual([["home", "note:n1", "note:n2"]]);
  });

  it("writes a pending layout at once when the page hides", () => {
    renderWorkspace();
    expect(storedLayout()).toBeNull();
    hidePage();
    expect(storedLayout()).toEqual(defaultNotesLayout());
    fireEvent.click(screen.getByRole("button", { name: "Library note n1" }));
    expect(storedLayout()).toEqual(defaultNotesLayout());
    hidePage();
    expect(groupViews(storedLayout())).toEqual([["home", "note:n1"]]);
  });

  it("writes nothing when the page hides with no change pending", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    renderWorkspace();
    act(() => vi.advanceTimersByTime(150));
    expect(storedLayout()).toEqual(defaultNotesLayout());
    localStorage.clear();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    hidePage();
    expect(setItem).not.toHaveBeenCalled();
    expect(storedLayout()).toBeNull();
  });

  it("writes a pending layout when it unmounts and restores it on the next mount", async () => {
    const user = userEvent.setup();
    const first = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Library note n1" }));
    await user.click(screen.getByRole("button", { name: "Library note n2" }));
    await user.click(artifactsToggle(0));
    await user.click(tab("Masking ablation"));
    localStorage.clear();
    first.unmount();
    expect(groupViews(storedLayout())).toEqual([["home", "note:n1", "note:n2"], ["artifacts"]]);
    expect(groupOfView(storedLayout() as WorkspaceLayout, "note:n1")?.active).toBe("note:n1");
    probe.mounts.clear();
    renderWorkspace();
    expect(tabNames()).toEqual([copy.home, "Masking ablation", "Reading list", enNotes.artifacts.title]);
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
    expect(shownViews()).toEqual(["artifacts", "note:n1"]);
    expect(artifactsToggle(2)).toHaveAttribute("aria-pressed", "true");
    expect(Object.fromEntries(probe.mounts)).toEqual({ n1: 1, n2: 1 });
  });

  it("stops listening for the page hiding once it unmounts", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { unmount } = renderWorkspace({ initialNoteId: "n1" });
    unmount();
    expect(groupViews(storedLayout())).toEqual([["home", "note:n1"]]);
    localStorage.clear();
    hidePage();
    act(() => vi.advanceTimersByTime(500));
    expect(storedLayout()).toBeNull();
  });

  it("opens the requested note into the saved layout", () => {
    seedLayout(createLayout(split("s1", "row", [group("g1", ["artifacts"]), group("g2", ["home", "note:n2"])]), {
      artifacts: VIEWS.artifacts,
      home: VIEWS.home,
      "note:n2": VIEWS["note:n2"],
    }));
    renderWorkspace({ initialNoteId: "n1" });
    expect(savedGroups()).toEqual([["artifacts"], ["home", "note:n2", "note:n1"]]);
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
    expect(libraryState()).toBe("n1 none");
  });

  it("selects the requested note when the saved layout already shows it", () => {
    seedLayout(createLayout(group("g1", ["home", "note:n1", "note:n2"], "note:n2"), {
      home: VIEWS.home,
      "note:n1": VIEWS["note:n1"],
      "note:n2": VIEWS["note:n2"],
    }));
    renderWorkspace({ initialNoteId: "n1" });
    expect(tabNames()).toEqual([copy.home, "Masking ablation", "Reading list"]);
    expect(tab("Masking ablation")).toHaveAttribute("aria-selected", "true");
  });

  it("starts on Home when the saved layout cannot be read", () => {
    localStorage.setItem(NOTES_LAYOUT_KEY, "{oops");
    renderWorkspace();
    expect(tabNames()).toEqual([copy.home]);
    expect(savedLayout()).toEqual(defaultNotesLayout());
  });
});

describe("NotesWorkspace notes", () => {
  it("opens a new note once it has been created", async () => {
    const user = userEvent.setup();
    const onNewNote = vi.fn(() => Promise.resolve("n2"));
    renderWorkspace({ onNewNote });
    await user.click(screen.getByRole("button", { name: "Library new note" }));
    expect(await screen.findByRole("tab", { name: "Reading list" })).toHaveAttribute("aria-selected", "true");
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("stays put when creating a note gives no id", async () => {
    const user = userEvent.setup();
    let finish: (id: string | null) => void = () => undefined;
    const onNewNote = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    renderWorkspace({ onNewNote });
    await user.click(screen.getByRole("button", { name: "Library new note" }));
    await act(async () => finish(null));
    expect(tabNames()).toEqual([copy.home]);
  });

  it("cannot create notes without a handler", () => {
    renderWorkspace();
    expect(screen.getByRole("button", { name: "Library new note" })).toBeDisabled();
  });

  it("starts a note from a Home prompt only when it can", async () => {
    const user = userEvent.setup();
    const onStartNote = vi.fn();
    const { unmount } = renderWorkspace({ onStartNote });
    await user.click(within(homePanel()).getByRole("button", { name: "Home start note" }));
    expect(onStartNote).toHaveBeenCalledWith("Write up run 42");
    unmount();
    renderWorkspace();
    expect(within(homePanel()).queryByRole("button", { name: "Home start note" })).not.toBeInTheDocument();
  });
});

describe("NotesWorkspace new project", () => {
  it("offers no New project without a handler", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    expect(screen.queryByRole("button", { name: copy.newProject })).not.toBeInTheDocument();
    await user.click(artifactsToggle(2));
    expect(screen.queryByRole("button", { name: "Project from a1" })).not.toBeInTheDocument();
  });

  it("creates a project from the open note", async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onCreateProject });
    await user.click(within(panel("Masking ablation")).getByRole("button", { name: copy.newProject }));
    const dialog = screen.getByRole("dialog", { name: enNotes.newProject.title });
    await user.click(within(dialog).getByRole("button", { name: enNotes.newProject.create }));
    expect(onCreateProject).toHaveBeenCalledWith({
      seed: { noteId: "n1", artifactId: null },
      name: "Masking ablation",
      format: "latex",
      files: ["n1", "a1", "a2"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("creates a project from an artifact in the panel", async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onCreateProject });
    await user.click(artifactsToggle(2));
    await user.click(screen.getByRole("button", { name: "Project from a2" }));
    const dialog = screen.getByRole("dialog", { name: enNotes.newProject.title });
    expect(within(dialog).getByRole("checkbox", { name: "Run table" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Loss curve" })).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: enNotes.newProject.create }));
    expect(onCreateProject).toHaveBeenCalledWith({
      seed: { noteId: "n1", artifactId: "a2" },
      name: "Masking ablation",
      format: "latex",
      files: ["a2"],
    });
  });

  it("closes the project dialog from Cancel without creating", async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onCreateProject });
    await user.click(within(panel("Masking ablation")).getByRole("button", { name: copy.newProject }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onCreateProject).not.toHaveBeenCalled();
  });

  it("cannot create once the handler goes away", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderWorkspace({ initialNoteId: "n1", onCreateProject: vi.fn() });
    await user.click(within(panel("Masking ablation")).getByRole("button", { name: copy.newProject }));
    rerenderWith({ initialNoteId: "n1" });
    const dialog = screen.getByRole("dialog", { name: enNotes.newProject.title });
    expect(within(dialog).getByRole("button", { name: enNotes.newProject.create })).toBeDisabled();
    expect(screen.queryByRole("button", { name: copy.newProject })).not.toBeInTheDocument();
  });
});

describe("NotesWorkspace send to paper", () => {
  it("offers no Send to paper without a handler", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1" });
    expect(screen.queryByRole("button", { name: copy.sendToPaper })).not.toBeInTheDocument();
    await user.click(within(panel("Masking ablation")).getByRole("button", { name: "Send selection" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends the note summary to the chosen paper", async () => {
    const user = userEvent.setup();
    const onSendToPaper = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onSendToPaper });
    await user.click(within(panel("Masking ablation")).getByRole("button", { name: copy.sendToPaper }));
    const dialog = screen.getByRole("dialog", { name: enNotes.sendToPaper.title });
    expect(dialog).toHaveAccessibleDescription(enNotes.sendToPaper.description);
    expect(dialog).toHaveTextContent(notes[0].summary);
    expect(within(dialog).getByRole("radio", { name: "Masking paper" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "Survey draft" }));
    await user.click(within(dialog).getByRole("button", { name: enNotes.sendToPaper.send }));
    expect(onSendToPaper).toHaveBeenCalledWith({ paperId: "paper-2", text: notes[0].summary });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("sends text handed over by the note", async () => {
    const user = userEvent.setup();
    const onSendToPaper = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onSendToPaper });
    await user.click(within(panel("Masking ablation")).getByRole("button", { name: "Send selection" }));
    const dialog = screen.getByRole("dialog", { name: enNotes.sendToPaper.title });
    expect(dialog).toHaveTextContent("Selected in Masking ablation");
    await user.click(within(dialog).getByRole("button", { name: enNotes.sendToPaper.send }));
    expect(onSendToPaper).toHaveBeenCalledWith({ paperId: "paper-1", text: "Selected in Masking ablation" });
  });

  it("closes from Cancel or Escape without sending", async () => {
    const user = userEvent.setup();
    const onSendToPaper = vi.fn();
    renderWorkspace({ initialNoteId: "n1", onSendToPaper });
    const send = within(panel("Masking ablation")).getByRole("button", { name: copy.sendToPaper });
    await user.click(send);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: enCommon.actions.cancel }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(send);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onSendToPaper).not.toHaveBeenCalled();
  });

  it("cannot send when there is no paper to send to", async () => {
    const user = userEvent.setup();
    renderWorkspace({ initialNoteId: "n1", onSendToPaper: vi.fn() }, fakeData({ papers: [] }));
    await user.click(within(panel("Masking ablation")).getByRole("button", { name: copy.sendToPaper }));
    const dialog = screen.getByRole("dialog", { name: enNotes.sendToPaper.title });
    expect(within(dialog).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: enNotes.sendToPaper.send })).toBeDisabled();
  });

  it("cannot send once the handler goes away", async () => {
    const user = userEvent.setup();
    const { rerenderWith } = renderWorkspace({ initialNoteId: "n1", onSendToPaper: vi.fn() });
    await user.click(within(panel("Masking ablation")).getByRole("button", { name: copy.sendToPaper }));
    rerenderWith({ initialNoteId: "n1" });
    const dialog = screen.getByRole("dialog", { name: enNotes.sendToPaper.title });
    expect(within(dialog).getByRole("button", { name: enNotes.sendToPaper.send })).toBeDisabled();
  });
});
