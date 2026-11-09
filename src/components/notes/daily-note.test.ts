// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useToastStore } from "@/store/toast";
import { dailyNoteId, findDailyNote, useOpenDailyNote } from "./daily-note";
import { localDate } from "./note-templates";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const NOW = new Date(2026, 10, 8, 9, 5);

function note(id: string, title: string, tags?: string[]): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", tags };
}

function data(overrides: Partial<NotesData>): NotesData {
  return {
    notes: [],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    ...overrides,
  };
}

function wrapper(value: NotesData) {
  return ({ children }: { children: ReactNode }) => createElement(NotesDataProvider, { value, children });
}

beforeAll(async () => {
  await loadNamespace("notes");
});

afterEach(() => {
  vi.useRealTimers();
  useToastStore.setState({ toasts: [] });
});

describe("findDailyNote", () => {
  it("prefers the note titled with today's date that carries the daily tag", () => {
    const notes = [note("plain", "2026-11-08"), note("daily", "2026-11-08", ["Daily"]), note("other", "2026-11-07", ["daily"])];
    expect(findDailyNote(notes, NOW)?.id).toBe("daily");
    expect(findDailyNote([note("plain", "2026-11-08")], NOW)?.id).toBe("plain");
    expect(findDailyNote(notes.slice(2), NOW)).toBeUndefined();
  });
});

describe("dailyNoteId", () => {
  it("returns today's note when it exists", async () => {
    const createNoteFrom = vi.fn();
    await expect(dailyNoteId({ notes: [note("d", "2026-11-08")], createNoteFrom }, NOW, "en")).resolves.toBe("d");
    expect(createNoteFrom).not.toHaveBeenCalled();
  });

  it("creates it once from the daily template, even when asked twice", async () => {
    let finish: (id: string) => void = () => {};
    const createNoteFrom = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const first = dailyNoteId({ notes: [], createNoteFrom }, NOW, "en");
    const second = dailyNoteId({ notes: [], createNoteFrom }, NOW, "en");
    finish("new");
    await expect(first).resolves.toBe("new");
    await expect(second).resolves.toBe("new");
    expect(createNoteFrom).toHaveBeenCalledTimes(1);
    expect(createNoteFrom).toHaveBeenCalledWith(
      expect.objectContaining({ title: "2026-11-08", properties: "tags: [daily]\ndate: 2026-11-08" }),
    );
    createNoteFrom.mockResolvedValueOnce("again");
    await expect(dailyNoteId({ notes: [], createNoteFrom }, NOW, "en")).resolves.toBe("again");
  });

  it("gives up without a way to create notes", async () => {
    await expect(dailyNoteId({ notes: [] }, NOW, "en")).resolves.toBeNull();
  });
});

describe("useOpenDailyNote", () => {
  it("opens or creates today's note", async () => {
    const onOpen = vi.fn();
    const createNoteFrom = vi.fn(async () => "created");
    const { result } = renderHook(() => useOpenDailyNote(onOpen), { wrapper: wrapper(data({ createNoteFrom })) });
    await act(async () => result.current?.());
    expect(onOpen).toHaveBeenCalledWith("created");
  });

  it("opens an existing note without a way to create one", async () => {
    const onOpen = vi.fn();
    const today = note("today", localDate(new Date()));
    const { result } = renderHook(() => useOpenDailyNote(onOpen), { wrapper: wrapper(data({ notes: [today] })) });
    await act(async () => result.current?.());
    expect(onOpen).toHaveBeenCalledWith("today");
  });

  it("is unavailable when it can neither find nor create the note", () => {
    const { result } = renderHook(() => useOpenDailyNote(vi.fn()), { wrapper: wrapper(data({})) });
    expect(result.current).toBeUndefined();
  });

  it("says so when creating fails", async () => {
    const onOpen = vi.fn();
    const createNoteFrom = vi.fn(async () => Promise.reject(new Error("disk full")));
    const { result } = renderHook(() => useOpenDailyNote(onOpen), { wrapper: wrapper(data({ createNoteFrom })) });
    act(() => result.current?.());
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(enNotes.vault.daily.failed),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
});
