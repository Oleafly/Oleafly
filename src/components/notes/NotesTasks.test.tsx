// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { appQueryClient } from "@/lib/query";
import { DEFAULT_TASK_PREFS, useNotesPrefsStore } from "@/store/notes-prefs";
import { useToastStore } from "@/store/toast";
import { fakeNotesData } from "./tests/notes-data-fixture";
import "./tests/setup";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NotesTasks } from "./NotesTasks";
import { tagTone } from "./note-tags";
import type { NoteItem } from "./types";

const copy = enNotes.tasks;

const NOTES: NoteItem[] = [
  { id: "lab", title: "Lab plan", project: "SSL masking", relatedProjectId: "ssl", updatedAt: 0, author: "you", summary: "", tags: ["lab"] },
  { id: "home", title: "Home list", project: "Notes", updatedAt: 0, author: "you", summary: "" },
];

function today(offset = 0): string {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const FILE = `---\ntitle: Lab plan\n---\n\n- [ ] Rerun the sweep [due:: ${today(-3)}] [priority:: high]\n- [x] Book the cluster\n`;

function data(overrides: Partial<NotesData> = {}): NotesData {
  let text = FILE;
  return fakeNotesData({
    notes: NOTES,
    revision: 1,
    noteTasks: () =>
      Promise.resolve([
        {
          projectId: "lab",
          tasks: [
            { line: 4, checked: text.includes("- [x] Rerun"), text: `Rerun the sweep [due:: ${today(-3)}] [priority:: high]` },
            { line: 5, checked: true, text: "Book the cluster" },
          ],
        },
        { projectId: "home", tasks: [{ line: 1, checked: false, text: `Buy coffee [due:: ${today(1)}] #errand` }] },
      ]),
    loadNote: vi.fn(() => Promise.resolve({ text, version: "v1" })),
    saveNote: vi.fn((_id: string, next: string) => {
      text = next;
      return Promise.resolve({ text, version: "v2" });
    }),
    ...overrides,
  });
}

function show(value: NotesData, onOpenNote = vi.fn()) {
  const scroller = document.createElement("div");
  render(
    <NotesDataProvider value={value}>
      <NotesTasks search="" scrollRef={{ current: scroller }} iconFor={() => undefined} onOpenNote={onOpenNote} />
    </NotesDataProvider>,
  );
  return onOpenNote;
}

beforeEach(() => {
  useNotesPrefsStore.getState().set("tasks", DEFAULT_TASK_PREFS);
});

afterEach(() => {
  appQueryClient().clear();
});

describe("the tasks list", () => {
  it("lists open tasks across notes, overdue first, with their chips and note", async () => {
    const opened = show(data());
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("span")?.textContent)).toEqual(["Rerun the sweep", "Buy coffee"]);
    const due = rows[0].querySelector<HTMLElement>('.note-field[data-field-key="due"]');
    expect(due?.dataset.when).toBe("past");
    expect(due?.querySelector("svg.note-field-icon")).not.toBeNull();
    expect(due?.querySelector(".note-field-key")).toBeNull();
    expect(due?.querySelector(".sr-only")?.textContent).toBe(enNotes.fields.keys.due);
    expect(rows[0].querySelector('.note-field[data-priority="high"] .note-field-key')?.textContent).toBe(enNotes.fields.keys.priority);
    expect(rows[1].querySelector<HTMLElement>('.note-field[data-field-key="due"]')?.dataset.when).toBe("future");
    expect(within(rows[0]).getByText(enNotes.fields.priorities.high)).toBeTruthy();
    expect(within(rows[1]).getByText(enNotes.fields.tomorrow)).toBeTruthy();
    expect(within(rows[1]).getByText("#errand")).toHaveClass(tagTone("errand").tint, ...tagTone("errand").text.split(" "));
    expect(screen.getByText("2 tasks")).toBeTruthy();
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Open Home list" }));
    expect(opened).toHaveBeenCalledWith("home");
  });

  it("checks a task off in its note", async () => {
    const value = data();
    show(value);
    fireEvent.click(await screen.findByRole("checkbox", { name: 'Mark "Rerun the sweep" as done' }));
    await waitFor(() => expect(value.saveNote).toHaveBeenCalledWith("lab", FILE.replace("- [ ] Rerun", "- [x] Rerun"), "v1"));
  });

  it("filters by state and remembers the choice", async () => {
    const user = userEvent.setup();
    show(data());
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: `${copy.state.label}: ${copy.state.open}` }));
    await user.click(await screen.findByRole("menuitem", { name: copy.state.done }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(useNotesPrefsStore.getState().tasks.state).toBe("done");
    await user.click(screen.getByRole("button", { name: copy.clear }));
    expect(useNotesPrefsStore.getState().tasks.state).toBe("open");
  });

  it("offers tags and projects found in the tasks", async () => {
    const user = userEvent.setup();
    show(data());
    await screen.findAllByRole("listitem");
    await user.click(screen.getByRole("button", { name: `${copy.tag.label}: ${copy.tag.any}` }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([copy.tag.any, "#errand", "#lab"]);
    await user.click(screen.getByRole("menuitem", { name: "#errand" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: `${copy.project.label}: ${copy.project.any}` }));
    expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([copy.project.any, "SSL masking"]);
  });

  it("says when there are no tasks and when the list fails", async () => {
    show(data({ noteTasks: () => Promise.resolve([]) }));
    expect(await screen.findByText(copy.empty)).toBeTruthy();
  });

  it("shows the empty list when this window cannot read tasks", () => {
    show(data({ noteTasks: undefined }));
    expect(screen.getByText(copy.empty)).toBeTruthy();
  });

  it("shows an error when tasks cannot be read", async () => {
    show(data({ noteTasks: () => Promise.reject(new Error("disk")) }));
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toHaveTextContent(copy.failed);
  });

  it("says so and puts the box back when saving fails", async () => {
    const value = data({ saveNote: vi.fn(() => Promise.reject(new Error("disk full"))) });
    show(value);
    fireEvent.click(await screen.findByRole("checkbox", { name: 'Mark "Rerun the sweep" as done' }));
    await waitFor(() => expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(copy.toggleFailed));
    expect(screen.getByRole("checkbox", { name: 'Mark "Rerun the sweep" as done' }).getAttribute("data-state")).toBe("unchecked");
  });

  it("puts a task back when its note changed underneath", async () => {
    const value = data({ loadNote: vi.fn(() => Promise.resolve({ text: "- [ ] Something else\n", version: "v1" })) });
    show(value);
    const box = await screen.findByRole("checkbox", { name: 'Mark "Rerun the sweep" as done' });
    await act(async () => {
      fireEvent.click(box);
    });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: 'Mark "Rerun the sweep" as done' }).getAttribute("data-state")).toBe("unchecked"));
    expect(value.saveNote).not.toHaveBeenCalled();
  });
});
