// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn(async () => undefined) }));
vi.mock("@/lib/theme", () => ({
  currentTheme: () => "light",
  subscribeTheme: () => () => undefined,
}));

import {
  REMOTE_IMAGE_HOSTS_KEY,
  remoteImageAllowed,
  resetRemoteImagesForTest,
  trustRemoteImageHost,
} from "@/lib/remote-image";
import {
  NOTES_APPEARANCE_DEFAULTS,
  NOTES_TEXT_REPLACEMENTS,
  TEXT_REPLACEMENT_LIMITS,
} from "@/lib/notes-appearance";
import {
  NOTES_TYPEFACE_STACKS,
} from "@/lib/notes-appearance-style";
import { ACCENTS, useSettingsStore } from "@/store/settings";
import { NotesAppearanceTab } from "./NotesAppearance";
import { SettingsWidthContext, WIDE_SETTINGS_QUERY } from "./settings-width";

const notes = enNotes.appearance.notes;
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

beforeAll(async () => {
  await loadNamespace("notes");
});

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
    expect(screen.getByRole("figure", { name: enNotes.notesPreview.label })).toBeInTheDocument();
    expect(variable("--notes-text-size")).toBe("0.9375rem");
    expect(variable("--notes-title-size")).toBe("1.5rem");
    expect(previewRoot()).not.toHaveAttribute("spellcheck");
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
    expect(useSettingsStore.getState().notesWidth).toBe("full");
    act(() => useSettingsStore.getState().setNotesAppearance("notesWidth", "wide"));
    expect(screen.getByTestId("settings-notes-width-wide")).toHaveAttribute("aria-pressed", "true");
  });

  it("puts note info in a side panel by default, or inline on the page, and resets it", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    const row = within(screen.getByRole("region", { name: notes.layout.title })).getByTestId("settings-row-notes-info");
    expect(row).toHaveTextContent(notes.info.label);
    expect(row).toHaveTextContent(notes.info.description);
    expect(screen.getByTestId("settings-row-notes-info-trigger")).toHaveTextContent(notes.info.options.side);
    await pick(user, "settings-row-notes-info-trigger", notes.info.options.inline);
    expect(useSettingsStore.getState().notesInfo).toBe("inline");
    expect(localStorage.getItem("oleafly.notes.info")).toBe("inline");
    await user.click(screen.getByRole("button", { name: reset(notes.info.label) }));
    expect(useSettingsStore.getState().notesInfo).toBe("side");
  });

  it("draws task boxes round or square and resets them from their row", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    const row = screen.getByRole("region", { name: notes.layout.title });
    const round = within(row).getByRole("button", { name: notes.taskBox.options.round });
    expect(round).toHaveAttribute("aria-pressed", "true");
    expect(previewRoot()).not.toHaveAttribute("data-notes-task-box");

    await user.click(within(row).getByRole("button", { name: notes.taskBox.options.square }));
    expect(useSettingsStore.getState().notesTaskBox).toBe("square");
    expect(previewRoot()).toHaveAttribute("data-notes-task-box", "square");

    await user.click(screen.getByRole("button", { name: reset(notes.taskBox.label) }));
    expect(useSettingsStore.getState().notesTaskBox).toBe("round");
    expect(previewRoot()).not.toHaveAttribute("data-notes-task-box");
    expect(round).toHaveFocus();
  });

  it("turns the word count and spell checking off", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    await user.click(screen.getByRole("switch", { name: notes.wordCount.label }));
    await user.click(screen.getByRole("switch", { name: notes.spellcheck.label }));
    expect(useSettingsStore.getState()).toMatchObject({ notesShowWordCount: false, notesSpellcheck: false });
    expect(previewRoot()).toHaveAttribute("spellcheck", "false");
  });

  it("saves the TikZ preamble once typing settles and resets it", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    const field = screen.getByLabelText(notes.tikzPreamble.label);
    expect(field).toHaveAttribute("placeholder", "\\usetikzlibrary{arrows.meta, positioning}");
    fireEvent.change(field, { target: { value: "\\usetikzlibrary{calc}" } });
    expect(field).toHaveValue("\\usetikzlibrary{calc}");
    await waitFor(() => expect(useSettingsStore.getState().notesTikzPreamble).toBe("\\usetikzlibrary{calc}"));
    expect(localStorage.getItem("oleafly.notes.tikzPreamble")).toBe("\\usetikzlibrary{calc}");
    await user.click(screen.getByRole("button", { name: reset(notes.tikzPreamble.label) }));
    expect(useSettingsStore.getState().notesTikzPreamble).toBe("");
    expect(field).toHaveValue("");
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

  it("picks a callout style that previews with the real Notes styles, and has no highlight colour setting", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    expect(screen.queryByTestId("settings-row-notes-highlight")).not.toBeInTheDocument();
    const bar = screen.getByTestId("settings-notes-callout-bar");
    expect(bar.querySelector('[data-notes-callout="bar"] .note-callout')).not.toBeNull();
    await user.click(bar);
    expect(useSettingsStore.getState().notesCalloutStyle).toBe("bar");
    expect(previewRoot()).toHaveAttribute("data-notes-callout", "bar");
    await user.click(screen.getByRole("button", { name: reset(notes.callouts.label) }));
    expect(previewRoot()).not.toHaveAttribute("data-notes-callout");
  });

  it("styles date and field chips as a tint, an outline or an underline, previewed with real chips", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    const row = screen.getByTestId("settings-row-notes-field-style");
    expect(within(row).getByText(notes.fieldStyle.label)).toBeInTheDocument();
    const tint = within(row).getByRole("button", { name: notes.fieldStyle.options.tint });
    expect(tint).toHaveAttribute("aria-pressed", "true");
    for (const style of ["tint", "outline", "underline"] as const) {
      const sample = screen.getByTestId(`settings-notes-field-style-${style}`).querySelector(`[data-notes-field-style="${style}"]`);
      expect(sample?.querySelectorAll('.note-field[data-kind="date"]')).toHaveLength(2);
      expect(sample?.querySelector('.note-field[data-field-key="due"][data-when="past"]')).not.toBeNull();
    }
    expect(previewRoot()).not.toHaveAttribute("data-notes-field-style");

    await user.click(within(row).getByRole("button", { name: notes.fieldStyle.options.underline }));
    expect(useSettingsStore.getState().notesFieldStyle).toBe("underline");
    expect(localStorage.getItem("oleafly.notes.fieldStyle")).toBe("underline");
    expect(previewRoot()).toHaveAttribute("data-notes-field-style", "underline");
    await user.click(within(row).getByRole("button", { name: notes.fieldStyle.options.outline }));
    expect(previewRoot()).toHaveAttribute("data-notes-field-style", "outline");

    await user.click(screen.getByRole("button", { name: reset(notes.fieldStyle.label) }));
    expect(useSettingsStore.getState().notesFieldStyle).toBe("tint");
    expect(previewRoot()).not.toHaveAttribute("data-notes-field-style");
    expect(tint).toHaveFocus();
  });

  it("swaps text as you type from pairs that can be added, removed and reset", async () => {
    const user = userEvent.setup();
    render(<NotesAppearanceTab />);
    const copy = notes.replacements;
    const list = () => screen.getByRole("list", { name: copy.list });
    const type = () => screen.getByRole("textbox", { name: copy.type });
    expect(within(list()).getAllByRole("listitem")).toHaveLength(Object.keys(NOTES_TEXT_REPLACEMENTS).length);
    expect(screen.getByRole("button", { name: copy.add })).toBeDisabled();
    await user.type(type(), "(c)");
    expect(screen.getByRole("button", { name: copy.add })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: copy.becomes }), "©");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(useSettingsStore.getState().notesTextReplacements["(c)"]).toBe("©");
    expect(type()).toHaveValue("");
    expect(type()).toHaveFocus();
    await user.click(screen.getByRole("button", { name: copy.remove.replace("{{from}}", "->") }));
    expect(useSettingsStore.getState().notesTextReplacements).not.toHaveProperty("->");
    expect(document.activeElement).toHaveAccessibleName(copy.remove.replace("{{from}}", "<-"));
    await user.click(screen.getByRole("button", { name: reset(copy.list) }));
    expect(useSettingsStore.getState().notesTextReplacements).toEqual(NOTES_TEXT_REPLACEMENTS);
    expect(screen.queryByTestId("settings-notes-reset-notesTextReplacements")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: copy.label }));
    expect(useSettingsStore.getState().notesTextReplace).toBe(false);
    expect(screen.queryByTestId("settings-notes-replacements")).not.toBeInTheDocument();
  });

  it("hides the reset for pairs saved with the built-in list", () => {
    useSettingsStore.getState().setNotesAppearance("notesTextReplacements", { ...NOTES_TEXT_REPLACEMENTS });
    render(<NotesAppearanceTab />);
    expect(screen.queryByTestId("settings-notes-reset-notesTextReplacements")).not.toBeInTheDocument();
  });

  it("stops adding new pairs at the limit and says why, but still changes an existing one", async () => {
    const user = userEvent.setup();
    const full = Object.fromEntries(Array.from({ length: TEXT_REPLACEMENT_LIMITS.count }, (_, index) => [`t${index}`, `r${index}`]));
    useSettingsStore.getState().setNotesAppearance("notesTextReplacements", full);
    render(<NotesAppearanceTab />);
    const copy = notes.replacements;
    const add = () => screen.getByRole("button", { name: copy.add });
    const limit = copy.full.replace("{{limit}}", String(TEXT_REPLACEMENT_LIMITS.count));
    expect(screen.getByText(limit)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: copy.type }), "new");
    await user.type(screen.getByRole("textbox", { name: copy.becomes }), "x");
    expect(add()).toBeDisabled();
    expect(add()).toHaveAccessibleDescription(limit);
    await user.clear(screen.getByRole("textbox", { name: copy.type }));
    await user.type(screen.getByRole("textbox", { name: copy.type }), "t1");
    expect(add()).toBeEnabled();
    await user.click(add());
    expect(useSettingsStore.getState().notesTextReplacements.t1).toBe("x");
    expect(Object.keys(useSettingsStore.getState().notesTextReplacements)).toHaveLength(TEXT_REPLACEMENT_LIMITS.count);
  }, 15_000);

  it("resets a font from its own row, and has no reset above the preview", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ notesCodeFontFamily: "Fira Code", notesFontSize: 20 });
    render(<NotesAppearanceTab />);
    const preview = screen.getByRole("figure", { name: enNotes.notesPreview.label });
    expect(within(preview).queryByRole("button")).toBeNull();
    const codeFont = screen.getByTestId("settings-row-notes-code-font");
    expect(variable("--notes-code-font")).toBe('"Fira Code", var(--font-mono)');
    await user.click(within(codeFont).getByRole("button", { name: reset(notes.codeFont.label) }));
    expect(useSettingsStore.getState()).toMatchObject({ notesCodeFontFamily: "", notesFontSize: 20 });
  });

  it("keeps focus in the row when a reset button goes away", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ notesTypeface: "serif", notesLineHeight: "wide", notesAccentColor: ACCENTS[1].color });
    render(<NotesAppearanceTab />);

    await user.click(screen.getByRole("button", { name: reset(notes.typeface.label) }));
    expect(screen.getByTestId(`settings-notes-typeface-${NOTES_APPEARANCE_DEFAULTS.notesTypeface}`)).toHaveFocus();

    await user.click(screen.getByRole("button", { name: reset(notes.lineHeight.label) }));
    expect(screen.getByTestId("settings-notes-line-height-trigger")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: reset(notes.accent.label) }));
    expect(screen.getByTestId("settings-notes-accent-app")).toHaveFocus();
  });

  it("lists the sites that always load images and removes them, keeping focus in the list", async () => {
    const user = userEvent.setup();
    const copy = notes.remoteImages;
    const removeLabel = (host: string) => copy.remove.replace("{{host}}", host);
    localStorage.setItem(REMOTE_IMAGE_HOSTS_KEY, JSON.stringify(["a.org", "b.org"]));
    resetRemoteImagesForTest();
    render(<NotesAppearanceTab />);
    const region = screen.getByRole("region", { name: copy.title });
    expect(within(region).getByText(copy.description)).toBeInTheDocument();
    expect(within(region).getByText("a.org")).toBeInTheDocument();

    await user.click(within(region).getByRole("button", { name: removeLabel("a.org") }));
    expect(within(region).queryByText("a.org")).toBeNull();
    expect(JSON.parse(localStorage.getItem(REMOTE_IMAGE_HOSTS_KEY) ?? "null")).toEqual(["b.org"]);
    expect(remoteImageAllowed("https://a.org/figure.png")).toBe(false);
    expect(remoteImageAllowed("https://b.org/figure.png")).toBe(true);
    expect(within(region).getByRole("button", { name: removeLabel("b.org") })).toHaveFocus();

    await user.click(within(region).getByRole("button", { name: removeLabel("b.org") }));
    expect(JSON.parse(localStorage.getItem(REMOTE_IMAGE_HOSTS_KEY) ?? "null")).toEqual([]);
    expect(within(region).getByText(copy.empty)).toHaveFocus();
  });

  it("shows a site trusted from a note while the tab is open", () => {
    resetRemoteImagesForTest();
    render(<NotesAppearanceTab />);
    const region = screen.getByRole("region", { name: notes.remoteImages.title });
    expect(within(region).getByText(notes.remoteImages.empty)).toBeInTheDocument();
    act(() => trustRemoteImageHost("figures.example.org"));
    expect(within(region).getByText("figures.example.org")).toBeInTheDocument();
    expect(within(region).queryByText(notes.remoteImages.empty)).toBeNull();
  });
});

function stubWindowWidth(roomy: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches: roomy,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", (query: string) =>
    query === WIDE_SETTINGS_QUERY ? list : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  );
  return (next: boolean) => {
    list.matches = next;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

function renderInSettings() {
  const setWide = vi.fn();
  const view = render(
    <SettingsWidthContext.Provider value={setWide}>
      <NotesAppearanceTab />
    </SettingsWidthContext.Provider>,
  );
  return { setWide, view };
}

describe("Notes appearance layout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("puts the preview in a column beside the options and widens Settings while the tab is open", () => {
    stubWindowWidth(true);
    const { setWide, view } = renderInSettings();
    const tab = screen.getByTestId("settings-appearance-notes");
    expect(tab).toHaveAttribute("data-layout", "beside");
    expect(tab).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_20rem]", "items-start");
    expect(screen.getByTestId("settings-notes-preview")).toHaveClass("sticky", "top-0", "self-start", "col-start-2", "row-start-1");
    expect(screen.getByTestId("settings-appearance-notes-options")).toHaveClass("col-start-1", "row-start-1");
    expect(setWide).toHaveBeenLastCalledWith(true);

    view.unmount();
    expect(setWide).toHaveBeenLastCalledWith(false);
  });

  it("keeps one column with the preview on top in a narrow window and follows the window as it changes", () => {
    const resize = stubWindowWidth(false);
    const { setWide } = renderInSettings();
    const tab = screen.getByTestId("settings-appearance-notes");
    const preview = screen.getByTestId("settings-notes-preview");
    expect(tab).toHaveAttribute("data-layout", "stacked");
    expect(tab).not.toHaveClass("grid");
    expect(preview).toHaveClass("-top-5");
    expect(preview.compareDocumentPosition(screen.getByTestId("settings-appearance-notes-options"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(setWide).not.toHaveBeenCalled();

    resize(true);
    expect(tab).toHaveAttribute("data-layout", "beside");
    expect(setWide).toHaveBeenLastCalledWith(true);

    resize(false);
    expect(tab).toHaveAttribute("data-layout", "stacked");
    expect(setWide).toHaveBeenLastCalledWith(false);
  });
});
