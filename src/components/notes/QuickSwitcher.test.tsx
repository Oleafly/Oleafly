// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const env = vi.hoisted(() => ({ mac: true }));
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    get isMac() {
      return env.mac;
    },
  };
});

import { useShortcutStore } from "@/store/shortcuts";
import { useToastStore } from "@/store/toast";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NotesVaultLayer, QuickSwitcher } from "./QuickSwitcher";
import type { NoteItem } from "./types";
import { setQuickSwitcherOpen, useVaultStore } from "./vault-store";
import { useNotesPrefsStore } from "@/store/notes-prefs";

const copy = enNotes.vault.switcher;

function note(id: string, title: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title, project: "Vision", updatedAt: 0, author: "you", summary: "", ...extra };
}

const notes = [
  note("a", "Masking ablation", { updatedAt: 3 }),
  note("b", "Reading list", { updatedAt: 2, aliases: ["Papers to read"] }),
  note("c", "Lab protocol", { updatedAt: 1 }),
];

function data(overrides: Partial<NotesData> = {}): NotesData {
  return fakeNotesData({
    notes,
    ...overrides,
  });
}

function renderSwitcher(value = data()) {
  const handlers = { onOpenNote: vi.fn(), onOpenNoteInNewTab: vi.fn() };
  const view = render(
    <NotesDataProvider value={value}>
      <QuickSwitcher {...handlers} />
    </NotesDataProvider>,
  );
  return { ...view, ...handlers };
}

function options(): string[] {
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = vi.fn();
});

const initialPrefs = useNotesPrefsStore.getState();

beforeEach(() => {
  useNotesPrefsStore.setState(initialPrefs, true);
  });

afterEach(() => {
  act(() => setQuickSwitcherOpen(false));
  useToastStore.setState({ toasts: [] });
  env.mac = true;
});

describe("QuickSwitcher", () => {
  it("shows nothing until opened", () => {
    renderSwitcher();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists recently opened notes first, then the rest", () => {
    useNotesPrefsStore.getState().recordOpened("c", 10);
    act(() => setQuickSwitcherOpen(true));
    renderSwitcher();
    expect(screen.getByRole("dialog", { name: copy.label })).toBeInTheDocument();
    expect(screen.getByText(copy.recent)).toBeInTheDocument();
    expect(options()[0]).toContain("Lab protocol");
    expect(options().slice(1).map((text) => text.replace("Vision", ""))).toEqual(["Masking ablation", "Reading list"]);
    expect(screen.getByText(copy.openHint)).toBeInTheDocument();
    expect(screen.getByText("⌘")).toBeInTheDocument();
  });

  it("matches aliases, opens with Enter and opens a new tab with Mod+Enter", async () => {
    const user = userEvent.setup();
    act(() => setQuickSwitcherOpen(true));
    const view = renderSwitcher();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "papers");
    expect(options()[0]).toContain("Reading list");
    expect(screen.getByText(copy.alias.replace("{{alias}}", "Papers to read"))).toBeInTheDocument();
    fireEvent.keyDown(screen.getByPlaceholderText(copy.placeholder), { key: "Enter", metaKey: true });
    expect(view.onOpenNoteInNewTab).toHaveBeenCalledWith("b");
    expect(useVaultStore.getState().switcherOpen).toBe(false);

    act(() => setQuickSwitcherOpen(true));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "mask");
    await user.keyboard("{Enter}");
    expect(view.onOpenNote).toHaveBeenCalledWith("a");
  });

  it("opens a clicked note and offers to create a missing one", async () => {
    const user = userEvent.setup();
    const createNoteFrom = vi.fn(async () => "new");
    act(() => setQuickSwitcherOpen(true));
    const view = renderSwitcher(data({ createNoteFrom }));
    await user.click(screen.getByText("Lab protocol"));
    expect(view.onOpenNote).toHaveBeenCalledWith("c");

    act(() => setQuickSwitcherOpen(true));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "Grant ideas");
    expect(options()).toEqual([copy.create.replace("{{title}}", "Grant ideas")]);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(view.onOpenNote).toHaveBeenCalledWith("new"));
    expect(createNoteFrom).toHaveBeenCalledWith({ title: "Grant ideas" });
  });

  it("offers a reading note for a matching reference after the create row", async () => {
    const user = userEvent.setup();
    const createNoteFrom = vi.fn(async () => "reading");
    const he = { key: "he2022", label: "He 2022, Masked Autoencoders", fields: { author: "He, Kaiming", year: "2022", title: "Masked Autoencoders" } };
    act(() => setQuickSwitcherOpen(true));
    const view = renderSwitcher(data({ createNoteFrom, citations: [he] }));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "masked");
    expect(options()).toEqual([copy.create.replace("{{title}}", "masked"), `${he.label}${he.key}`]);
    await user.click(screen.getByText(he.label));
    await waitFor(() => expect(view.onOpenNote).toHaveBeenCalledWith("reading"));
    expect(createNoteFrom).toHaveBeenCalledWith(expect.objectContaining({ title: "Masked Autoencoders", properties: expect.stringContaining("citekey: he2022") }));
    expect(useVaultStore.getState().switcherOpen).toBe(false);
  });

  it("creates from Mod+Enter on the create row and reports a failure", async () => {
    const user = userEvent.setup();
    const createNoteFrom = vi.fn(async () => Promise.reject(new Error("disk full")));
    act(() => setQuickSwitcherOpen(true));
    renderSwitcher(data({ createNoteFrom }));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "Brand new");
    fireEvent.keyDown(screen.getByPlaceholderText(copy.placeholder), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(copy.createFailed),
    );
  });

  it("does not offer to create an existing title and says when nothing matches", async () => {
    const user = userEvent.setup();
    act(() => setQuickSwitcherOpen(true));
    renderSwitcher(data({ createNoteFrom: vi.fn() }));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "reading list");
    expect(options()).toHaveLength(1);
    await user.clear(screen.getByPlaceholderText(copy.placeholder));
    await user.type(screen.getByPlaceholderText(copy.placeholder), "zzzz");
    expect(screen.getByText(copy.create.replace("{{title}}", "zzzz"))).toBeInTheDocument();
  });

  it("explains an empty or unmatched list without a create option", async () => {
    const user = userEvent.setup();
    env.mac = false;
    act(() => setQuickSwitcherOpen(true));
    const { unmount } = renderSwitcher(data({ notes: [] }));
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.getByText("Ctrl")).toBeInTheDocument();
    unmount();
    renderSwitcher();
    await user.type(screen.getByPlaceholderText(copy.placeholder), "zzzz");
    expect(screen.getByText(copy.noMatches)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByPlaceholderText(copy.placeholder), { key: "Enter", metaKey: true });
    fireEvent.keyDown(screen.getByPlaceholderText(copy.placeholder), { key: "a", metaKey: true });
    expect(useVaultStore.getState().switcherOpen).toBe(true);
  });
});

describe("NotesVaultLayer", () => {
  it("toggles the switcher with Mod+O and opens today's note with Mod+Shift+D like the Today button", () => {
    const onOpenNote = vi.fn();
    const onToday = vi.fn();
    const view = render(
      <NotesDataProvider value={data()}>
        <NotesVaultLayer onOpenNote={onOpenNote} onOpenNoteInNewTab={vi.fn()} onToday={onToday} />
      </NotesDataProvider>,
    );
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(useVaultStore.getState().switcherOpen).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(useVaultStore.getState().switcherOpen).toBe(false);
    fireEvent.keyDown(window, { key: "D", ctrlKey: true, shiftKey: true });
    expect(onToday).toHaveBeenCalledTimes(1);
    expect(onOpenNote).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "x", ctrlKey: true });
    act(() => setQuickSwitcherOpen(true));
    view.unmount();
    expect(useVaultStore.getState().switcherOpen).toBe(false);
  });

  it("ignores Mod+Shift+D when there is no daily note to open", () => {
    render(
      <NotesDataProvider value={data()}>
        <NotesVaultLayer onOpenNote={vi.fn()} onOpenNoteInNewTab={vi.fn()} />
      </NotesDataProvider>,
    );
    const event = new KeyboardEvent("keydown", { key: "D", ctrlKey: true, shiftKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("NotesVaultLayer shortcuts", () => {
  afterEach(() => {
    useShortcutStore.getState().resetAll();
  });

  it("follows the binding chosen in Keyboard Shortcuts", () => {
    useShortcutStore.getState().setBinding("notesQuickSwitcher", { key: "p", mod: true, shift: true });
    render(
      <NotesDataProvider value={data()}>
        <NotesVaultLayer onOpenNote={vi.fn()} onOpenNoteInNewTab={vi.fn()} />
      </NotesDataProvider>,
    );
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(useVaultStore.getState().switcherOpen).toBe(false);
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    expect(useVaultStore.getState().switcherOpen).toBe(true);
  });

  it("leaves a key alone that something else already handled, such as the shortcut recorder", () => {
    render(
      <NotesDataProvider value={data()}>
        <NotesVaultLayer onOpenNote={vi.fn()} onOpenNoteInNewTab={vi.fn()} />
      </NotesDataProvider>,
    );
    const handled = new KeyboardEvent("keydown", { key: "o", ctrlKey: true, cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(useVaultStore.getState().switcherOpen).toBe(false);
  });
});
