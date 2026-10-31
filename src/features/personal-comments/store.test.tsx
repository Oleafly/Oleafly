// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath, setEditorView } from "@oleafly/editor";
import { commentsEditorSlot } from "@/components/editor/cm/comments-slot";
import { useCommentsRail, requestComment } from "@/components/collab/comments-rail";
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { projectLeaveAllowed } from "@/lib/project-leave-guards";
import { flushPersonalComments } from "@/lib/personal-comments-flush";
import { commentSpansIn } from "@/features/collab/comments/editor-comments";
import { PersonalCommentsPane } from "./PersonalComments";
import {
  changePersonalComment,
  createPersonalComment,
  flushNotes,
  startPersonalComments,
  usePersonalComments,
} from "./store";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  moved: null as null | ((event: { projectId: string; from: string; to: string }) => void),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof import("@tauri-apps/api/core")>()),
  invoke: mocks.invoke,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: "paper",
      activePath: "main.typ",
      files: {},
      openFile: vi.fn(async () => {}),
    })),
    onPathsMoved: (listener: typeof mocks.moved) => {
      mocks.moved = listener;
      return () => {
        mocks.moved = null;
      };
    },
    onPathsDeleted: () => () => {},
  };
});

let stop: (() => void) | undefined;
let view: EditorView;
let saved: unknown;
let revision: number;
const text = "= Introduction\nRewrite this paragraph.";

beforeAll(async () => {
  await loadNamespace("collab");
});
beforeEach(() => {
  saved = { version: 1, files: [] };
  revision = 0;
  mocks.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === "personal_comments_load") return { revision, data: structuredClone(saved) };
    if (command === "personal_comments_save") {
      saved = structuredClone(args.data);
      return ++revision;
    }
    return undefined;
  });
  useFilesStore.setState({
    projectId: "paper",
    activePath: "main.typ",
    files: { "main.typ": { content: text, dirty: false } },
  });
  useCommentsRail.setState({ visible: false, canCompose: false, request: null, reveal: null });
  usePersonalComments.setState({ showResolved: false });
  view = new EditorView({
    state: EditorState.create({
      doc: text,
      selection: { anchor: 15, head: text.length },
      extensions: [
        commentsEditorSlot(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            useFilesStore.setState({
              files: { "main.typ": { content: update.state.doc.toString(), dirty: true } },
            });
        }),
      ],
    }),
    parent: document.body,
  });
  setEditorView(view);
  setEditorDocumentPath("main.typ");
});
afterEach(async () => {
  mocks.invoke.mockImplementation(async () => ++revision);
  stop?.();
  stop = undefined;
  await Promise.resolve();
  view.destroy();
  setEditorView(null);
  setEditorDocumentPath(null);
});

async function start() {
  stop = startPersonalComments();
  await waitFor(() => expect(usePersonalComments.getState().phase).toBe("ready"));
}
async function create() {
  expect(requestComment(view)).toBe(true);
  await createPersonalComment("TODO: add evidence");
  return usePersonalComments.getState().data.files[0].notes[0];
}

describe("personal comments without a server", () => {
  it("persists, remaps, edits, resolves, reopens and deletes notes", async () => {
    await start();
    const note = await create();
    expect(view.state.doc.toString()).toBe(text);
    view.dispatch({ changes: { from: 0, insert: "// a new heading\n" } });
    await flushPersonalComments();
    let range = usePersonalComments.getState().data.files[0].notes[0].range;
    expect(view.state.doc.sliceString(range?.from ?? 0, range?.to)).toBe(note.quote);
    await changePersonalComment(note.id, { body: "Revised todo", resolved: true });
    await changePersonalComment(note.id, { resolved: false });
    stop?.();
    await start();
    expect(usePersonalComments.getState().data.files[0].notes[0]).toMatchObject({
      body: "Revised todo",
      resolved: false,
    });
    await waitFor(() => expect(commentSpansIn(view.state)).toHaveLength(1));
    range = commentSpansIn(view.state)[0];
    view.dispatch({ changes: { from: range.from, to: range.to } });
    await flushNotes();
    expect(usePersonalComments.getState().data.files[0].notes[0].range).toBeNull();
    await changePersonalComment(note.id, null);
    expect(usePersonalComments.getState().data.files).toEqual([]);
  });

  it("keeps an unsaved note visible and blocks leaving until retry succeeds", async () => {
    await start();
    mocks.invoke.mockRejectedValue(new Error("disk full"));
    await create();
    expect(usePersonalComments.getState().saveError).toBe(true);
    expect(await projectLeaveAllowed({ projectId: "paper", reason: "close", targetProjectId: null })).toBe(
      false,
    );
    mocks.invoke.mockResolvedValue(1);
    await flushPersonalComments();
    expect(usePersonalComments.getState().saveError).toBe(false);
    expect(await projectLeaveAllowed({ projectId: "paper", reason: "close", targetProjectId: null })).toBe(
      true,
    );
  });

  it("preserves notes when the source file or folder is renamed", async () => {
    await start();
    await create();
    mocks.moved?.({ projectId: "paper", from: "main.typ", to: "draft.typ" });
    await flushNotes();
    expect(usePersonalComments.getState().data.files[0].path).toBe("draft.typ");
  });

  it("merges a concurrent window's notes before retrying a stale save", async () => {
    await start();
    let rejected = false;
    mocks.invoke.mockImplementation(async (command) => {
      if (command === "personal_comments_save") {
        if (!rejected) {
          rejected = true;
          throw new Error("[personal_comments_conflict]");
        }
        return 2;
      }
      return { revision: 1, data: { version: 1, files: [{ path: "main.typ", text, notes: [{
        id: "other-window", body: "Check this later", quote: "Rewrite", range: { from: 15, to: 22 }, resolved: false,
      }] }] } };
    });
    await create();
    const notes = usePersonalComments.getState().data.files[0].notes;
    expect(notes.map((note) => note.body)).toEqual(["TODO: add evidence", "Check this later"]);
    expect(usePersonalComments.getState().saveError).toBe(false);
  });

  it("switches to an empty project without leaking the previous project's notes", async () => {
    await start(); await create();
    mocks.invoke.mockImplementation(async (command) => command === "personal_comments_load"
      ? { revision: 0, data: { version: 1, files: [] } } : 1);
    useFilesStore.setState({ projectId: "another-paper", activePath: "other.typ", files: {} });
    await waitFor(() => expect(usePersonalComments.getState().phase).toBe("ready"));
    expect(usePersonalComments.getState().projectId).toBe("another-paper");
    expect(usePersonalComments.getState().data.files).toEqual([]);
  });

  it("never replaces corrupt saved comments with empty data", async () => {
    saved = { version: 12 };
    stop = startPersonalComments();
    await waitFor(() => expect(usePersonalComments.getState().phase).toBe("failed"));
    expect(useCommentsRail.getState().canCompose).toBe(false);
    await flushNotes();
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "personal_comments_save")).toHaveLength(
      0,
    );
  });

  it("offers editing and the resolved filter in the local pane", async () => {
    await start();
    await create();
    render(<PersonalCommentsPane />);
    expect(screen.getByText("TODO: add evidence")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    });
    expect(screen.queryByText("TODO: add evidence")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show resolved comments" }));
    expect(screen.getByText("TODO: add evidence")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Edit comment" })).toHaveValue("TODO: add evidence");
  });
});
