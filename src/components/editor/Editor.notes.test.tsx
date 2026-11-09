// @vitest-environment jsdom

import { useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { useNoteTabsStore } from "@/store/note-tabs";
import { useSettingsStore } from "@/store/settings";
import { useZenStore } from "@/store/zen";

const views = vi.hoisted(() => ({ crash: false, mounts: [] as string[] }));

function useMounted(name: string) {
  useEffect(() => {
    views.mounts.push(name);
  }, [name]);
}

vi.mock("@/components/notes/NoteTabView", () => ({
  ProjectNoteTab: ({ projectId, path, shown }: { projectId: string; path: string; shown?: boolean }) => {
    if (views.crash) throw new Error("note view crashed");
    useMounted(`${projectId}:${path}`);
    return (
      <div data-testid="project-note-view" data-shown={String(shown)}>
        {`${projectId}:${path}`}
      </div>
    );
  },
  PersonalNoteTab: ({ projectId, noteId, shown }: { projectId: string; noteId: string; shown?: boolean }) => {
    useMounted(`${projectId}:${noteId}`);
    return (
      <div data-testid="personal-note-view" data-shown={String(shown)}>
        {`${projectId}:${noteId}`}
      </div>
    );
  },
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
import { registerNoteEditor } from "@/lib/open-note-editors";
import { noteEditorHandle } from "@/lib/tests/open-note-editor-fixtures";

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
  views.mounts = [];
  seed();
});

function personalShown(): string[] {
  return screen
    .queryAllByTestId("personal-note-view")
    .filter((view) => view.closest("[hidden]") === null)
    .map((view) => view.textContent ?? "");
}

function personalMounted(): string[] {
  return screen.queryAllByTestId("personal-note-view").map((view) => view.textContent ?? "");
}

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

  it("offers a way back to the note editor while a note is edited as Markdown", async () => {
    useNoteTabsStore.getState().setMarkdown("paper", "notes/Plan.md", true);
    render(<Editor />);
    const banner = screen.getByTestId("note-markdown-banner");
    expect(banner).toHaveTextContent(enEditor.shell.noteAsMarkdown);
    fireEvent.click(screen.getByRole("button", { name: enEditor.shell.editAsNote }));
    expect(await screen.findByTestId("project-note-view")).toBeInTheDocument();
    expect(screen.queryByTestId("note-markdown-banner")).toBeNull();
  });

  it("shows no Markdown banner for plain Markdown files or while Notes is off", () => {
    seed("notes/Plain.md", "# Plain\n");
    useNoteTabsStore.getState().setMarkdown("paper", "notes/Plain.md", true);
    const { unmount } = render(<Editor />);
    expect(screen.queryByTestId("note-markdown-banner")).toBeNull();
    unmount();
    seed();
    useNoteTabsStore.getState().setMarkdown("paper", "notes/Plan.md", true);
    useSettingsStore.setState({ notes: false });
    render(<Editor />);
    expect(screen.queryByTestId("note-markdown-banner")).toBeNull();
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

  it("keeps a note tab's editor alive while another tab is shown and shows it again as it was", async () => {
    useNoteTabsStore.getState().open("paper", "mine");
    render(<Editor />);
    expect(await screen.findByTestId("personal-note-view")).toHaveAttribute("data-shown", "true");
    act(() => useNoteTabsStore.getState().clearActive());
    expect(await screen.findByTestId("project-note-view")).toHaveAttribute("data-shown", "true");
    expect(screen.getByTestId("personal-note-view")).toHaveAttribute("data-shown", "false");
    expect(personalShown()).toEqual([]);
    act(() => useNoteTabsStore.getState().setActive("mine"));
    expect(personalShown()).toEqual(["paper:mine"]);
    expect(screen.getByTestId("project-note-view")).toHaveAttribute("data-shown", "false");
    expect(views.mounts).toEqual(["paper:mine", "paper:notes/Plan.md"]);
  });

  it("lets a note tab go once it closes", async () => {
    useNoteTabsStore.getState().open("paper", "mine");
    render(<Editor />);
    await screen.findByTestId("personal-note-view");
    act(() => useNoteTabsStore.getState().clearActive());
    await screen.findByTestId("project-note-view");
    act(() => useNoteTabsStore.getState().close("mine"));
    expect(personalMounted()).toEqual([]);
  });

  it("keeps the last three hidden note tabs and lets older ones go", async () => {
    render(<Editor />);
    for (const id of ["a", "b", "c", "d", "e"]) {
      act(() => useNoteTabsStore.getState().open("paper", id));
      await screen.findByText(`paper:${id}`);
    }
    expect(personalShown()).toEqual(["paper:e"]);
    expect(personalMounted().sort()).toEqual(["paper:b", "paper:c", "paper:d", "paper:e"]);
    expect(screen.queryByTestId("project-note-view")).toBeNull();
    act(() => useNoteTabsStore.getState().setActive("a"));
    await screen.findByText("paper:a");
    expect(personalMounted().sort()).toEqual(["paper:a", "paper:c", "paper:d", "paper:e"]);
  });

  it("keeps a hidden note tab with an unsaved change past the limit", async () => {
    let unsaved = true;
    const stop = registerNoteEditor("a", noteEditorHandle({ busy: () => unsaved }));
    try {
      render(<Editor />);
      for (const id of ["a", "b", "c", "d", "e"]) {
        act(() => useNoteTabsStore.getState().open("paper", id));
        await screen.findByText(`paper:${id}`);
      }
      expect(personalMounted().sort()).toEqual(["paper:a", "paper:b", "paper:c", "paper:d", "paper:e"]);
      unsaved = false;
      act(() => useNoteTabsStore.getState().setActive("b"));
      expect(personalMounted().sort()).toEqual(["paper:b", "paper:c", "paper:d", "paper:e"]);
    } finally {
      stop();
    }
  });

  it("lets a hidden project note go when its file is edited as Markdown or the project closes", async () => {
    render(<Editor />);
    await screen.findByTestId("project-note-view");
    act(() => useNoteTabsStore.getState().open("paper", "mine"));
    await screen.findByTestId("personal-note-view");
    expect(screen.getByTestId("project-note-view")).toHaveAttribute("data-shown", "false");
    act(() => useNoteTabsStore.getState().setMarkdown("paper", "notes/Plan.md", true));
    expect(screen.queryByTestId("project-note-view")).toBeNull();
    act(() => useFilesStore.setState({ projectId: "other" }));
    expect(personalMounted()).toEqual([]);
  });

  it("keeps the editor running when a note view crashes", async () => {
    views.crash = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Editor />);
    expect(await screen.findByTestId("surface-error-boundary")).toBeInTheDocument();
  });
});
