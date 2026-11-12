// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, pressKey } from "./tests/kb-editor-fixtures";
import "./tests/setup";
import { atSuggestion, chooseAt, closeAtMenu, dateItems, nextWeekday, noteAtExtensions, setAtPicker, type NoteAtOptions } from "./note-at";
import { NoteAtMenu } from "./NoteAtMenu";
import { fieldDisplay, isoDate } from "./note-fields";
import { tagTone } from "./note-tags";
import { localDate } from "./note-templates";

afterEach(destroyKbEditors);

const NOW = new Date(2026, 10, 11, 9, 0);
const NOTE = { noteId: "0b7f2c9e-5d1a-4e8b-9c3f-2a6d8e1f4b70", projectId: "p-lab", title: "Lab plan" };
const SELF = { noteId: "11111111-2222-4333-8444-555555555555", projectId: "p-self", title: "Week plan" };

function build(markdown: string, overrides: Partial<NoteAtOptions> = {}) {
  const options: NoteAtOptions = {
    getTags: () => ["writing", "reading", "lab/2026"],
    getNotes: () => [NOTE, SELF],
    getCurrentNoteId: () => SELF.noteId,
    now: () => NOW,
    ...overrides,
  };
  return kbEditor(markdown, { callout: null }, noteAtExtensions(options));
}

function type(editor: ReturnType<typeof build>, text: string) {
  act(() => {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  });
}

function ids(editor: ReturnType<typeof build>): string[] {
  return atSuggestion(editor.state)?.items.map((item) => item.id) ?? [];
}

function choose(editor: ReturnType<typeof build>, id: string): void {
  const index = ids(editor).indexOf(id);
  expect(index).toBeGreaterThanOrEqual(0);
  act(() => {
    chooseAt(editor.view, index);
  });
}

describe("@ menu items", () => {
  it("finds the next weekday after today, never today", () => {
    expect(nextWeekday(NOW, 3).getDate()).toBe(18);
    expect(nextWeekday(NOW, 4).getDate()).toBe(12);
    expect(nextWeekday(NOW, 1).getDate()).toBe(16);
  });

  it("lists a short set of dates until something is typed", () => {
    expect(dateItems("", NOW, "en").map((item) => item.id)).toEqual(["today", "tomorrow", "yesterday", "next-monday", "pick"]);
    expect(dateItems("fri", NOW, "en").map((item) => item.id)).toEqual(["next-friday"]);
    expect(dateItems("2026-12-24", NOW, "en")[0]).toMatchObject({ id: "iso-2026-12-24", action: { type: "date", date: "2026-12-24" } });
  });

  it("opens after a space or at the start, not inside a word, a citation or code", () => {
    const editor = build("Mail a@b and [@key] `x`");
    placeCursor(editor, "Mail", 4);
    type(editor, " @");
    expect(ids(editor).slice(0, 3)).toEqual(["today", "tomorrow", "yesterday"]);
    expect(ids(editor)).toEqual(expect.arrayContaining(["due", "scheduled", "priority", "custom", "tag-writing", `note-${NOTE.noteId}`]));
    expect(ids(editor)).not.toContain(`note-${SELF.noteId}`);
    placeCursor(editor, "a@b", 2);
    expect(atSuggestion(editor.state)).toBeNull();
    placeCursor(editor, "x", 1);
    type(editor, " @");
    expect(atSuggestion(editor.state)).toBeNull();
  });

  it("filters across groups and hides when nothing matches", () => {
    const editor = build("Note");
    placeCursor(editor, "Note", 4);
    type(editor, " @lab");
    expect(ids(editor)).toEqual(["tag-lab/2026", `note-${NOTE.noteId}`, "add-lab"]);
    type(editor, " qqq");
    expect(atSuggestion(editor.state)).toBeNull();
  });
});

describe("choosing from the @ menu", () => {
  it("puts a due date on a task and a date field elsewhere", () => {
    const editor = build("- [ ] Send draft\n\nMet Ana");
    placeCursor(editor, "draft", 5);
    type(editor, " @tom");
    expect(atSuggestion(editor.state)?.key).toBe("due");
    choose(editor, "tomorrow");
    placeCursor(editor, "Ana", 3);
    type(editor, " @");
    choose(editor, "today");
    expect(kbMarkdown(editor)).toBe("- [ ] Send draft [due:: 2026-11-12] \n\nMet Ana [date:: 2026-11-11] ");
  });

  it("steps into a field and offers its values", () => {
    const editor = build("- [ ] Ship");
    placeCursor(editor, "Ship", 4);
    type(editor, " @prio");
    choose(editor, "priority");
    expect(editor.state.doc.textContent).toBe("Ship @priority:: ");
    expect(ids(editor)).toEqual(["value-high", "value-medium", "value-low"]);
    type(editor, "me");
    choose(editor, "value-medium");
    expect(kbMarkdown(editor)).toBe("- [ ] Ship [priority:: medium] ");
  });

  it("sets a custom field from what was typed", () => {
    const editor = build("Draft");
    placeCursor(editor, "Draft", 5);
    type(editor, " @status:: in review");
    expect(atSuggestion(editor.state)?.items[0]).toMatchObject({ id: "value-set", label: 'Set status to "in review"' });
    act(() => {
      pressKey(editor, "Enter");
    });
    expect(kbMarkdown(editor)).toBe("Draft [status:: in review] ");
  });

  it("selects the name of a new custom field so typing replaces it", () => {
    const editor = build("Draft");
    placeCursor(editor, "Draft", 5);
    type(editor, " @");
    choose(editor, "custom");
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe("field");
    type(editor, "owner");
    choose(editor, "add-owner");
    expect(editor.state.doc.textContent).toBe("Draft @owner:: ");
    expect(atSuggestion(editor.state)?.hint).toBe("Type a value for owner, then press Enter.");
  });

  it("inserts tags and note links", () => {
    const editor = build("See");
    placeCursor(editor, "See", 3);
    type(editor, " @wri");
    choose(editor, "tag-writing");
    type(editor, "and @lab p");
    choose(editor, `note-${NOTE.noteId}`);
    expect(kbMarkdown(editor)).toBe(`See #writing and [Lab plan](oleafly://note/${NOTE.noteId}) `);
  });

  it("hands Pick a date to the picker and closes on Escape", () => {
    const editor = build("Plan");
    placeCursor(editor, "Plan", 4);
    type(editor, " @");
    const picker = vi.fn();
    setAtPicker(editor.view, picker);
    choose(editor, "pick");
    expect(picker).toHaveBeenCalledWith({ from: 6, to: 7, key: "date" });
    expect(atSuggestion(editor.state)).toBeNull();
    type(editor, "x");
    placeCursor(editor, "Plan", 4);
    type(editor, " @");
    act(() => {
      pressKey(editor, "Escape");
    });
    expect(atSuggestion(editor.state)).toBeNull();
    closeAtMenu(editor.view);
  });
});

describe("the @ menu picker", () => {
  it("closes on Escape and leaves the text alone when the note changed under it", () => {
    const editor = build("- [ ] Ship");
    render(<NoteAtMenu editor={editor} />);
    placeCursor(editor, "Ship", 4);
    type(editor, " @");
    fireEvent.click(screen.getByRole("option", { name: new RegExp(enNotes.at.pick) }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    type(editor, "x");
    placeCursor(editor, "Ship", 4);
    type(editor, " @");
    fireEvent.mouseEnter(screen.getAllByRole("option")[1]);
    expect(atSuggestion(editor.state)?.index).toBe(1);
    fireEvent.click(screen.getByRole("option", { name: new RegExp(enNotes.at.pick) }));
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("Z", 1, 2));
    });
    const dialog = screen.getByRole("dialog", { name: enNotes.at.pickerLabel });
    const days = [...dialog.querySelectorAll<HTMLButtonElement>("button")].filter((button) => /^\d+$/u.test(button.textContent ?? ""));
    fireEvent.click(days[10]);
    expect(kbMarkdown(editor)).not.toContain("[due::");
  });
});

describe("the @ menu", () => {
  it("shows grouped options and inserts a picked date", () => {
    const editor = build("- [ ] Ship");
    render(<NoteAtMenu editor={editor} />);
    placeCursor(editor, "Ship", 4);
    type(editor, " @");
    const menu = screen.getByRole("listbox", { name: enNotes.at.menu });
    expect(menu.querySelectorAll('[role="group"], fieldset')).toHaveLength(4);
    expect(screen.getByRole("group", { name: enNotes.at.groups.due })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: new RegExp(enNotes.at.pick) }));
    const dialog = screen.getByRole("dialog", { name: enNotes.at.pickerLabel });
    fireEvent.click(dialog.querySelector<HTMLButtonElement>('[data-day="2026-11-20"] button, button[data-day="2026-11-20"]') ?? dialog.querySelectorAll("button")[20]);
    expect(kbMarkdown(editor)).toMatch(/^- \[ \] Ship \[due:: 2026-11-\d\d\] $/u);
  });

  it("colours each tag's icon with that tag's tone", () => {
    const editor = build("- [ ] Ship");
    render(<NoteAtMenu editor={editor} />);
    placeCursor(editor, "Ship", 4);
    type(editor, " @lab");
    const icon = screen.getByRole("option", { name: /lab\/2026/u }).querySelector("svg")?.parentElement;
    expect(icon).toHaveClass(...tagTone("lab/2026").icon.split(" "));
    expect(icon).not.toHaveClass("text-muted-foreground");
  });
});

describe("dates and the device's time zone", () => {
  it.each(["America/Los_Angeles", "Pacific/Auckland", "UTC"])("uses the local day late at night in %s", (zone) => {
    const saved = process.env.TZ;
    process.env.TZ = zone;
    try {
      const lateNight = new Date(2026, 10, 11, 23, 30);
      const [today, tomorrow] = dateItems("", lateNight, "en");
      expect(today.action).toEqual({ type: "date", date: "2026-11-11" });
      expect(tomorrow.action).toEqual({ type: "date", date: "2026-11-12" });
      expect(isoDate("2026-11-11")?.getDate()).toBe(11);
      expect(fieldDisplay({ key: "due", value: " 2026-11-11" }, lateNight, "en").value).toBe(enNotes.fields.today);
      expect(localDate(new Date(2026, 10, 11, 0, 15))).toBe("2026-11-11");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});
