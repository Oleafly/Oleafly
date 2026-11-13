// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { formatDate } from "@/lib/intl";
import { useShortcutStore } from "@/store/shortcuts";
import { NOTE_TEMPLATES } from "./note-templates";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteColor, NoteItem } from "./types";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";

const dice = vi.hoisted(() => ({ value: 0 }));
vi.mock("@/lib/random", () => ({ randomFraction: () => dice.value }));

import { NotesEmptyPanel } from "./NotesEmptyPanel";
import { GREETINGS_FIRST_NOTE, GREETINGS_WITH_NOTES, type Greeting, pickGreeting } from "./NotesStart";

const copy = enNotes.workspace.empty;
const templates = enNotes.vault.templates;
const originalPlatform = navigator.platform;

function note(id: string, title: string, updatedAt: number, color?: NoteColor): NoteItem {
  return { id, title, project: "Vision", updatedAt, author: "you", summary: "", color };
}

const NOTES: NoteItem[] = [
  note("old", "Oldest idea", 1),
  note("a", "Reading notes on stabilizing mutations", 50, "lilac"),
  note("b", "Meeting notes 2026-11-08", 40),
  note("c", "DSF assay protocol", 30),
  note("d", "Thermal stability of enzyme variants", 20),
];

function line(key: Greeting): string {
  return copy.greetings[key];
}

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
  useShortcutStore.getState().resetAll();
}

function panel(data: Partial<NotesData> = {}, handlers: Partial<Parameters<typeof NotesEmptyPanel>[0]> = {}) {
  const props = { onHome: vi.fn(), onNewNote: vi.fn(), onOpenNote: vi.fn(), onSearch: vi.fn(), ...handlers };
  const value = fakeNotesData({ notes: NOTES, createNoteFrom: vi.fn(() => Promise.resolve("made")), ...data });
  const tree = (next: NotesData) => (
    <NotesDataProvider value={next}>
      <NotesEmptyPanel {...props} />
    </NotesDataProvider>
  );
  const view = render(tree(value));
  return { ...view, ...props, value, rerenderWith: (next: Partial<NotesData>) => view.rerender(tree({ ...value, ...next })) };
}

function greeting(): string {
  return screen.getByRole("heading", { level: 2 }).textContent ?? "";
}

beforeEach(() => {
  dice.value = 0;
  setPlatform("MacIntel");
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe("pickGreeting", () => {
  it("never repeats the line shown last", () => {
    expect(pickGreeting(GREETINGS_WITH_NOTES, "begin", () => 0)).toBe("ready");
    expect(pickGreeting(GREETINGS_WITH_NOTES, "working", () => 0.99)).toBe("resume");
    expect(pickGreeting(GREETINGS_WITH_NOTES, null, () => 0)).toBe("begin");
  });

  it("keeps the only line it has", () => {
    expect(pickGreeting(["begin"], "begin", () => 0.5)).toBe("begin");
  });
});

describe("NotesEmptyPanel greeting", () => {
  it("greets as a heading from the set for a vault with notes, and keeps it while shown", () => {
    const { rerenderWith } = panel();
    const shown = greeting();
    expect(GREETINGS_WITH_NOTES.map(line)).toContain(shown);
    dice.value = 0.99;
    rerenderWith({ notes: NOTES.slice(1) });
    expect(greeting()).toBe(shown);
  });

  it("picks a different line the next time a panel appears", () => {
    const first = panel();
    const shown = greeting();
    first.unmount();
    panel();
    expect(greeting()).not.toBe(shown);
    expect(GREETINGS_WITH_NOTES.map(line)).toContain(greeting());
  });

  it("greets an empty vault from its own set", () => {
    dice.value = 0.99;
    panel({ notes: [] });
    expect(GREETINGS_FIRST_NOTE.map(line)).toContain(greeting());
    expect(GREETINGS_WITH_NOTES.map(line)).not.toContain(greeting());
  });

  it("swaps to the set for a vault with notes when the first note arrives", () => {
    panel().unmount();
    dice.value = 0.99;
    const { rerenderWith } = panel({ notes: [] });
    expect(greeting()).toBe(line("blank"));
    rerenderWith({ notes: NOTES });
    expect(GREETINGS_WITH_NOTES.map(line)).toContain(greeting());
  });
});

describe("NotesEmptyPanel layout", () => {
  it("shows today's date above the greeting", () => {
    panel();
    const date = formatDate(new Date(), { weekday: "long", month: "long", day: "numeric" });
    expect(screen.getByText(date).tagName).toBe("TIME");
  });

  it("opens Home and makes a new note from the top right", async () => {
    const user = userEvent.setup();
    const { onHome, onNewNote } = panel();
    await user.click(screen.getByRole("button", { name: enNotes.workspace.home }));
    await user.click(screen.getByRole("button", { name: enNotes.library.newNote }));
    expect(onHome).toHaveBeenCalledOnce();
    expect(onNewNote).toHaveBeenCalledOnce();
  });

  it("starts with a blank note tile that shows the new note shortcut, then the picker's first five templates", async () => {
    const user = userEvent.setup();
    const { onNewNote } = panel();
    const blank = screen.getByRole("button", { name: templates.blank });
    expect(blank).toHaveTextContent("⌘⌥N");
    expect(blank.className).not.toMatch(/primary/u);
    expect(blank.className).toBe(screen.getByRole("button", { name: `${templates.names.daily} ${copy.hints.daily}` }).className);
    await user.click(blank);
    expect(onNewNote).toHaveBeenCalledOnce();
    const tiles = [...document.querySelectorAll(".grid > button")].map((tile) => tile.querySelector("span.font-semibold")?.textContent);
    expect(tiles).toEqual([templates.blank, ...NOTE_TEMPLATES.slice(0, 5).map((template) => templates.names[template.id])]);
  });

  it("shows the shortcut for this platform", () => {
    setPlatform("Win32");
    panel();
    expect(screen.getByRole("button", { name: templates.blank })).toHaveTextContent("Ctrl+Shift+N");
  });

  it("creates a note from a template tile and opens it here", async () => {
    const user = userEvent.setup();
    const { onOpenNote, value } = panel();
    await user.click(screen.getByRole("button", { name: `${templates.names.daily} ${copy.hints.daily}` }));
    await vi.waitFor(() => expect(onOpenNote).toHaveBeenCalledExactlyOnceWith("made"));
    expect(value.createNoteFrom).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ icon: "lucide:calendar", color: "cream" }));
  });

  it("opens the template picker from More templates", async () => {
    const user = userEvent.setup();
    panel();
    await user.click(screen.getByRole("button", { name: copy.moreTemplates }));
    expect(screen.getByRole("dialog", { name: templates.label })).toBeInTheDocument();
  });

  it("leaves out the tiles it cannot use", () => {
    panel({ createNoteFrom: undefined }, { onNewNote: undefined });
    expect(screen.queryByRole("button", { name: templates.blank })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.moreTemplates })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enNotes.library.newNote })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: enNotes.workspace.home })).toBeInTheDocument();
  });

  it("lists the four notes edited last in a centred row and opens one here", async () => {
    const user = userEvent.setup();
    const { onOpenNote } = panel();
    const recent = screen.getByRole("region", { name: copy.continue });
    const row = recent.querySelector("[data-recent-notes]");
    expect(row).toHaveClass("flex-wrap", "justify-center");
    expect(within(recent).getAllByRole("button").map((button) => button.textContent)).toEqual([
      `${copy.searchAll}⌘⌥F`,
      "Reading notes on stabilizing mutations",
      "Meeting notes 2026-11-08",
      "DSF assay protocol",
      "Thermal stability of enzyme variants",
    ]);
    await user.click(within(recent).getByRole("button", { name: "DSF assay protocol" }));
    expect(onOpenNote).toHaveBeenCalledExactlyOnceWith("c");
  });

  it("opens the notes search from Continue", async () => {
    const user = userEvent.setup();
    const { onSearch } = panel();
    await user.click(screen.getByRole("button", { name: copy.searchAll }));
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it("shows only the greeting and the tiles for an empty vault", () => {
    const { container } = panel({ notes: [] });
    expect(container.querySelector("time")).toBeNull();
    expect(screen.queryByRole("region", { name: copy.continue })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.searchAll })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: templates.blank })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${templates.names.meeting} ${copy.hints.meeting}` })).toBeInTheDocument();
  });

  it("fills the room Continue would take with a third row of templates for an empty vault", () => {
    panel({ notes: [] });
    const tiles = [...document.querySelectorAll(".grid > button")].map((tile) => tile.querySelector("span.font-semibold")?.textContent);
    expect(tiles).toEqual([templates.blank, ...NOTE_TEMPLATES.slice(0, 8).map((template) => templates.names[template.id])]);
  });

  it("draws the rings behind the panel", () => {
    const { container } = panel();
    const rings = container.querySelector("[data-empty-panel] > [data-rings-pattern]");
    expect(rings).toHaveAttribute("aria-hidden", "true");
  });
});
