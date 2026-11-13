// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import "./tests/setup";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NOTES_PERIODIC_DEFAULTS, type NotesPeriodic } from "@/lib/notes-periodic";
import { appendToNote, type CaptureDeps, saveCapture } from "./quick-capture-save";
import { NoteConflictError, type NoteItem, type NoteSource } from "./types";

const NOW = new Date(2026, 10, 11, 8, 30);

function note(id: string, title: string, tags?: string[]): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", tags };
}

function deps(notes: NoteItem[], disk: Record<string, NoteSource> = {}, periodic: NotesPeriodic = NOTES_PERIODIC_DEFAULTS): CaptureDeps & { written: Map<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    service: {
      createNoteFrom: vi.fn(async (draft) => `created:${draft.title}`),
      loadNote: vi.fn(async (id: string) => disk[id] ?? { text: "", version: "v0" }),
      saveNote: vi.fn(async (id: string, text: string) => {
        written.set(id, text);
        return { text, version: "v1" };
      }),
    },
    notes: async () => notes,
    flush: vi.fn(async () => null),
    now: () => NOW,
    locale: "en",
    periodic,
  };
}

describe("appendToNote", () => {
  it("adds the text as a new block after the body and keeps the front matter", () => {
    const source = "---\ntitle: 2026-11-11\ntags: [daily]\n---\n\n## Plan\n\n- Write\n\n\n";
    expect(appendToNote(source, "  Call Sam  ")).toBe("---\ntitle: 2026-11-11\ntags: [daily]\n---\n\n## Plan\n\n- Write\n\nCall Sam\n");
  });

  it("starts the body when the note has only front matter", () => {
    expect(appendToNote("---\ntitle: Idea\n---\n", "First line")).toBe("---\ntitle: Idea\n---\n\nFirst line\n");
  });

  it("leaves the note alone when there is nothing to add", () => {
    expect(appendToNote("Body\n", " \n ")).toBe("Body\n");
  });

  it("writes line feeds even when the capture came with carriage returns", () => {
    expect(appendToNote("Body", "one\r\ntwo")).toBe("Body\n\none\ntwo\n");
  });
});

describe("saveCapture", () => {
  it("creates a new note titled by the first line", async () => {
    const run = deps([]);
    const id = await saveCapture({ id: "r1", text: "Grant idea\nAsk about the cluster", target: "new" }, run);
    expect(id).toBe("created:Grant idea");
    expect(run.service.createNoteFrom).toHaveBeenCalledWith({ title: "Grant idea", body: "Ask about the cluster" });
  });

  it("titles a note from the editor's Markdown without its escapes and keeps them in the body", async () => {
    const run = deps([]);
    await saveCapture({ id: "r2", text: "# Ratio a\\*b\n\nKeep \\*this\\*", target: "new" }, run);
    expect(run.service.createNoteFrom).toHaveBeenCalledWith({ title: "Ratio a*b", body: "Keep \\*this\\*" });
  });

  it("appends to today's note after flushing its open editor", async () => {
    const today = note("day", "2026-11-11", ["daily"]);
    const run = deps([today], { day: { text: "---\ntags: [daily]\n---\n\nMorning\n", version: "v0" } });
    expect(await saveCapture({ id: "r2", text: "Lunch with Ana", target: "today" }, run)).toBe("day");
    expect(run.flush).toHaveBeenCalledWith("day");
    expect(run.written.get("day")).toBe("---\ntags: [daily]\n---\n\nMorning\n\nLunch with Ana\n");
    expect(run.service.createNoteFrom).not.toHaveBeenCalled();
  });

  it("creates today's note from the daily template when there is none", async () => {
    const run = deps([note("old", "2026-11-10", ["daily"])]);
    const id = await saveCapture({ id: "r3", text: "First thing", target: "today" }, run);
    expect(id).toBe("created:2026-11-11");
    expect(run.service.createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "2026-11-11" }));
    expect(run.written.get(id)).toContain("First thing");
  });

  it("finds and creates today's note with the person's daily note settings", async () => {
    const dotted = { ...NOTES_PERIODIC_DEFAULTS, daily: { ...NOTES_PERIODIC_DEFAULTS.daily, format: "DD.MM.YYYY", template: "note:tpl" } };
    const existing = deps([note("dot", "11.11.2026", ["daily"]), note("iso", "2026-11-11", ["daily"])], {}, dotted);
    expect(await saveCapture({ id: "r5", text: "Lunch", target: "today" }, existing)).toBe("dot");
    expect(existing.service.createNoteFrom).not.toHaveBeenCalled();
    const fresh = deps([], { tpl: { text: "## Log\n", version: "v0" } }, dotted);
    expect(await saveCapture({ id: "r6", text: "Lunch", target: "today" }, fresh)).toBe("created:11.11.2026");
    expect(fresh.service.loadNote).toHaveBeenCalledWith("tpl");
    expect(fresh.service.createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "11.11.2026", body: expect.stringContaining("## Log") }));
  });

  it("creates no daily note when daily notes are turned off", async () => {
    const off = deps([], {}, { ...NOTES_PERIODIC_DEFAULTS, daily: { ...NOTES_PERIODIC_DEFAULTS.daily, enabled: false } });
    await expect(saveCapture({ id: "r7", text: "Lunch", target: "today" }, off)).rejects.toThrow(enNotes.vault.daily.failed);
    expect(off.service.createNoteFrom).not.toHaveBeenCalled();
  });

  it("reapplies the capture to the newer text when the note changed on disk", async () => {
    const run = deps([note("day", "2026-11-11", ["daily"])], { day: { text: "Old\n", version: "v0" } });
    vi.mocked(run.service.saveNote).mockRejectedValueOnce(new NoteConflictError({ text: "Old\nTyped meanwhile\n", version: "v9" }));
    await saveCapture({ id: "r4", text: "Captured", target: "today" }, run);
    expect(run.service.saveNote).toHaveBeenLastCalledWith("day", "Old\nTyped meanwhile\n\nCaptured\n", "v9");
  });
});
