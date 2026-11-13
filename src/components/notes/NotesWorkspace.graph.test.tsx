// @vitest-environment jsdom

import { groupsOf, type WorkspaceLayout } from "@oleafly/workspace";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { NoteGraph as NoteGraphComponent } from "./NoteGraph";
import type { NoteExportDialog as ExportComponent, NoteImportDialog as ImportComponent } from "./NoteImportDialog";
import type { NoteOutline as NoteOutlineComponent } from "./NoteOutline";
import type { NotesLibrary as NotesLibraryComponent } from "./NotesLibrary";
import type { NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const graphCopy = enNotes.graph;
const label = vi.hoisted(() => ({
  library: "Library",
  open1: "Open n1",
  open2: "Open n2",
  graph: "Library graph",
  importFolder: "Library import",
  exportFolder: "Library export",
  heading: "Outline heading",
  finishImport: "Finish import",
  closeImport: "Close import",
  closeExport: "Close export",
  importDialog: "Import stand-in",
  exportDialog: "Export stand-in",
}));

vi.mock("./NoteDocument", () => ({
  NoteDocument: ({ note }: { note: NoteItem }) => <div data-testid={`document-${note.id}`} />,
}));

vi.mock("./NotesHome", () => ({ NotesHome: () => <section data-testid="home" /> }));

vi.mock("./NotesLibrary", () => ({
  NotesLibrary: function LibraryStandIn({ onOpenNote, onOpenGraph, onImportFolder, onExportFolder }: Parameters<typeof NotesLibraryComponent>[0]) {
    return (
      <aside aria-label={label.library}>
        <button type="button" onClick={() => onOpenNote("n1")}>
          {label.open1}
        </button>
        <button type="button" onClick={() => onOpenNote("n2")}>
          {label.open2}
        </button>
        <button type="button" onClick={onOpenGraph}>
          {label.graph}
        </button>
        <button type="button" onClick={onImportFolder}>
          {label.importFolder}
        </button>
        <button type="button" onClick={onExportFolder}>
          {label.exportFolder}
        </button>
      </aside>
    );
  },
}));

vi.mock("./NoteGraph", () => ({
  NoteGraph: function GraphStandIn({ mode, centerId, activeId, onOpenNote, onOpenProject }: Parameters<typeof NoteGraphComponent>[0]) {
    return (
      <section data-testid={`graph-${mode}`}>
        <output>{`${centerId ?? "none"} ${activeId ?? "none"}`}</output>
        <button type="button" onClick={() => onOpenNote("n3", { newTab: false })}>
          {`${mode} open n3`}
        </button>
        <button type="button" onClick={() => onOpenNote("n2", { newTab: true })}>
          {`${mode} new tab n2`}
        </button>
        <button type="button" onClick={() => onOpenProject?.("p1")}>
          {`${mode} project`}
        </button>
      </section>
    );
  },
}));

vi.mock("./NoteOutline", () => ({
  NoteOutline: function OutlineStandIn({ noteId, onOpenHeading }: Parameters<typeof NoteOutlineComponent>[0]) {
    return (
      <section data-testid="outline">
        <output>{noteId ?? "none"}</output>
        <button type="button" onClick={() => noteId && onOpenHeading(noteId, "methods")}>
          {label.heading}
        </button>
      </section>
    );
  },
}));

vi.mock("./NoteImportDialog", () => ({
  NoteImportDialog: function ImportStandIn({ open, onClose, onImported }: Parameters<typeof ImportComponent>[0]) {
    return open ? (
      <div role="dialog" aria-label={label.importDialog}>
        <button type="button" onClick={onImported}>
          {label.finishImport}
        </button>
        <button type="button" onClick={onClose}>
          {label.closeImport}
        </button>
      </div>
    ) : null;
  },
  NoteExportDialog: function ExportStandIn({ note, total, onClose }: Parameters<typeof ExportComponent>[0]) {
    return (
      <div role="dialog" aria-label={label.exportDialog}>
        <output>{`${note?.id ?? "none"} ${total}`}</output>
        <button type="button" onClick={onClose}>
          {label.closeExport}
        </button>
      </div>
    );
  },
}));

import { NotesDataProvider, type NotesData } from "./notes-data";
import { NOTES_LAYOUT_KEY } from "./notes-layout";
import { NotesWorkspace } from "./NotesWorkspace";

const notes: NoteItem[] = ["n1", "n2", "n3"].map((id) => ({
  id,
  title: `Note ${id}`,
  project: "Vision",
  updatedAt: 0,
  author: "you",
  summary: "",
}));

function fakeData(overrides: Partial<NotesData> = {}): NotesData {
  return fakeNotesData({
    notes,
    openProject: vi.fn(),
    refreshNotes: vi.fn(() => Promise.resolve()),
    ...overrides,
  });
}

function renderWorkspace(data: NotesData = fakeData()) {
  render(
    <NotesDataProvider value={data}>
      <NotesWorkspace />
    </NotesDataProvider>,
  );
  return data;
}

function savedGroups(): string[][] {
  window.dispatchEvent(new Event("pagehide"));
  const layout = JSON.parse(localStorage.getItem(NOTES_LAYOUT_KEY) ?? "null") as WorkspaceLayout | null;
  return layout ? groupsOf(layout.root).map((candidate) => candidate.views) : [];
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotesWorkspace graph, outline and vault views", () => {
  it("opens the graph from the sidebar and opens notes from it", async () => {
    const user = userEvent.setup();
    const data = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Open n1" }));
    await user.click(screen.getByRole("button", { name: "Library graph" }));
    expect(screen.getByRole("tab", { name: graphCopy.title })).toHaveAttribute("aria-selected", "true");
    const graph = await screen.findByTestId("graph-global");
    await user.click(within(graph).getByRole("button", { name: "global project" }));
    expect(data.openProject).toHaveBeenCalledWith("p1");
    await user.click(within(graph).getByRole("button", { name: "global new tab n2" }));
    expect(screen.getByRole("tab", { name: "Note n2" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: graphCopy.title }));
    await user.click(within(await screen.findByTestId("graph-global")).getByRole("button", { name: "global open n3" }));
    expect(screen.getByRole("tab", { name: "Note n3" })).toHaveAttribute("aria-selected", "true");
    expect(savedGroups()).toEqual([["home", "note:n1", "graph", "note:n2", "note:n3"]]);
  });

  it("toggles the outline and the local graph beside the open note", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Open n1" }));
    await user.click(screen.getByRole("button", { name: graphCopy.showOutline }));
    expect(screen.getByRole("button", { name: graphCopy.hideOutline })).toHaveAttribute("aria-pressed", "true");
    const outline = await screen.findByTestId("outline");
    expect(outline).toHaveTextContent("n1");
    await user.click(screen.getByRole("tab", { name: graphCopy.outline.title }));
    await user.click(within(outline).getByRole("button", { name: "Outline heading" }));
    await user.click(screen.getByRole("button", { name: graphCopy.showLocal }));
    expect(screen.getByRole("tab", { name: graphCopy.localTitle })).toBeInTheDocument();
    const local = await screen.findByTestId("graph-local");
    expect(local).toHaveTextContent("n1 n1");
    await user.click(within(local).getByRole("button", { name: "local open n3" }));
    await waitFor(() => expect(screen.getByTestId("graph-local")).toHaveTextContent("n3 n3"));
    expect(savedGroups()).toEqual([["home", "note:n3"], ["outline", "local-graph"]]);
    await user.click(screen.getByRole("button", { name: graphCopy.hideLocal }));
    await user.click(screen.getByRole("button", { name: graphCopy.hideOutline }));
    expect(savedGroups()).toEqual([["home", "note:n3"]]);
  });

  it("answers the graph and outline shortcuts", async () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Open n2" }));
    fireEvent.keyDown(window, { code: "KeyG", key: "G", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("tab", { name: graphCopy.title })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: "KeyM", key: "M", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { code: "KeyK", key: "K", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("tab", { name: graphCopy.localTitle })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: graphCopy.outline.title })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: "KeyK", key: "K", shiftKey: true });
    fireEvent.keyDown(window, { code: "KeyG", key: "g" });
    const blocked = new KeyboardEvent("keydown", { code: "KeyK", key: "K", shiftKey: true, ctrlKey: true, cancelable: true });
    blocked.preventDefault();
    act(() => void window.dispatchEvent(blocked));
    expect(screen.getByRole("tab", { name: graphCopy.outline.title })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: "KeyK", key: "K", ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole("tab", { name: graphCopy.outline.title })).not.toBeInTheDocument();
  });

  it("leaves AltGr characters alone, so Ctrl+Alt typing on Windows layouts still types", () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Open n2" }));
    const altGrG = new KeyboardEvent("keydown", { code: "KeyG", key: "]", ctrlKey: true, altKey: true, cancelable: true });
    const altGrO = new KeyboardEvent("keydown", { code: "KeyO", key: "ó", ctrlKey: true, altKey: true, cancelable: true });
    act(() => {
      window.dispatchEvent(altGrG);
      window.dispatchEvent(altGrO);
    });
    expect(altGrG.defaultPrevented).toBe(false);
    expect(altGrO.defaultPrevented).toBe(false);
    expect(screen.queryByRole("tab", { name: graphCopy.localTitle })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: graphCopy.outline.title })).not.toBeInTheDocument();
  });

  it("opens the import and export dialogs from the sidebar", async () => {
    const user = userEvent.setup();
    const data = renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Open n2" }));
    await user.click(screen.getByRole("button", { name: "Library import" }));
    await user.click(screen.getByRole("button", { name: "Finish import" }));
    expect(data.refreshNotes).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Close import" }));
    expect(screen.queryByRole("dialog", { name: "Import stand-in" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Library export" }));
    expect(screen.getByRole("dialog", { name: "Export stand-in" })).toHaveTextContent("n2 3");
    await user.click(screen.getByRole("button", { name: "Close export" }));
    expect(screen.queryByRole("dialog", { name: "Export stand-in" })).not.toBeInTheDocument();
  });

  it("restores saved graph views and shows the outline without a note", async () => {
    localStorage.setItem(
      NOTES_LAYOUT_KEY,
      JSON.stringify({
        schema: 1,
        root: { kind: "group", id: "g1", views: ["graph", "outline"], active: "outline" },
        views: { graph: { type: "graph" }, outline: { type: "outline" } },
        maximized: null,
      }),
    );
    renderWorkspace(fakeData({ refreshNotes: undefined }));
    expect(await screen.findByTestId("outline")).toHaveTextContent("none");
    expect(screen.getByRole("tab", { name: graphCopy.title })).toBeInTheDocument();
  });
});
