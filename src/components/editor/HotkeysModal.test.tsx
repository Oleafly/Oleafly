// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { EDITOR_KEY_DEFAULTS, useEditorKeymapStore } from "@/store/editor-keymap";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const platform = vi.hoisted(() => ({ mac: false }));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    shortcut: (keys: string) => actual.shortcut(keys, platform.mac),
  };
});

import { HotkeysModal } from "./HotkeysModal";

const hotkeys = en.hotkeys;

function setPlatform(value: string, mac: boolean) {
  platform.mac = mac;
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

function rowFor(description: string) {
  const label = screen.getAllByText(description)[0];
  const row = label.parentElement;
  if (!row) throw new Error(description);
  return row;
}

describe("HotkeysModal", () => {
  beforeEach(() => {
    setPlatform("", false);
    useSettingsStore.setState({
      hotkeysOpen: false,
      settingsOpen: false,
      settingsInitialSection: "general",
    });
    useFilesStore.setState({ activePath: null });
  });

  afterEach(() => {
    setPlatform("", false);
  });

  it("renders nothing while closed", () => {
    const { container } = render(<HotkeysModal />);

    expect(container).toBeEmptyDOMElement();
  });

  it("lists every category and every shortcut description when open", () => {
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    expect(screen.getByRole("dialog")).toHaveAccessibleName(hotkeys.title);
    for (const category of Object.values(hotkeys.categories)) {
      expect(screen.getAllByText(category).length).toBeGreaterThan(0);
    }
    for (const action of Object.values(hotkeys.actions)) {
      expect(screen.getAllByText(action).length).toBeGreaterThan(0);
    }
  });

  it("splits key strings into tokens for every row shape", () => {
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    expect(rowFor(hotkeys.actions.recompile).textContent).toBe(
      `${hotkeys.actions.recompile}CtrlEnter`,
    );
    expect(rowFor(hotkeys.actions.viaCommandPalette).textContent).toBe(
      `${hotkeys.actions.viaCommandPalette}CtrlK→Recompile`,
    );
    expect(rowFor(hotkeys.actions.triggerAutocomplete).textContent).toBe(
      `${hotkeys.actions.triggerAutocomplete}CtrlSpace`,
    );
    expect(rowFor(hotkeys.actions.slashCommandMenu).textContent).toBe(
      `${hotkeys.actions.slashCommandMenu}/`,
    );
    expect(rowFor(hotkeys.actions.indentOrAccept).textContent).toBe(
      `${hotkeys.actions.indentOrAccept}Tab`,
    );
    expect(rowFor(hotkeys.actions.findReferences).textContent).toBe(
      `${hotkeys.actions.findReferences}ShiftF12`,
    );
    expect(rowFor(hotkeys.actions.goToDefinition).textContent).toBe(
      `${hotkeys.actions.goToDefinition}F12`,
    );
    expect(rowFor(hotkeys.actions.commitAndPush).textContent).toBe(
      `${hotkeys.actions.commitAndPush}ToolbarGit icon`,
    );
    expect(rowFor(hotkeys.actions.jumpToSource).textContent).toBe(
      `${hotkeys.actions.jumpToSource}CtrlClick`,
    );
  });

  it("renders mac glyph tokens when the platform is a mac", () => {
    setPlatform("MacIntel", true);
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    expect(rowFor(hotkeys.actions.recompile).textContent).toBe(
      `${hotkeys.actions.recompile}⌘Enter`,
    );
    expect(rowFor(hotkeys.actions.redo).textContent).toBe(`${hotkeys.actions.redo}⌘ShiftZ`);
    expect(rowFor(hotkeys.actions.jumpToSource).textContent).toBe(
      `${hotkeys.actions.jumpToSource}⌘Click`,
    );
  });

  it("filters on description, category and keys, and shows the empty state", () => {
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);
    const search = screen.getByLabelText(hotkeys.searchLabel);
    expect(search).toHaveAttribute("placeholder", hotkeys.searchPlaceholder);

    fireEvent.change(search, { target: { value: hotkeys.actions.undo } });
    expect(screen.getAllByText(hotkeys.actions.undo).length).toBeGreaterThan(0);
    expect(screen.queryByText(hotkeys.actions.bold)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: hotkeys.categories.git } });
    expect(screen.getByText(hotkeys.actions.commitAndPush)).toBeInTheDocument();
    expect(screen.queryByText(hotkeys.actions.undo)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Toolbar" } });
    expect(screen.getByText(hotkeys.actions.openSettings)).toBeInTheDocument();
    expect(screen.queryByText(hotkeys.actions.redo)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "no such shortcut" } });
    expect(screen.getByText(hotkeys.empty)).toBeInTheDocument();
  });

  it("derives its editor-key rows from the remappable bindings", () => {
    useEditorKeymapStore.setState({ keys: { ...EDITOR_KEY_DEFAULTS } });
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);
    const editorKeyLabels = enSettings.shortcuts.editorKeys.labels;

    expect(rowFor(editorKeyLabels.deleteLine).textContent).toBe(
      `${editorKeyLabels.deleteLine}CtrlD`,
    );
    expect(rowFor(editorKeyLabels.addCursorBelow).textContent).toBe(
      `${editorKeyLabels.addCursorBelow}CtrlAlt↓`,
    );
    expect(screen.queryByText(editorKeyLabels.titleCase)).not.toBeInTheDocument();
  });

  it("follows a remapped editor key instead of a hardcoded glyph", () => {
    useEditorKeymapStore.setState({
      keys: { ...EDITOR_KEY_DEFAULTS, deleteLine: "Mod-Shift-k", titleCase: "Ctrl-Alt-t" },
    });
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);
    const editorKeyLabels = enSettings.shortcuts.editorKeys.labels;

    expect(rowFor(editorKeyLabels.deleteLine).textContent).toBe(
      `${editorKeyLabels.deleteLine}CtrlShiftK`,
    );
    expect(rowFor(editorKeyLabels.titleCase).textContent).toBe(
      `${editorKeyLabels.titleCase}CtrlAltT`,
    );
    useEditorKeymapStore.setState({ keys: { ...EDITOR_KEY_DEFAULTS } });
  });

  it("lists the Typst keys and the slash menu while a Typst file is open", () => {
    useFilesStore.setState({ activePath: "chapters/intro.typ" });
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    expect(screen.getByText(hotkeys.categories.typst)).toBeInTheDocument();
    expect(rowFor(hotkeys.actions.slashCommandMenu).textContent).toBe(
      `${hotkeys.actions.slashCommandMenu}/`,
    );
    expect(rowFor(hotkeys.actions.typstContinueList).textContent).toBe(
      `${hotkeys.actions.typstContinueList}Enter`,
    );
    expect(rowFor(hotkeys.actions.typstItemNewLine).textContent).toBe(
      `${hotkeys.actions.typstItemNewLine}ShiftEnter`,
    );
    expect(rowFor(hotkeys.actions.typstRemoveMarker).textContent).toBe(
      `${hotkeys.actions.typstRemoveMarker}Backspace`,
    );
    expect(rowFor(hotkeys.actions.typstIndentItem).textContent).toBe(
      `${hotkeys.actions.typstIndentItem}Tab`,
    );
    expect(rowFor(hotkeys.actions.typstOutdentItem).textContent).toBe(
      `${hotkeys.actions.typstOutdentItem}ShiftTab`,
    );
    expect(rowFor(hotkeys.actions.typstMathPair).textContent).toBe(
      `${hotkeys.actions.typstMathPair}$Space`,
    );
    expect(rowFor(hotkeys.actions.formatDocument).textContent).toBe(
      `${hotkeys.actions.formatDocument}ShiftAltF`,
    );
    expect(rowFor(hotkeys.actions.typstWrapSelection).textContent).toBe(
      `${hotkeys.actions.typstWrapSelection}*_\`$`,
    );
  });

  it("keeps the slash menu for LaTeX and drops the Typst keys", () => {
    useFilesStore.setState({ activePath: "main.tex" });
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    expect(screen.getByText(hotkeys.actions.slashCommandMenu)).toBeInTheDocument();
    expect(screen.queryByText(hotkeys.categories.typst)).not.toBeInTheDocument();
    expect(screen.queryByText(hotkeys.actions.typstContinueList)).not.toBeInTheDocument();
  });

  it("hides the slash menu for a language without snippets", () => {
    useFilesStore.setState({ activePath: "README.md" });
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    expect(screen.queryByText(hotkeys.actions.slashCommandMenu)).not.toBeInTheDocument();
    expect(screen.queryByText(hotkeys.actions.typstMathPair)).not.toBeInTheDocument();
    expect(screen.getByText(hotkeys.actions.undo)).toBeInTheDocument();
  });

  it("closes from the backdrop", () => {
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    fireEvent.mouseDown(screen.getAllByLabelText(hotkeys.close)[0]);

    expect(useSettingsStore.getState().hotkeysOpen).toBe(false);
  });

  it("closes from the header button", () => {
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    fireEvent.click(screen.getAllByLabelText(hotkeys.close)[1]);

    expect(useSettingsStore.getState().hotkeysOpen).toBe(false);
  });

  it("hands off to the shortcut settings section", async () => {
    useSettingsStore.setState({ hotkeysOpen: true });
    render(<HotkeysModal />);

    fireEvent.click(screen.getByLabelText(hotkeys.openSettings));

    expect(useSettingsStore.getState().hotkeysOpen).toBe(false);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("shortcuts");
    await waitFor(() => expect(useSettingsStore.getState().settingsOpen).toBe(true));
  });
});
