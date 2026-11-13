// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useToastStore } from "@/store/toast";
import { dailyNeighbors, dailyNoteId, findDailyNote, periodicNoteId, useDailyNeighbors, useOpenDailyNote, useOpenPeriodicNote } from "./daily-note";
import { NOTES_PERIODIC_DEFAULTS, type NotesPeriodic } from "@/lib/notes-periodic";
import { useSettingsStore } from "@/store/settings";
import { localDate } from "./note-templates";
import { NotesDataProvider, type NotesData } from "./notes-data";
import "./tests/setup";
import { fakeNotesData } from "./tests/notes-data-fixture";
import type { NoteItem } from "./types";

const NOW = new Date(2026, 10, 8, 9, 5);

function note(id: string, title: string, tags?: string[]): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", tags };
}

function wrapper(value: NotesData) {
  return ({ children }: { children: ReactNode }) => createElement(NotesDataProvider, { value, children });
}

afterEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe("dailyNeighbors", () => {
  const days = [
    note("d9", "2026-11-09", ["daily"]),
    note("d5", "2026-11-05", ["daily"]),
    note("d7", "2026-11-07", ["daily"]),
    note("d6", "2026-11-06", ["daily"]),
    note("plain", "2026-11-08"),
    note("idea", "Idea", ["daily"]),
  ];

  it.each([
    ["d7", "d6", "d9"],
    ["d5", undefined, "d6"],
    ["d9", "d7", undefined],
  ])("finds the daily notes on either side of %s, skipping missing days and notes without the tag", (id, previous, next) => {
    const found = dailyNeighbors(days, id);
    expect(found?.previous?.id).toBe(previous);
    expect(found?.next?.id).toBe(next);
  });

  it.each([["plain"], ["idea"], ["missing"]])("offers nothing for %s, which is not a dated daily note", (id) => {
    expect(dailyNeighbors(days, id)).toBeNull();
  });

  it("offers nothing for a lone daily note", () => {
    expect(dailyNeighbors([note("d7", "2026-11-07", ["daily"])], "d7")).toBeNull();
  });
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
    const { result } = renderHook(() => useOpenDailyNote(onOpen), { wrapper: wrapper(fakeNotesData({ createNoteFrom })) });
    await act(async () => result.current?.());
    expect(onOpen).toHaveBeenCalledWith("created");
  });

  it("opens an existing note without a way to create one", async () => {
    const onOpen = vi.fn();
    const today = note("today", localDate(new Date()));
    const { result } = renderHook(() => useOpenDailyNote(onOpen), { wrapper: wrapper(fakeNotesData({ notes: [today] })) });
    await act(async () => result.current?.());
    expect(onOpen).toHaveBeenCalledWith("today");
  });

  it("is unavailable when it can neither find nor create the note", () => {
    const { result } = renderHook(() => useOpenDailyNote(vi.fn()), { wrapper: wrapper(fakeNotesData()) });
    expect(result.current).toBeUndefined();
  });

  it("says so when creating fails", async () => {
    const onOpen = vi.fn();
    const createNoteFrom = vi.fn(async () => Promise.reject(new Error("disk full")));
    const { result } = renderHook(() => useOpenDailyNote(onOpen), { wrapper: wrapper(fakeNotesData({ createNoteFrom })) });
    act(() => result.current?.());
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(enNotes.vault.daily.failed),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("weekly, monthly and configured notes", () => {
  const custom: NotesPeriodic = {
    daily: { enabled: true, format: "dddd, D MMMM YYYY", template: "", tag: "journal" },
    weekly: { enabled: true, format: "[Week] W, GGGG", template: "note:tpl", tag: "" },
    monthly: { enabled: false, format: "MMMM YYYY", template: "builtin:meeting", tag: "monthly" },
    weekStart: "monday",
  };
  const iso: NotesPeriodic = { ...NOTES_PERIODIC_DEFAULTS, weekStart: "monday" };

  beforeEach(() => {
    useSettingsStore.getState().setNotesWeekStart("monday");
  });

  afterEach(() => {
    useSettingsStore.getState().setNotesPeriodic("daily", NOTES_PERIODIC_DEFAULTS.daily);
    useSettingsStore.getState().setNotesWeekStart(NOTES_PERIODIC_DEFAULTS.weekStart);
  });

  it("creates the weekly note from the weekly template, dated from Monday", async () => {
    const createNoteFrom = vi.fn(async () => "week");
    await expect(periodicNoteId({ notes: [], createNoteFrom }, "weekly", NOW, iso, "en")).resolves.toBe("week");
    expect(createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "2026-W45", properties: "tags: [weekly]\nweek-of: 2026-11-02" }));
  });

  it("starts the week on Sunday where the language does, and numbers it from there", async () => {
    const createNoteFrom = vi.fn(async () => "week");
    await periodicNoteId({ notes: [], createNoteFrom }, "weekly", NOW, NOTES_PERIODIC_DEFAULTS, "en-US");
    expect(createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "2026-W46", properties: "tags: [weekly]\nweek-of: 2026-11-08" }));
    await periodicNoteId({ notes: [], createNoteFrom }, "weekly", NOW, NOTES_PERIODIC_DEFAULTS, "de-DE");
    expect(createNoteFrom).toHaveBeenLastCalledWith(expect.objectContaining({ title: "2026-W45", properties: "tags: [weekly]\nweek-of: 2026-11-02" }));
  });

  it("creates a blank monthly note with its tag", async () => {
    const createNoteFrom = vi.fn(async () => "month");
    await periodicNoteId({ notes: [], createNoteFrom }, "monthly", NOW, NOTES_PERIODIC_DEFAULTS, "en");
    expect(createNoteFrom).toHaveBeenCalledWith({ title: "2026-11", body: "", properties: "", tags: ["monthly"] });
  });

  it("finds an existing note by its configured title and tag", async () => {
    const notes = [note("plain", "Sunday, 8 November 2026"), note("tagged", "Sunday, 8 November 2026", ["Journal"])];
    await expect(periodicNoteId({ notes, createNoteFrom: vi.fn() }, "daily", NOW, custom, "en")).resolves.toBe("tagged");
  });

  it("fills a weekly note from one of your template notes", async () => {
    const createNoteFrom = vi.fn(async () => "week");
    const loadNote = vi.fn(async () => ({ text: "---\ntitle: Week template\ntemplate: true\nkind: note\nid: x\n---\n\nWeek of {{date}}", version: "v" }));
    await periodicNoteId({ notes: [], createNoteFrom, loadNote }, "weekly", NOW, custom, "en");
    expect(loadNote).toHaveBeenCalledWith("tpl");
    expect(createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "Week 45, 2026", body: "\nWeek of 2026-11-02" }));
  });

  it("adds the configured tag to a template's own tags", async () => {
    const createNoteFrom = vi.fn(async () => "day");
    await periodicNoteId({ notes: [], createNoteFrom }, "daily", NOW, { ...custom, daily: { ...custom.daily, template: "builtin:daily" } }, "en");
    expect(createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "Sunday, 8 November 2026", properties: "date: 2026-11-08", tags: ["journal", "daily"] }));
  });

  it("opens but never creates a kind that is switched off", async () => {
    const createNoteFrom = vi.fn();
    await expect(periodicNoteId({ notes: [], createNoteFrom }, "monthly", NOW, custom, "en")).resolves.toBeNull();
    await expect(periodicNoteId({ notes: [note("m", "November 2026", ["monthly"])], createNoteFrom }, "monthly", NOW, custom, "en")).resolves.toBe("m");
    expect(createNoteFrom).not.toHaveBeenCalled();
  });

  it("steps between daily notes with a configured title", () => {
    const days = [note("a", "Friday, 6 November 2026", ["journal"]), note("b", "Sunday, 8 November 2026", ["journal"]), note("c", "Monday, 9 November 2026")];
    expect(dailyNeighbors(days, "b", custom, "en")).toEqual({ previous: days[0], next: undefined });
  });

  it("uses the saved settings to open a week", async () => {
    const onOpen = vi.fn();
    const createNoteFrom = vi.fn(async () => "week");
    const { result } = renderHook(() => useOpenPeriodicNote(onOpen), { wrapper: wrapper(fakeNotesData({ createNoteFrom })) });
    await act(async () => result.current("weekly", NOW));
    expect(onOpen).toHaveBeenCalledWith("week");
    expect(createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "2026-W45" }));
  });

  it("finds the neighbours of an open daily note from the saved settings", () => {
    const days = [note("d5", "2026-11-05", ["daily"]), note("d7", "2026-11-07", ["daily"])];
    const { result } = renderHook(() => useDailyNeighbors("d7"), { wrapper: wrapper(fakeNotesData({ notes: days })) });
    expect(result.current?.previous?.id).toBe("d5");
  });

  it("says so when a weekly note cannot be created", async () => {
    const createNoteFrom = vi.fn(async () => Promise.reject(new Error("disk full")));
    const { result } = renderHook(() => useOpenPeriodicNote(vi.fn()), { wrapper: wrapper(fakeNotesData({ createNoteFrom })) });
    act(() => result.current("weekly", NOW));
    await waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(enNotes.calendar.failed.weekly));
  });

  it("hides Today's note when daily notes are off and today has none", () => {
    useSettingsStore.getState().setNotesPeriodic("daily", { enabled: false });
    const { result } = renderHook(() => useOpenDailyNote(vi.fn()), { wrapper: wrapper(fakeNotesData({ createNoteFrom: vi.fn() })) });
    expect(result.current).toBeUndefined();
  });
});
