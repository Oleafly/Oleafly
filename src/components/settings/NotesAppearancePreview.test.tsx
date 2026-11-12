// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };

vi.mock("@/lib/theme", () => ({
  currentTheme: () => "light",
  subscribeTheme: () => () => undefined,
}));

import { tagTone } from "@/components/notes/note-tags";
import { NOTES_APPEARANCE_DEFAULTS } from "@/lib/notes-appearance";
import { useSettingsStore } from "@/store/settings";
import { NotesAppearancePreview } from "./NotesAppearancePreview";

const copy = enNotes.notesPreview;

function root() {
  return screen.getByTestId("settings-notes-preview-root");
}

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  useSettingsStore.setState({ ...NOTES_APPEARANCE_DEFAULTS });
});

describe("Notes appearance preview", () => {
  it("shows a sample note with each kind of block the settings change", () => {
    render(<NotesAppearancePreview />);
    const preview = screen.getByRole("figure", { name: copy.label });
    expect(preview).toHaveTextContent(copy.title);
    expect(screen.getByRole("heading", { level: 2, hidden: true })).toHaveTextContent(copy.heading);
    expect(preview).toHaveTextContent(copy.paragraph);
    expect(preview.querySelector(".note-tag")).toHaveTextContent("#fieldwork");
    const tone = tagTone("fieldwork");
    expect(preview.querySelector(".note-tag")).toHaveClass(tone.tint, ...tone.text.split(" "));
    expect(preview.querySelector(".underline")).toHaveTextContent("Sampling method");
    expect(preview.querySelector("mark.note-highlight")).toHaveTextContent(copy.highlight);
    expect(preview.querySelector(".note-callout-title")).toHaveTextContent(copy.calloutTitle);
    expect(preview.querySelector(".note-callout-content > p:last-child")).toHaveTextContent(copy.calloutBody);
    expect(preview.querySelector(".note-code code")).toHaveTextContent("def mean_height(plots, unit=\"cm\"):");
    const tasks = [...preview.querySelectorAll<HTMLInputElement>(".note-task-box")];
    expect(tasks.map((task) => task.checked)).toEqual([true, false, false]);
    expect(preview).toHaveTextContent(copy.taskLate);
  });

  it("shows a date, a due today and an overdue chip drawn by the real field chip", () => {
    render(<NotesAppearancePreview />);
    const chips = [...root().querySelectorAll<HTMLElement>(".note-field")];
    expect(chips.map((chip) => [chip.dataset.fieldKey, chip.dataset.when])).toEqual([
      ["date", "future"],
      ["due", "today"],
      ["due", "past"],
    ]);
    expect(root().querySelector(".note-callout-title .note-field")).not.toBeNull();
    for (const chip of chips) expect(chip.querySelector("svg.note-field-icon")).not.toBeNull();
  });

  it("keeps the sample out of the tab order and away from screen readers", () => {
    render(<NotesAppearancePreview />);
    const sample = root().firstElementChild as HTMLElement;
    expect(sample).toHaveAttribute("aria-hidden", "true");
    expect(sample).toHaveAttribute("inert");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    for (const task of root().querySelectorAll(".note-task-box")) expect(task).toHaveAttribute("tabindex", "-1");
  });

  it("draws the sample with the current Notes settings and follows changes", () => {
    render(<NotesAppearancePreview />);
    expect(root().style.getPropertyValue("--notes-text-size")).toBe("0.9375rem");
    expect(root()).not.toHaveAttribute("data-notes-callout");
    expect(root()).not.toHaveAttribute("spellcheck");
    expect(root()).not.toHaveAttribute("data-notes-field-style");
    act(() =>
      useSettingsStore.setState({
        notesFontSize: 18,
        notesCalloutStyle: "outlined",
        notesFieldStyle: "outline",
        notesSpellcheck: false,
      }),
    );
    expect(root().style.getPropertyValue("--notes-text-size")).toBe("1.125rem");
    expect(root()).toHaveAttribute("data-notes-callout", "outlined");
    expect(root()).toHaveAttribute("data-notes-field-style", "outline");
    expect(root()).toHaveAttribute("spellcheck", "false");
    act(() => useSettingsStore.setState({ notesCalloutStyle: "tinted", notesFieldStyle: "tint" }));
    expect(root()).not.toHaveAttribute("data-notes-callout");
    expect(root()).not.toHaveAttribute("data-notes-field-style");
  });

  it("uses the Notes accent colour only when one is picked", () => {
    render(<NotesAppearancePreview />);
    expect(root().style.getPropertyValue("--notes-accent")).toBe("");
    act(() => useSettingsStore.setState({ notesAccentColor: "#ffd166" }));
    expect(root().style.getPropertyValue("--notes-accent")).toBe("#ffd166");
    expect(root().style.getPropertyValue("--notes-accent-foreground")).toBe("#111111");
    expect(root()).toHaveAttribute("data-notes-accent", "");
    act(() => useSettingsStore.setState({ notesAccentColor: "" }));
    expect(root().style.getPropertyValue("--notes-accent")).toBe("");
    expect(root()).not.toHaveAttribute("data-notes-accent");
  });
});
