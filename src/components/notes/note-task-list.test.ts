// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNoteEditor } from "@/lib/open-note-editors";
import { DEFAULT_TASK_PREFS } from "@/store/notes-prefs";
import { destroyKbEditors, kbEditor, kbMarkdown } from "./tests/kb-editor-fixtures";
import "./tests/setup";
import { filterTasks, type TaskEntry, taskEntries, taskText, toggledTaskLine, toggleTask } from "./note-task-list";
import type { NoteItem } from "./types";

afterEach(destroyKbEditors);

const NOW = new Date(2026, 10, 11, 15, 0);

function note(id: string, title: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", ...extra };
}

const NOTES = [
  note("lab", "Lab plan", { tags: ["lab"], relatedProjectId: "ssl", project: "SSL masking" }),
  note("home", "Home list"),
];

const RECORDS = [
  {
    projectId: "lab",
    tasks: [
      { line: 5, checked: false, text: "Rerun the **sweep** [due:: 2026-11-02] [priority:: high]" },
      { line: 6, checked: false, text: "Send [draft](oleafly://note/x) [due:: 2026-11-11] #writing" },
      { line: 7, checked: true, text: "Book the cluster [due:: 2026-11-05]" },
    ],
  },
  {
    projectId: "home",
    tasks: [
      { line: 2, checked: false, text: "Buy coffee [priority:: low] [due:: 2026-11-16]" },
      { line: 3, checked: false, text: "Call the bank" },
    ],
  },
  { projectId: "gone", tasks: [{ line: 0, checked: false, text: "Orphan" }] },
];

function texts(entries: readonly TaskEntry[]): string[] {
  return entries.map((entry) => entry.text);
}

describe("task entries", () => {
  const entries = taskEntries(RECORDS, NOTES);

  it("reads fields, tags and the note each task lives in", () => {
    expect(entries).toHaveLength(5);
    expect(entries[0]).toMatchObject({
      key: "lab:5",
      noteTitle: "Lab plan",
      text: "Rerun the sweep",
      due: "2026-11-02",
      priority: "high",
      tags: ["lab"],
      projectId: "ssl",
      projectName: "SSL masking",
    });
    expect(entries[1]).toMatchObject({ text: "Send draft", tags: ["writing", "lab"], priority: null });
    expect(entries[4]).toMatchObject({ text: "Call the bank", due: null, projectId: null, projectName: null });
    expect(taskText("Plan `[x:: y]` [a:: b] ==now==")).toBe("Plan [x:: y] now");
    expect(taskText("Send report [due:: 2026-11-12] ^abc123")).toBe("Send report");
  });

  it("shows open tasks by due date, with no date last", () => {
    expect(texts(filterTasks(entries, { ...DEFAULT_TASK_PREFS, search: "" }, NOW))).toEqual([
      "Rerun the sweep",
      "Send draft",
      "Buy coffee",
      "Call the bank",
    ]);
  });

  it("sorts by priority and breaks ties by due date", () => {
    expect(texts(filterTasks(entries, { ...DEFAULT_TASK_PREFS, sort: "priority", state: "all", search: "" }, NOW))).toEqual([
      "Rerun the sweep",
      "Buy coffee",
      "Book the cluster",
      "Send draft",
      "Call the bank",
    ]);
  });

  it("filters by state, due date, priority, tag, project and words", () => {
    const run = (patch: Partial<typeof DEFAULT_TASK_PREFS> & { search?: string }) =>
      texts(filterTasks(entries, { ...DEFAULT_TASK_PREFS, search: "", ...patch }, NOW));
    expect(run({ state: "done" })).toEqual(["Book the cluster"]);
    expect(run({ due: "overdue" })).toEqual(["Rerun the sweep"]);
    expect(run({ due: "today" })).toEqual(["Send draft"]);
    expect(run({ due: "week" })).toEqual(["Send draft", "Buy coffee"]);
    expect(run({ due: "none" })).toEqual(["Call the bank"]);
    expect(run({ priority: "high" })).toEqual(["Rerun the sweep"]);
    expect(run({ priority: "none" })).toEqual(["Send draft", "Call the bank"]);
    expect(run({ priority: "low" })).toEqual(["Buy coffee"]);
    expect(run({ priority: "medium" })).toEqual([]);
    expect(run({ tag: "writing" })).toEqual(["Send draft"]);
    expect(run({ tag: "lab" })).toHaveLength(2);
    expect(run({ project: "ssl" })).toHaveLength(2);
    expect(run({ search: "home bank" })).toEqual(["Call the bank"]);
  });

  it("orders tasks with the same dates and priority by note and line", () => {
    const same = taskEntries(
      [
        { projectId: "lab", tasks: [{ line: 9, checked: false, text: "Second" }, { line: 3, checked: false, text: "First" }] },
        { projectId: "home", tasks: [{ line: 1, checked: false, text: "Home" }] },
      ],
      NOTES,
    );
    expect(texts(filterTasks(same, { ...DEFAULT_TASK_PREFS, search: "" }, NOW))).toEqual(["Home", "First", "Second"]);
  });
});

describe("checking a task off", () => {
  const FILE = "---\ntitle: Lab plan\n---\n\n> - [ ] Ask [due:: 2026-11-12]\n- [x] Done one\n";

  it("flips only the box on the expected line", () => {
    expect(toggledTaskLine(FILE, 4, "Ask [due:: 2026-11-12]", false)).toBe(FILE.replace("> - [ ] Ask", "> - [x] Ask"));
    expect(toggledTaskLine(FILE, 5, "Done one", true)).toBe(FILE.replace("- [x] Done", "- [ ] Done"));
    expect(toggledTaskLine(FILE.replace(/\n/gu, "\r\n"), 5, "Done one", true)).toBe(FILE.replace("- [x] Done", "- [ ] Done").replace(/\n/gu, "\r\n"));
  });

  it("matches a task line that ends in a block ID against the scanned text without it", () => {
    const marked = "- [ ] Send report ^abc123\n";
    expect(toggledTaskLine(marked, 0, "Send report", false)).toBe("- [x] Send report ^abc123\n");
    expect(toggledTaskLine(marked, 0, "Send report ^abc123", false)).toBe("- [x] Send report ^abc123\n");
  });

  it("refuses when the line moved or already changed", () => {
    expect(toggledTaskLine(FILE, 5, "Ask [due:: 2026-11-12]", false)).toBeNull();
    expect(toggledTaskLine(FILE, 4, "Ask [due:: 2026-11-12]", true)).toBeNull();
    expect(toggledTaskLine(FILE, 40, "Ask", false)).toBeNull();
  });

  it("writes the note file when the note is not open", async () => {
    const saveNote = vi.fn(() => Promise.resolve({ text: "", version: "v2" }));
    const data = { loadNote: () => Promise.resolve({ text: FILE, version: "v1" }), saveNote };
    const [entry] = taskEntries([{ projectId: "lab", tasks: [{ line: 4, checked: false, text: "Ask [due:: 2026-11-12]" }] }], NOTES);
    await expect(toggleTask(data, entry)).resolves.toBe(true);
    expect(saveNote).toHaveBeenCalledWith("lab", FILE.replace("> - [ ] Ask", "> - [x] Ask"), "v1");
  });

  it("changes the open editor instead of the file, and checks it is the same task", async () => {
    const editor = kbEditor("- [ ] First [due:: 2026-11-12]\n- [ ] Second **one**");
    const stop = registerNoteEditor("lab", {
      editor,
      root: null,
      text: () => kbMarkdown(editor),
      flush: () => Promise.resolve(null),
      busy: () => false,
      history: () => undefined,
      title: () => "Lab plan",
      timedOut: () => "",
    });
    const data = { loadNote: vi.fn(), saveNote: vi.fn() };
    const entries = taskEntries(
      [{ projectId: "lab", tasks: [{ line: 0, checked: false, text: "First [due:: 2026-11-12]" }, { line: 1, checked: false, text: "Second **one**" }, { line: 2, checked: false, text: "Ghost" }] }],
      NOTES,
    );
    await expect(toggleTask(data, entries[1])).resolves.toBe(true);
    expect(kbMarkdown(editor)).toBe("- [ ] First [due:: 2026-11-12]\n- [x] Second **one**");
    await expect(toggleTask(data, entries[2])).resolves.toBe(false);
    await expect(toggleTask(data, { ...entries[0], raw: "Other" })).resolves.toBe(false);
    expect(data.saveNote).not.toHaveBeenCalled();
    stop();
  });

  it("finds the open note's task by the line the scanner read, whatever its text holds", async () => {
    const source = "---\ntitle: Lab plan\n---\n\n- [ ] \n- [ ] Call Bob\n- [ ] Check $\\alpha$ now\n- [ ] Call\n  later\n- [ ] Send report ^abc123\n- plain\n- [ ] Call Bob\n";
    const editor = kbEditor(source);
    const stop = registerNoteEditor("lab", {
      editor,
      root: null,
      text: () => source,
      flush: () => Promise.resolve(null),
      busy: () => false,
      history: () => undefined,
      title: () => "Lab plan",
      timedOut: () => "",
    });
    const data = { loadNote: vi.fn(), saveNote: vi.fn() };
    const entries = taskEntries(
      [
        {
          projectId: "lab",
          tasks: [
            { line: 5, checked: false, text: "Call Bob" },
            { line: 6, checked: false, text: "Check $\\alpha$ now" },
            { line: 7, checked: false, text: "Call" },
            { line: 9, checked: false, text: "Send report" },
            { line: 11, checked: false, text: "Call Bob" },
          ],
        },
      ],
      NOTES,
    );
    expect(entries[3].text).toBe("Send report");
    for (const entry of entries) await expect(toggleTask(data, entry)).resolves.toBe(true);
    const checked: [string, boolean][] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "taskItem" && node.attrs.task === true) checked.push([node.textContent, node.attrs.checked === true]);
      return true;
    });
    expect(checked).toEqual([
      ["", false],
      ["Call Bob", true],
      ["Check  now", true],
      ["Call later", true],
      ["Send report", true],
      ["Call Bob", true],
    ]);
    await expect(toggleTask(data, { ...entries[0], line: 11 })).resolves.toBe(false);
    expect(data.saveNote).not.toHaveBeenCalled();
    stop();
  });

  it("checks off a task in an open note that holds display math with a line that looks like a list item", async () => {
    const source = "- [ ] Call Bob\n\n$$\nx = a\n  + b\n$$\n\n- [ ] Second\n";
    const editor = kbEditor(source);
    const stop = registerNoteEditor("lab", {
      editor,
      root: null,
      text: () => source,
      flush: () => Promise.resolve(null),
      busy: () => false,
      history: () => undefined,
      title: () => "Lab plan",
      timedOut: () => "",
    });
    const data = { loadNote: vi.fn(), saveNote: vi.fn() };
    const entries = taskEntries(
      [{ projectId: "lab", tasks: [{ line: 0, checked: false, text: "Call Bob" }, { line: 7, checked: false, text: "Second" }] }],
      NOTES,
    );
    for (const entry of entries) await expect(toggleTask(data, entry)).resolves.toBe(true);
    expect(kbMarkdown(editor)).toContain("- [x] Second");
    expect(kbMarkdown(editor)).toMatch(/^- \[x\] Call Bob/u);
    expect(data.saveNote).not.toHaveBeenCalled();
    stop();
  });
});
