// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
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
