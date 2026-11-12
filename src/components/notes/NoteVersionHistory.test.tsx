// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CheckpointSummary, ProjectInfo } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import NoteVersionHistory from "./NoteVersionHistory";
import { NotesDataProvider } from "./notes-data";
import { noteWrittenHere, recordNoteWrite, resetNoteWritesForTest } from "./notes-service";
import type { NoteItem, NoteSource } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const checkpoints = vi.hoisted(() => ({
  checkpointList: vi.fn(),
  checkpointStats: vi.fn(),
  checkpointSave: vi.fn(),
  checkpointReadText: vi.fn(),
  checkpointRestore: vi.fn(),
}));
vi.mock("@/lib/checkpoints", () => ({ ...checkpoints, checkpointEngineLabel: (engine: string) => engine }));

const toasts = vi.hoisted(() => ({ success: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { success: toasts.success }, notifyError: toasts.notifyError }));

vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: (props: { oldText: string; newText: string; ariaLabel: string }) => (
    <section aria-label={props.ariaLabel} data-old={props.oldText} data-new={props.newText} />
  ),
}));

const NOTE: NoteItem = { id: "note-1", title: "Assay plan", project: "", updatedAt: 0, author: "you", summary: "" };
const CURRENT = "# Assay plan\n\nRewritten by the agent.\n";
const EARLIER = "# Assay plan\n\nMy own first draft.\n";
const VERSION: CheckpointSummary = {
  snapshot_root: "root-1111111111111111111111111111111111",
  completed_at_unix_ms: 1_777_000_000_000,
  engine: "markdown",
  toolchain_identity: "markdown",
  main_document: "note.md",
  output_hash: "hash",
  file_count: 1,
  logical_bytes: EARLIER.length,
  label: null,
};

function open() {
  const order: string[] = [];
  const loadNote = vi.fn(async (): Promise<NoteSource> => ({ text: CURRENT, version: "v1" }));
  const saveNote = vi.fn((id: string, text: string) => {
    order.push("write");
    return recordNoteWrite(id, text, async () => ({ text, version: "v2" }));
  });
  checkpoints.checkpointSave.mockImplementation(async () => {
    order.push("save");
    return { status: "published", snapshot_root: VERSION.snapshot_root, created: true };
  });
  const onClose = vi.fn();
  render(
    <NotesDataProvider value={fakeNotesData({ notes: [NOTE], loadNote, saveNote })}>
      <NoteVersionHistory note={NOTE} onClose={onClose} />
    </NotesDataProvider>,
  );
  return { order, saveNote, onClose };
}

beforeAll(async () => {
  await loadNamespace("editor");
});

beforeEach(() => {
  useFilesStore.setState({ projects: [{ id: NOTE.id, kind: "note", main_doc: "note.md" } as ProjectInfo] });
  checkpoints.checkpointStats.mockResolvedValue({ checkpoint_count: 0, stored_pack_bytes: 0, logical_bytes: 0, reclaimable_bytes: 0 });
  checkpoints.checkpointReadText.mockResolvedValue(EARLIER);
});

afterEach(() => {
  vi.clearAllMocks();
  resetNoteWritesForTest();
  useFilesStore.setState({ projects: [] });
});

describe("NoteVersionHistory", () => {
  it("lists the note's version after Save a version", async () => {
    checkpoints.checkpointList.mockResolvedValueOnce([]).mockResolvedValue([VERSION]);
    open();
    expect(await screen.findByText(enNotes.versions.empty)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: enNotes.versions.save }));
    });
    expect(checkpoints.checkpointSave).toHaveBeenCalledWith(NOTE.id);
    expect(toasts.success).toHaveBeenCalledWith(enNotes.versions.saved);
    expect(await screen.findByRole("button", { name: enEditor.checkpoints.entry.restoreFor.replace("{{version}}", "V1") })).toBeInTheDocument();
  });

  it("shows what restoring changes and writes the version through the note's own write path", async () => {
    checkpoints.checkpointList.mockResolvedValue([VERSION]);
    const { order, saveNote, onClose } = open();
    fireEvent.click(await screen.findByRole("button", { name: enEditor.checkpoints.entry.restoreFor.replace("{{version}}", "V1") }));
    const changes = await screen.findByRole("region", { name: enNotes.versions.changes });
    expect(changes).toHaveAttribute("data-old", CURRENT);
    expect(changes).toHaveAttribute("data-new", EARLIER);
    expect(checkpoints.checkpointReadText).toHaveBeenCalledWith(NOTE.id, VERSION.snapshot_root, "note.md");

    fireEvent.click(screen.getByRole("button", { name: enNotes.versions.restore }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(order).toEqual(["save", "write"]);
    expect(saveNote).toHaveBeenCalledWith(NOTE.id, EARLIER, "v1");
    expect(noteWrittenHere(NOTE.id, EARLIER)).toBe(true);
    expect(checkpoints.checkpointRestore).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith(enNotes.versions.restored);
  });

  it("leaves the note alone when its current text cannot be kept as a version first", async () => {
    checkpoints.checkpointList.mockResolvedValue([VERSION]);
    const { saveNote, onClose } = open();
    checkpoints.checkpointSave.mockResolvedValue({ status: "failed" });
    fireEvent.click(await screen.findByRole("button", { name: enEditor.checkpoints.entry.restoreFor.replace("{{version}}", "V1") }));
    fireEvent.click(await screen.findByRole("button", { name: enNotes.versions.restore }));
    await waitFor(() => expect(toasts.notifyError).toHaveBeenCalled());
    expect(saveNote).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
