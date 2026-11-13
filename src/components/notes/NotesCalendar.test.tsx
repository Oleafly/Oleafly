// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import shell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { NOTES_PERIODIC_DEFAULTS } from "@/lib/notes-periodic";
import { appQueryClient } from "@/lib/query";
import { useSettingsStore } from "@/store/settings";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";
import { NotesCalendar } from "./NotesCalendar";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const copy = enNotes.calendar;

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const today = new Date();
const thisMonth = iso(today).slice(0, 7);
const tenth = new Date(today.getFullYear(), today.getMonth(), 10);
const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

function monthName(date: Date): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

function note(id: string, title: string, tags?: string[]): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", tags };
}

function show(overrides: Partial<NotesData> = {}) {
  const onOpenNote = vi.fn();
  const data = fakeNotesData({
    notes: [note("day", iso(tenth), ["daily"]), note("month", thisMonth, ["monthly"])],
    revision: 1,
    createNoteFrom: vi.fn(async () => "created"),
    noteTasks: () => Promise.resolve(dueOn(12)),
    ...overrides,
  });
  const view = render(
    <NotesDataProvider value={data}>
      <NotesCalendar onOpenNote={onOpenNote} />
    </NotesDataProvider>,
  );
  const rerender = (next: NotesData) =>
    view.rerender(
      <NotesDataProvider value={next}>
        <NotesCalendar onOpenNote={onOpenNote} />
      </NotesDataProvider>,
    );
  return { onOpenNote, data, rerender };
}

function dueOn(day: number) {
  return [{ projectId: "day", tasks: [{ line: 0, checked: false, text: `Ship [due:: ${iso(new Date(today.getFullYear(), today.getMonth(), day))}]` }] }];
}

function dayButton(day: number): HTMLElement {
  const label = new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(new Date(today.getFullYear(), today.getMonth(), day));
  return screen.getByRole("button", { name: new RegExp(`^${label}`, "u") });
}

beforeEach(() => {
  for (const kind of ["daily", "weekly", "monthly"] as const) useSettingsStore.getState().setNotesPeriodic(kind, NOTES_PERIODIC_DEFAULTS[kind]);
  useSettingsStore.getState().setNotesWeekStart(NOTES_PERIODIC_DEFAULTS.weekStart);
});

afterEach(() => {
  appQueryClient().clear();
});

describe("the notes calendar", () => {
  it("marks days with a daily note and days with tasks due", async () => {
    show();
    expect(dayButton(10).getAttribute("aria-label")).toContain(copy.hasNote);
    expect(dayButton(10).querySelector('[data-mark="note"]')).not.toBeNull();
    await waitFor(() => expect(dayButton(12).getAttribute("aria-label")).toContain("1 task due"));
    expect(dayButton(12).querySelector('[data-mark="due"]')).not.toBeNull();
    expect(dayButton(11).querySelector("[data-mark]")).toBeNull();
  });

  it("shows a new due date once the task revision moves, on a day that already has a daily note too", async () => {
    let day = 12;
    const noteTasks = vi.fn(() => Promise.resolve(dueOn(day)));
    const { data, rerender } = show({ taskRevision: 1, noteTasks });
    await waitFor(() => expect(dayButton(12).querySelector('[data-mark="due"]')).not.toBeNull());
    day = 10;
    rerender({ ...data });
    expect(dayButton(10).querySelector('[data-mark="due"]')).toBeNull();
    rerender({ ...data, taskRevision: 2 });
    await waitFor(() => expect(dayButton(10).querySelector('[data-mark="due"]')).not.toBeNull());
    expect(dayButton(10).querySelector('[data-mark="note"]')).not.toBeNull();
    expect(dayButton(10).getAttribute("aria-label")).toContain(copy.hasNote);
    expect(dayButton(12).querySelector("[data-mark]")).toBeNull();
    expect(noteTasks).toHaveBeenCalledTimes(2);
  });

  it("opens a day's note, or creates it", async () => {
    const { onOpenNote, data } = show();
    fireEvent.click(dayButton(10));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith("day"));
    fireEvent.click(dayButton(11));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith("created"));
    expect(data.createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: iso(new Date(today.getFullYear(), today.getMonth(), 11)) }));
  });

  it("opens the monthly note from the month picker and a weekly note from its number", async () => {
    const { onOpenNote, data } = show();
    fireEvent.click(screen.getByRole("button", { name: monthName(today) }));
    expect(screen.queryByRole("button", { name: copy.createMonthNote })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.openMonthNote }));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith("month"));
    expect(screen.queryByRole("dialog", { name: shell.monthPicker.label })).toBeNull();
    const week = document.querySelector<HTMLButtonElement>("[data-week]");
    fireEvent.click(week as HTMLButtonElement);
    await waitFor(() => expect(data.createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/^\d{4}-W\d{2}$/u) })));
  });

  it("creates this month's note from the picker when there is none yet", async () => {
    const { onOpenNote, data } = show({ notes: [note("day", iso(tenth), ["daily"])] });
    fireEvent.click(screen.getByRole("button", { name: monthName(today) }));
    expect(screen.queryByRole("button", { name: copy.openMonthNote })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.createMonthNote }));
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledWith("created"));
    expect(data.createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: thisMonth }));
  });

  it("only opens existing notes for a kind that is switched off", () => {
    useSettingsStore.getState().setNotesPeriodic("daily", { enabled: false });
    useSettingsStore.getState().setNotesPeriodic("weekly", { enabled: false });
    useSettingsStore.getState().setNotesPeriodic("monthly", { enabled: false });
    show();
    expect(dayButton(10).hasAttribute("disabled")).toBe(false);
    expect(dayButton(11).hasAttribute("disabled")).toBe(true);
    expect(document.querySelector("[data-week]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: monthName(today) }));
    expect(screen.getByRole("button", { name: copy.openMonthNote })).toBeTruthy();
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /next month/iu }));
    fireEvent.click(screen.getByRole("button", { name: monthName(nextMonth) }));
    expect(screen.queryByRole("button", { name: copy.openMonthNote })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.createMonthNote })).toBeNull();
  });

  it("starts the grid on the chosen day and numbers weeks to match", () => {
    useSettingsStore.getState().setNotesWeekStart("sunday");
    show();
    const headers = [...document.querySelectorAll("[data-notes-calendar] th[scope=col]")].map((cell) => cell.getAttribute("aria-label"));
    expect(headers.slice(1, 3)).toEqual(["Sunday", "Monday"]);
    const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-week]")];
    expect(rows[0].closest("tr")?.querySelectorAll("td")[0].querySelector("button")?.getAttribute("aria-label")).toMatch(/^Sunday/u);
    useSettingsStore.getState().setNotesWeekStart("locale");
  });

  it("moves between months and back to this one", () => {
    show();
    expect(screen.queryByRole("button", { name: copy.today })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /next month/iu }));
    expect(screen.getByRole("button", { name: monthName(nextMonth) })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.today }));
    expect(screen.queryByRole("button", { name: copy.today })).toBeNull();
    expect(screen.getByRole("button", { name: monthName(today) })).toBeTruthy();
  });

  it("fills today with the primary colour and keeps its marks visible on it", async () => {
    show({ notes: [note("day", iso(today), ["daily"])], noteTasks: () => Promise.resolve(dueOn(today.getDate())) });
    const day = dayButton(today.getDate());
    expect(day.className).toContain("bg-primary");
    expect(day.className).toContain("text-primary-foreground");
    expect(day.className).not.toContain("hover:bg-accent");
    expect(day.closest("td")?.className.split(" ")).not.toContain("bg-accent");
    expect(day.querySelector('[data-mark="note"]')?.className).toContain("bg-primary-foreground");
    await waitFor(() => expect(dayButton(today.getDate()).querySelector('[data-mark="due"]')?.className).toContain("border-primary-foreground"));
    const other = dayButton(today.getDate() === 1 ? 2 : 1);
    expect(other.className).not.toContain("bg-primary");
  });

  it("has no legend under the grid, the day labels carry the marks", () => {
    show();
    const calendar = document.querySelector("[data-notes-calendar]") as HTMLElement;
    expect(calendar.textContent).not.toContain("Daily note");
    expect(calendar.textContent).not.toContain("Tasks due");
    expect(calendar.querySelectorAll(":scope > :not([data-calendar-today])")).toHaveLength(1);
  });

  it("keeps room for Today on the current month so changing months doesn't move the grid", () => {
    show();
    const row = document.querySelector("[data-notes-calendar] > [data-calendar-today]") as HTMLElement;
    expect(row.className).toContain("h-5");
    expect(within(row).queryByRole("button", { name: copy.today })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /next month/iu }));
    expect(document.querySelector("[data-notes-calendar] > [data-calendar-today]")).toBe(row);
    fireEvent.click(within(row).getByRole("button", { name: copy.today }));
    expect(within(row).queryByRole("button", { name: copy.today })).toBeNull();
  });

  it("jumps to a month in another year from the caption and back with Today", () => {
    show();
    const lastYear = today.getFullYear() - 1;
    fireEvent.click(screen.getByRole("button", { name: monthName(today) }));
    const picker = screen.getByRole("dialog", { name: shell.monthPicker.label });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(monthName(today));
    fireEvent.click(within(picker).getByRole("button", { name: shell.monthPicker.previousYear }));
    expect(within(picker).getByText(String(lastYear))).toBeTruthy();
    const march = new Date(lastYear, 2, 1);
    fireEvent.click(within(picker).getByRole("button", { name: monthName(march) }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: monthName(march) })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(`^${new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(new Date(lastYear, 2, 15))}`, "u") })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: monthName(march) }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: copy.today }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: monthName(today) })).toBeTruthy();
  });

  it("closes the month picker with Escape and leaves the month alone", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: monthName(today) }));
    fireEvent.click(screen.getByRole("button", { name: shell.monthPicker.nextYear }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: monthName(today) })).toBeTruthy();
  });
});
