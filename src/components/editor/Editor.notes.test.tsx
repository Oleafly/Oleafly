// @vitest-environment jsdom

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { useNoteTabsStore } from "@/store/note-tabs";
import { useSettingsStore } from "@/store/settings";
import { useZenStore } from "@/store/zen";

const views = vi.hoisted(() => ({ crash: false }));

vi.mock("@/components/notes/NoteTabView", () => ({
  ProjectNoteTab: ({ projectId, path }: { projectId: string; path: string }) => {
    if (views.crash) throw new Error("note view crashed");
    return <div data-testid="project-note-view">{`${projectId}:${path}`}</div>;
  },
  PersonalNoteTab: ({ projectId, noteId }: { projectId: string; noteId: string }) => (
    <div data-testid="personal-note-view">{`${projectId}:${noteId}`}</div>
  ),
}));
vi.mock("./CodeMirrorEditor", () => ({ CodeMirrorEditor: () => <div data-testid="codemirror" /> }));
vi.mock("./diff/DiffView", () => ({ DiffView: () => <div data-testid="diff-view" /> }));
vi.mock("./SelectionActionMenu", () => ({ SelectionActionMenu: () => null }));
vi.mock("./ProofreadingNotifications", () => ({
  ProofreadingNotifications: () => <div data-testid="proofreading" />,
}));
vi.mock("./MarkdownToolbar", () => ({ MarkdownToolbar: () => <div data-testid="markdown-toolbar" /> }));
vi.mock("./MarkdownPreview", () => ({ MarkdownPreview: () => null }));
vi.mock("./EditorContextMenu", () => ({
  EditorContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./wysiwyg/WysiwygEditor", () => ({ WysiwygEditor: () => <div data-testid="wysiwyg" /> }));
vi.mock("@/components/layout/WorkspaceControls", () => ({ SidebarCollapseToggle: () => null }));
vi.mock("@/components/collab/CollabSlots", () => ({ CollabRemovedFileSlot: () => null }));

import { Editor } from "./Editor";

const NOTE = "---\ntitle: Lab plan\nkind: note\n---\n\nBody\n";

function seed(path = "notes/Plan.md", content = NOTE) {
  useSettingsStore.setState({ notes: true });
  useZenStore.setState({ active: false });
  useFilesStore.setState({
    projectId: "paper",
    projectKind: "document",
    projects: [],
    files: { [path]: { content, dirty: false } },
    openTabs: [path],
    tabOrder: { [path]: 1 },
    assistantTabs: [],
    activePath: path,
    changedOnDisk: [],
  });
  useDiffStore.setState({ diffs: [], activeKey: null });
  useNoteTabsStore.setState({ tabs: [], active: null, markdown: {} });
}

beforeEach(() => {
  views.crash = false;
  seed();
});

describe("note views in the project editor", () => {
  it("shows the Notes editor for a Markdown file that declares a note", async () => {
    render(<Editor />);
    expect(await screen.findByTestId("project-note-view")).toHaveTextContent("paper:notes/Plan.md");
    expect(screen.queryByTestId("codemirror")).toBeNull();
    expect(screen.queryByTestId("markdown-toolbar")).toBeNull();
    expect(screen.queryByTestId("proofreading")).toBeNull();
  });

  it("uses the Markdown editor when the person chose it, Notes is off, or the file is not a note", () => {
    useNoteTabsStore.getState().setMarkdown("paper", "notes/Plan.md", true);
    const { unmount } = render(<Editor />);
    expect(screen.getByTestId("codemirror")).toBeInTheDocument();
    expect(screen.queryByTestId("project-note-view")).toBeNull();
    unmount();

    seed();
    useSettingsStore.setState({ notes: false });
    const second = render(<Editor />);
    expect(screen.queryByTestId("project-note-view")).toBeNull();
    second.unmount();

    seed("notes/Plain.md", "# Plain\n");
    const third = render(<Editor />);
    expect(screen.queryByTestId("project-note-view")).toBeNull();
    third.unmount();

    seed();
    useFilesStore.setState({ projectKind: "note" });
    render(<Editor />);
    expect(screen.queryByTestId("project-note-view")).toBeNull();
  });

  it("shows a focused personal note tab over the open file", async () => {
    useNoteTabsStore.getState().open("paper", "mine");
    render(<Editor />);
    expect(await screen.findByTestId("personal-note-view")).toHaveTextContent("paper:mine");
    expect(screen.queryByTestId("project-note-view")).toBeNull();
  });

  it("ignores a focused note tab while Notes is off", () => {
    useNoteTabsStore.getState().open("paper", "mine");
    useSettingsStore.setState({ notes: false });
    render(<Editor />);
    expect(screen.queryByTestId("personal-note-view")).toBeNull();
  });

  it("keeps the editor running when a note view crashes", async () => {
    views.crash = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Editor />);
    expect(await screen.findByTestId("surface-error-boundary")).toBeInTheDocument();
  });
});
