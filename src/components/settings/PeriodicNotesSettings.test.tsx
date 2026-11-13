// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NOTES_PERIODIC_DEFAULTS, NOTES_PERIODIC_KEY } from "@/lib/notes-periodic";
import { useSettingsStore } from "@/store/settings";
import { NotesDataProvider } from "@/components/notes/notes-data";
import { fakeNotesData } from "@/components/notes/tests/notes-data-fixture";
import "@/components/notes/tests/setup";
import { PeriodicNotesSettings } from "./PeriodicNotesSettings";

const copy = enNotes.periodic;

function row(kind: "daily" | "weekly" | "monthly"): HTMLElement {
  return screen.getByTestId(`settings-row-notes-periodic-${kind}`);
}

beforeEach(() => {
  for (const kind of ["daily", "weekly", "monthly"] as const) useSettingsStore.getState().setNotesPeriodic(kind, NOTES_PERIODIC_DEFAULTS[kind]);
});

describe("periodic notes settings", () => {
  it("shows each kind with a preview of its next title", () => {
    render(<PeriodicNotesSettings />);
    expect(within(row("daily")).getByLabelText(copy.format)).toHaveProperty("value", "YYYY-MM-DD");
    expect(within(row("weekly")).getByText(/^Example: \d{4}-W\d{2}$/u)).toBeTruthy();
    expect(within(row("monthly")).getByLabelText(copy.tag)).toHaveProperty("value", "monthly");
  });

  it("saves a new format when the field loses focus, and refuses one without a date part", () => {
    render(<PeriodicNotesSettings />);
    const field = within(row("daily")).getByLabelText(copy.format);
    fireEvent.change(field, { target: { value: "[Journal]" } });
    expect(within(row("daily")).getByText(copy.invalidFormat)).toBeTruthy();
    fireEvent.blur(field);
    expect(useSettingsStore.getState().notesPeriodic.daily.format).toBe("YYYY-MM-DD");
    fireEvent.change(field, { target: { value: "DD.MM.YYYY" } });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.blur(field);
    expect(useSettingsStore.getState().notesPeriodic.daily.format).toBe("DD.MM.YYYY");
    expect(JSON.parse(localStorage.getItem(NOTES_PERIODIC_KEY) ?? "{}").daily.format).toBe("DD.MM.YYYY");
  });

  it("cleans the tag and turns a kind off", async () => {
    const user = userEvent.setup();
    render(<PeriodicNotesSettings />);
    const tag = within(row("weekly")).getByLabelText(copy.tag);
    fireEvent.change(tag, { target: { value: "#review" } });
    fireEvent.blur(tag);
    expect(useSettingsStore.getState().notesPeriodic.weekly.tag).toBe("review");
    await user.click(within(row("weekly")).getByRole("switch", { name: copy.weekly.label }));
    expect(useSettingsStore.getState().notesPeriodic.weekly.enabled).toBe(false);
    expect(within(row("weekly")).queryByLabelText(copy.format)).toBeNull();
  });

  it("picks the day weeks start on, defaulting to the language's", async () => {
    const user = userEvent.setup();
    render(<PeriodicNotesSettings />);
    const select = within(screen.getByTestId("settings-row-notes-week-start")).getByRole("combobox", { name: copy.weekStart.label });
    expect(select.textContent).toMatch(/^Region default \((Sunday|Monday)\)$/u);
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: copy.weekStart.saturday }));
    expect(useSettingsStore.getState().notesPeriodic.weekStart).toBe("saturday");
    useSettingsStore.getState().setNotesWeekStart("locale");
  });

  it("offers your template notes next to the built-in ones", async () => {
    const user = userEvent.setup();
    const notes = [{ id: "tpl", title: "My week", project: "Notes", updatedAt: 0, author: "you" as const, summary: "", properties: { template: true } }];
    render(
      <NotesDataProvider value={fakeNotesData({ notes })}>
        <PeriodicNotesSettings />
      </NotesDataProvider>,
    );
    await user.click(within(row("monthly")).getByLabelText(copy.template));
    await user.click(await screen.findByRole("option", { name: "My week" }));
    expect(useSettingsStore.getState().notesPeriodic.monthly.template).toBe("note:tpl");
  });
});
