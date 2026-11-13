// @vitest-environment jsdom

import type { ProjectInfo } from "@oleafly/backend-port";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import type { Editor } from "@tiptap/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { diskHash } from "@/lib/disk-hash";
import { flushOpenNotes } from "@/lib/open-note-editors";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { resetNoteWritesForTest } from "./notes-service";

const editors = vi.hoisted(() => ({ last: null as Editor | null }));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      editors.last = editor;
      return editor;
    },
  };
});
vi.mock("./NoteAssistant", async () => {
  const { forwardRef } = await import("react");
  return { NoteAssistant: forwardRef(() => null) };
});
vi.mock("./NotesWorkspace", async () => {
  const { useNotesData } = await import("./notes-data");
  const { NoteDocument } = await import("./NoteDocument");
  return {
    NotesWorkspace: () => {
      const note = useNotesData().notes.find((entry) => entry.id === "note-1");
      return note ? <NoteDocument note={note} insertRequest={null} /> : null;
    },
  };
});

import { NotesHost } from "./NotesHost";

const NOTE: ProjectInfo = {
  id: "note-1",
  name: "Masking ablation",
  kind: "note",
  main_doc: "note.md",
  created_at: 1_700_000_000,
  updated_at: 1_700_000_100,
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
};

const SOURCE = "---\ntitle: Masking ablation\nkind: note\nid: 5b2e8f1c-7a3d-4c6e-9b0a-1d2c3e4f5a6b\n---\n\nSweep over masking ratios.\n";

interface Write {
  projectId: string;
  path: string;
  content: string;
  expectedHash?: string;
}

const disk = { text: SOURCE, generation: 1, writes: [] as Write[], refuse: 0 };
const LISTS = new Set(["note_facts", "note_links", "note_tags", "acp_catalog", "list_research_tasks"]);

function crlf(text: string): string {
  return text.replace(/\n/gu, "\r\n");
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  disk.text = SOURCE;
  disk.generation = 1;
  disk.writes = [];
  disk.refuse = 0;
  mockIPC(
    (command, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>;
      if (command === "list_projects") return [NOTE];
      if (LISTS.has(command)) return [];
      if (command === "read_file") return disk.text;
      if (command === "project_mutation_generation") return disk.generation;
      if (command === "write_file") {
        disk.writes.push(args as unknown as Write);
        if (disk.refuse > 0) {
          disk.refuse -= 1;
          throw new Error("The disk is full.");
        }
        disk.text = String(args.content);
        disk.generation += 1;
        return { generation: disk.generation };
      }
      return null;
    },
    { shouldMockEvents: true },
  );
  useHomeViewStore.setState({ page: "notes" });
  useSettingsStore.setState({ notes: true });
});

afterEach(async () => {
  cleanup();
  await flushOpenNotes(10);
  clearMocks();
  resetNoteWritesForTest();
  editors.last = null;
  useFilesStore.setState({ projects: [], projectsLoaded: false });
});

async function openTheNote(): Promise<Editor> {
  render(<NotesHost />);
  await screen.findByLabelText(enNotes.document.titleLabel, undefined, { timeout: 5_000 });
  if (!editors.last) throw new Error("the note did not open");
  return editors.last;
}

function typeAtEnd(editor: Editor, text: string) {
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(text, editor.state.doc.content.size - 1));
  });
}

async function leaveTheWindow() {
  await act(async () => {
    fireEvent.blur(window);
  });
  await vi.waitFor(() => expect(disk.writes.length).toBeGreaterThan(0));
}

describe("saving a note from the editor to disk and back", () => {
  it.each([
    ["LF", SOURCE],
    ["CRLF", crlf(SOURCE)],
  ])("writes the typed text with the file's %s endings and reads it back after a restart", async (_endings, text) => {
    disk.text = text;
    const editor = await openTheNote();
    typeAtEnd(editor, " Ratio 0.6 wins.");
    await leaveTheWindow();
    const typed = SOURCE.replace("ratios.", "ratios. Ratio 0.6 wins.");
    expect(disk.writes).toEqual([
      expect.objectContaining({
        projectId: "note-1",
        path: "note.md",
        content: text === SOURCE ? typed : crlf(typed),
        expectedHash: diskHash(text),
      }),
    ]);
    cleanup();
    const reopened = await openTheNote();
    expect(reopened.state.doc.textContent).toContain("Sweep over masking ratios. Ratio 0.6 wins.");
  });

  it("warns when the write is refused and saves on Retry", async () => {
    disk.refuse = 1;
    const editor = await openTheNote();
    typeAtEnd(editor, " Ratio 0.6 wins.");
    await leaveTheWindow();
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(enNotes.saveStatus.failedWithReason.replace("{{reason}}", "The disk is full."));
    expect(disk.text).toBe(SOURCE);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enNotes.saveStatus.retry }));
    });
    await vi.waitFor(() => expect(disk.text).toContain("Ratio 0.6 wins."));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
