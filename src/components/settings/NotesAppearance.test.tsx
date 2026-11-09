// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@/lib/theme", () => ({
  currentTheme: () => "light",
  subscribeTheme: () => () => undefined,
}));

import { NOTES_APPEARANCE_DEFAULTS, NOTES_TYPEFACE_STACKS } from "@/lib/notes-appearance";
import { readNoteWidth } from "@/components/notes/note-prefs";
import { ACCENTS, useSettingsStore } from "@/store/settings";
import { NotesAppearanceTab } from "./NotesAppearance";

const notes = enSettings.appearance.notes;
const reset = (setting: string) => notes.resetAriaLabel.replace("{{setting}}", setting);

function previewRoot() {
  return screen.getByTestId("settings-notes-preview-root");
}

function variable(name: string) {
  return previewRoot().style.getPropertyValue(name);
}

async function pick(user: ReturnType<typeof userEvent.setup>, trigger: string, option: string) {
  await user.click(screen.getByTestId(trigger));
  await user.click(await screen.findByRole("option", { name: option }));
}

beforeEach(() => {
  localStorage.clear();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  useSettingsStore.setState({ ...NOTES_APPEARANCE_DEFAULTS, accentColor: ACCENTS[0].color });
});

describe("Notes appearance tab", () => {
  it("shows a labelled preview that starts with the plain Notes look", () => {
    render(<NotesAppearanceTab />);
    expect(screen.getByRole("figure", { name: enSettings.notesPreview.label })).toBeInTheDocument();
    expect(variable("--notes-text-size")).toBe("0.9375rem");
    expect(variable("--notes-title-size")).toBe("1.5rem");
    expect(previewRoot()).not.toHaveAttribute("spellcheck");
    expect(screen.queryByTestId("settings-notes-reset-all")).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^Reset .* to default$/ })).toEqual([]);
    for (const title of [notes.text.title, notes.headings.title, notes.layout.title, notes.code.title, notes.colors.title]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
  });

  it("picks typefaces from cards that show each one, and resets a card group", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    const serif = screen.getByTestId("settings-notes-typeface-serif");
    expect(serif.querySelector("span")).toHaveStyle({ fontFamily: NOTES_TYPEFACE_STACKS.serif });
    await user.click(serif);
    expect(serif).toHaveAttribute("aria-pressed", "true");
    expect(useSettingsStore.getState().notesTypeface).toBe("serif");
    expect(variable("--notes-text-font")).toBe(NOTES_TYPEFACE_STACKS.serif);

    const sameAsText = screen.getByTestId("settings-notes-heading-typeface-text");
    expect(sameAsText.querySelector("span")).toHaveStyle({ fontFamily: NOTES_TYPEFACE_STACKS.serif });
    await user.click(screen.getByTestId("settings-notes-heading-typeface-mono"));
    expect(variable("--notes-heading-font")).toBe("var(--font-mono)");

    await user.click(screen.getByRole("button", { name: reset(notes.typeface.label) }));
    expect(useSettingsStore.getState().notesTypeface).toBe("sans");
    expect(screen.queryByRole("button", { name: reset(notes.typeface.label) })).toBeNull();
    await user.click(screen.getByRole("button", { name: reset(notes.headingTypeface.label) }));
    expect(useSettingsStore.getState().notesHeadingTypeface).toBe("text");
  });

  it("sets the text size from the list or as a custom number", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    await pick(user, "settings-notes-font-size-trigger", "18px");
    expect(useSettingsStore.getState().notesFontSize).toBe(18);
    expect(variable("--notes-text-size")).toBe("1.125rem");

    await pick(user, "settings-notes-font-size-trigger", notes.fontSize.custom);
    const custom = screen.getByRole("spinbutton", { name: notes.fontSize.customLabel });
    fireEvent.change(custom, { target: { value: "21" } });
    expect(useSettingsStore.getState().notesFontSize).toBe(21);

    await user.click(screen.getByRole("button", { name: reset(notes.fontSize.label) }));
    expect(useSettingsStore.getState().notesFontSize).toBe(15);
    expect(screen.queryByRole("spinbutton", { name: notes.fontSize.customLabel })).toBeNull();
    expect(screen.getByTestId("settings-notes-font-size-trigger")).toHaveTextContent("15px");
  });

  it("shows a custom size it was given even when no list size matches", () => {
    useSettingsStore.setState({ notesFontSize: 19.5 });
    render(<NotesAppearanceTab />);
    expect(screen.getByRole("spinbutton", { name: notes.fontSize.customLabel })).toHaveValue(19.5);
  });

  it("sets a custom line height and resets both parts of it", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    await pick(user, "settings-notes-line-height-trigger", enSettings.appearance.editor.lineHeight.options.custom);
    const custom = screen.getByRole("spinbutton", { name: notes.lineHeight.customLabel });
    expect(custom).toHaveValue(1.7);
    fireEvent.change(custom, { target: { value: "2.2" } });
    expect(variable("--notes-line-height")).toBe("2.2");
    await user.click(screen.getByRole("button", { name: reset(notes.lineHeight.label) }));
    expect(useSettingsStore.getState()).toMatchObject({ notesLineHeight: "normal", notesCustomLineHeight: 1.7 });
  });

  it("sets spacing, heading size, title size and code colors from their lists", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ editorThemeLight: "paper" });
    render(<NotesAppearanceTab />);
    await pick(user, "settings-row-notes-paragraph-spacing-trigger", notes.paragraphSpacing.options.relaxed);
    await pick(user, "settings-row-notes-heading-size-trigger", notes.headingSize.options.large);
    await pick(user, "settings-row-notes-title-size-trigger", "32px");
    await pick(user, "settings-row-notes-code-theme-trigger", notes.codeTheme.options.editor);
    expect(useSettingsStore.getState()).toMatchObject({
      notesParagraphSpacing: "relaxed",
      notesHeadingSize: "large",
      notesTitleSize: 32,
      notesCodeTheme: "editor",
    });
    expect(variable("--notes-block-gap")).toBe("1.1em");
    expect(variable("--notes-h1")).toBe("1.8em");
    expect(variable("--notes-title-size")).toBe("2rem");
    await pick(user, "settings-row-notes-code-theme-trigger", "Dracula");
    expect(useSettingsStore.getState().notesCodeTheme).toBe("dracula");
    await pick(user, "settings-row-notes-code-theme-trigger", enCore.themes.matchApp);
    expect(useSettingsStore.getState().notesCodeTheme).toBe("system");
    await user.click(screen.getByRole("button", { name: reset(notes.titleSize.label) }));
    expect(useSettingsStore.getState().notesTitleSize).toBe(24);
  });

  it("changes the same width the note toolbar uses", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    await user.click(screen.getByTestId("settings-notes-width-full"));
    expect(readNoteWidth()).toBe("full");
    act(() => useSettingsStore.getState().setNotesAppearance("notesWidth", "wide"));
    expect(screen.getByTestId("settings-notes-width-wide")).toHaveAttribute("aria-pressed", "true");
  });

  it("turns the word count and spell checking off", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    await user.click(screen.getByRole("switch", { name: notes.wordCount.label }));
    await user.click(screen.getByRole("switch", { name: notes.spellcheck.label }));
    expect(useSettingsStore.getState()).toMatchObject({ notesShowWordCount: false, notesSpellcheck: false });
    expect(previewRoot()).toHaveAttribute("spellcheck", "false");
  });

  it("follows the app accent by default and takes a swatch or a custom color", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    const matchApp = screen.getByTestId("settings-notes-accent-app");
    expect(matchApp).toHaveAttribute("aria-pressed", "true");
    expect(matchApp.querySelector("span")).toHaveStyle({ backgroundColor: ACCENTS[0].color });

    await user.click(screen.getByTestId(`settings-notes-accent-${ACCENTS[3].id}`));
    expect(useSettingsStore.getState().notesAccentColor).toBe(ACCENTS[3].color);
    expect(previewRoot()).toHaveAttribute("data-notes-accent", "");
    expect(variable("--notes-accent")).toBe(ACCENTS[3].color);
    expect(screen.getByTestId("settings-notes-accent-custom")).toHaveAttribute("data-active", "false");

    const writes = vi.spyOn(useSettingsStore.getState(), "setNotesAppearance");
    fireEvent.change(screen.getByLabelText(notes.accent.customAriaLabel), { target: { value: "#fde040" } });
    fireEvent.change(screen.getByLabelText(notes.accent.customAriaLabel), { target: { value: "#fde047" } });
    expect(useSettingsStore.getState().notesAccentColor).toBe(ACCENTS[3].color);
    await waitFor(() => expect(useSettingsStore.getState().notesAccentColor).toBe("#fde047"));
    expect(writes.mock.calls.filter(([key]) => key === "notesAccentColor")).toEqual([["notesAccentColor", "#fde047"]]);
    expect(variable("--notes-accent-foreground")).toBe("#111111");
    expect(screen.getByTestId("settings-notes-accent-custom")).toHaveAttribute("data-active", "true");

    await user.click(matchApp);
    expect(useSettingsStore.getState().notesAccentColor).toBe("");
    expect(previewRoot()).not.toHaveAttribute("data-notes-accent");
  });

  it("picks highlight and callout styles that preview with the real Notes styles", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    const green = screen.getByTestId("settings-notes-highlight-green");
    expect(green).toHaveAttribute("data-notes-highlight", "green");
    expect(green.querySelector("mark.note-highlight")).not.toBeNull();
    await user.click(green);
    expect(previewRoot()).toHaveAttribute("data-notes-highlight", "green");

    const bar = screen.getByTestId("settings-notes-callout-bar");
    expect(bar.querySelector('[data-notes-callout="bar"] .note-callout')).not.toBeNull();
    await user.click(bar);
    expect(useSettingsStore.getState().notesCalloutStyle).toBe("bar");
    expect(previewRoot()).toHaveAttribute("data-notes-callout", "bar");
    await user.click(screen.getByRole("button", { name: reset(notes.callouts.label) }));
    expect(previewRoot()).not.toHaveAttribute("data-notes-callout");
    await user.click(screen.getByRole("button", { name: reset(notes.highlight.label) }));
    expect(useSettingsStore.getState().notesHighlightColor).toBe("yellow");
  });

  it("resets a font, and every Notes setting at once", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ notesCodeFontFamily: "Fira Code", notesFontSize: 20, notesWidth: "full" });
    render(<NotesAppearanceTab />);
    const codeFont = screen.getByTestId("settings-row-notes-code-font");
    expect(variable("--notes-code-font")).toBe('"Fira Code", var(--font-mono)');
    await user.click(within(codeFont).getByRole("button", { name: reset(notes.codeFont.label) }));
    expect(useSettingsStore.getState().notesCodeFontFamily).toBe("");

    await user.click(screen.getByTestId("settings-notes-reset-all"));
    expect(useSettingsStore.getState()).toMatchObject(NOTES_APPEARANCE_DEFAULTS);
    expect(screen.queryByTestId("settings-notes-reset-all")).toBeNull();
    expect(variable("--notes-text-size")).toBe("0.9375rem");
  });
});
