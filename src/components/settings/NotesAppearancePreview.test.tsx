// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

vi.mock("@/lib/theme", () => ({
  currentTheme: () => "light",
  subscribeTheme: () => () => undefined,
}));

import { NOTES_APPEARANCE_DEFAULTS } from "@/lib/notes-appearance";
import { useSettingsStore } from "@/store/settings";
import { NotesAppearancePreview } from "./NotesAppearancePreview";

const copy = enSettings.notesPreview;
const RESET = "Reset all";

function root() {
  return screen.getByTestId("settings-notes-preview-root");
}

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
    expect(preview.querySelector(".underline")).toHaveTextContent("Sampling method");
    expect(preview.querySelector("mark.note-highlight")).toHaveTextContent(copy.highlight);
    expect(preview.querySelector(".note-callout")).toHaveTextContent(`${copy.calloutTitle}${copy.calloutBody}`);
    expect(preview.querySelector(".note-code code")).toHaveTextContent("def mean_height(plots, unit=\"cm\"):");
    const tasks = [...preview.querySelectorAll<HTMLInputElement>(".note-task-box")];
    expect(tasks.map((task) => task.checked)).toEqual([true, false]);
  });

  it("keeps the sample out of the tab order and away from screen readers", () => {
    render(<NotesAppearancePreview />);
    const sample = root().firstElementChild as HTMLElement;
    expect(sample).toHaveAttribute("aria-hidden", "true");
    expect(sample).toHaveAttribute("inert");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    for (const task of root().querySelectorAll(".note-task-box")) expect(task).toHaveAttribute("tabindex", "-1");
  });

  it("shows the actions it is given above the sample", () => {
    const { rerender } = render(<NotesAppearancePreview />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<NotesAppearancePreview actions={<button type="button">{RESET}</button>} />);
    expect(screen.getByRole("button", { name: RESET })).toBeInTheDocument();
  });

  it("draws the sample with the current Notes settings and follows changes", () => {
    render(<NotesAppearancePreview />);
    expect(root().style.getPropertyValue("--notes-text-size")).toBe("0.9375rem");
    expect(root()).not.toHaveAttribute("data-notes-callout");
    expect(root()).not.toHaveAttribute("spellcheck");
    act(() =>
      useSettingsStore.setState({ notesFontSize: 18, notesCalloutStyle: "outlined", notesHighlightColor: "green", notesSpellcheck: false }),
    );
    expect(root().style.getPropertyValue("--notes-text-size")).toBe("1.125rem");
    expect(root()).toHaveAttribute("data-notes-callout", "outlined");
    expect(root()).toHaveAttribute("data-notes-highlight", "green");
    expect(root()).toHaveAttribute("spellcheck", "false");
    act(() => useSettingsStore.setState({ notesCalloutStyle: "tinted" }));
    expect(root()).not.toHaveAttribute("data-notes-callout");
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
