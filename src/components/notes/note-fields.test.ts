// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Calendar, CalendarArrowUp, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CalendarX } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { destroyKbEditors, kbEditor, kbMarkdown, kbNote, placeCursor, typeInto } from "./tests/kb-editor-fixtures";
import { fieldDisplay, fieldKey, fieldKind, fieldSource, inlineFields, isoDate, newField, priorityOf, validFieldKey, validFieldValue } from "./note-field-values";
import { setFieldOpener } from "./note-fields";
import { editableChanged } from "./note-editable";
import { localDate } from "./note-templates";
import "./tests/setup";

afterEach(destroyKbEditors);

const NOW = new Date(2026, 10, 11, 9, 30);

function inDays(days: number): string {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

function chips(editor: ReturnType<typeof kbEditor>): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>(".note-field")];
}

function fields(markdown: string): { key: string; value: string }[] {
  const found: { key: string; value: string }[] = [];
  kbEditor(markdown).state.doc.descendants((node) => {
    if (node.type.name === "noteField") found.push({ key: node.attrs.key, value: node.attrs.value });
  });
  return found;
}

describe("inline field text", () => {
  it("finds inline fields and keeps their exact spacing", () => {
    expect(inlineFields("Ship [due:: 2026-11-12] and [owner::Ana Lima ] now")).toEqual([
      { key: "due", value: " 2026-11-12", from: 5, to: 23 },
      { key: "owner", value: "Ana Lima ", from: 28, to: 46 },
    ]);
    expect(inlineFields("[project:: [[Masking]]]")).toEqual([{ key: "project", value: " [[Masking]]", from: 0, to: 23 }]);
    expect(inlineFields("[[wiki]] [^1] [@key] [x](y) [no colon] `[c:: d]` [l:: k](url)")).toEqual([]);
  });

  it("accepts only values that read back whole, so a saved field never breaks", () => {
    for (const value of ["draft", "see [[Masking]] first", "", "a] b", "a[b", "[[open", "two]]"]) {
      const back = inlineFields(fieldSource(newField("status", value)));
      const whole = back.length === 1 && back[0].value === ` ${value.trim()}`;
      expect(validFieldValue(value)).toBe(whole);
    }
    expect(validFieldValue("a]b")).toBe(false);
    expect(validFieldValue("a[b")).toBe(false);
    expect(validFieldValue("see [[Note]]")).toBe(true);
  });

  it("normalises keys and reads dates and priorities", () => {
    expect(fieldKey(" Due Date ")).toBe("due-date");
    expect(validFieldKey("status")).toBe(true);
    expect(validFieldKey("two  spaces")).toBe(false);
    expect(validFieldKey("")).toBe(false);
    expect(isoDate("2026-02-30")).toBeNull();
    expect(isoDate(" 2026-02-28 ")?.getDate()).toBe(28);
    expect(priorityOf(" High ")).toBe("high");
    expect(priorityOf("urgent")).toBeNull();
    expect(fieldSource(newField("due", "2026-11-12"))).toBe("[due:: 2026-11-12]");
  });

  it("picks a kind for each field", () => {
    expect(fieldKind({ key: "due", value: " 2026-11-12" })).toBe("date");
    expect(fieldKind({ key: "review", value: " 2026-11-12" })).toBe("date");
    expect(fieldKind({ key: "priority", value: " medium" })).toBe("priority");
    expect(fieldKind({ key: "priority", value: " soon" })).toBe("text");
    expect(fieldKind({ key: "due", value: " Friday" })).toBe("text");
  });

  it("shows dates in words near today and marks overdue due dates", () => {
    expect(fieldDisplay({ key: "due", value: " 2026-11-11" }, NOW, "en").value).toBe(enNotes.fields.today);
    expect(fieldDisplay({ key: "due", value: " 2026-11-12" }, NOW, "en").value).toBe(enNotes.fields.tomorrow);
    const late = fieldDisplay({ key: "due", value: " 2026-11-02" }, NOW, "en");
    expect(late).toMatchObject({ kind: "date", value: "Nov 2", key: enNotes.fields.keys.due, fieldKey: "due", when: "past" });
    expect(fieldDisplay({ key: "due", value: " 2026-11-11" }, NOW, "en").when).toBe("today");
    expect(fieldDisplay({ key: "Scheduled", value: " 2026-12-02" }, NOW, "en")).toMatchObject({ fieldKey: "scheduled", when: "future" });
    expect(fieldDisplay({ key: "due", value: " Friday" }, NOW, "en").when).toBeNull();
    expect(fieldDisplay({ key: "start", value: " 2027-01-05" }, NOW, "en").value).toBe("Jan 5, 2027");
    expect(fieldDisplay({ key: "start", value: " 2027-01-05" }, NOW, "de").value).toBe("5. Jan. 2027");
    expect(fieldDisplay({ key: "priority", value: " high" }, NOW, "en")).toMatchObject({ value: "High", priority: "high" });
    expect(fieldDisplay({ key: "owner", value: "  " }, NOW, "en").label).toBe(`owner: ${enNotes.fields.empty}`);
  });

  it("gives each built-in date key an icon and keeps a text label for the rest", () => {
    const icon = (key: string, value = " 2026-11-12") => fieldDisplay({ key, value }, NOW, "en").icon;
    expect([icon("due"), icon("scheduled"), icon("date"), icon("start"), icon("created")]).toEqual([Calendar, CalendarClock, CalendarDays, CalendarArrowUp, CalendarPlus]);
    expect([icon("completed"), icon("completion"), icon("done"), icon("cancelled")]).toEqual([CalendarCheck, CalendarCheck, CalendarCheck, CalendarX]);
    expect([icon("deadline"), icon("due", " Friday"), icon("priority", " high")]).toEqual([null, null, null]);
    expect(fieldDisplay({ key: "date", value: " 2026-11-12" }, NOW, "en").label).toBe(`${enNotes.fields.keys.date}: ${enNotes.fields.tomorrow}`);
  });
});

describe("inline fields in the editor", () => {
  it("parses fields in tasks, paragraphs, callouts and tables, but not in links or code", () => {
    const found = fields(
      "- [ ] Send [due:: 2026-11-12]\n\nMet [date:: 2026-11-13]\n\n> [!todo] Later\n> - [ ] Ask [priority:: high]\n\n| a |\n| --- |\n| [x:: 1] |\n\n[due:: soon](https://x.org) `[c:: d]`\n\n```\n[f:: g]\n```",
    );
    expect(found).toEqual([
      { key: "due", value: " 2026-11-12" },
      { key: "date", value: " 2026-11-13" },
      { key: "priority", value: " high" },
      { key: "x", value: " 1" },
    ]);
  });

  it("writes fields back byte for byte, spacing included", () => {
    const source = "- [ ] Rerun [due::2026-11-14] [owner:: Ana Lima ] [project:: [[Masking]]]";
    expect(kbMarkdown(kbEditor(source))).toBe(source);
    const note = kbNote(source);
    placeCursor(note.editor, "Rerun", 5);
    typeInto(note.editor, "!");
    expect(note.save()).toBe(source.replace("Rerun", "Rerun!"));
  });

  it("draws a date chip with an icon in place of its key and says what it is in its label and tooltip", () => {
    const editor = kbEditor("- [ ] Send [due:: 2027-03-04] [priority:: low]");
    const [due, priority] = chips(editor);
    expect(due.textContent).toBe("Mar 4, 2027");
    expect(due.querySelector("svg.note-field-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(due.querySelector(".note-field-key")).toBeNull();
    expect(priority.textContent).toBe(`${enNotes.fields.keys.priority}${enNotes.fields.priorities.low}`);
    expect(priority.querySelector("svg")).toBeNull();
    expect(due.dataset).toMatchObject({ kind: "date", fieldKey: "due", when: "future", tooltip: `${enNotes.fields.keys.due}: Mar 4, 2027\n${enNotes.fields.edit}` });
    expect(priority.dataset).toMatchObject({ priority: "low", tooltip: `${enNotes.fields.keys.priority}: ${enNotes.fields.priorities.low}\n${enNotes.fields.edit}` });
    expect(priority.dataset.when).toBeUndefined();
    expect(due.getAttribute("aria-label")).toBe(`${enNotes.fields.keys.due}: Mar 4, 2027`);
  });

  it("uses the scheduled and date icons and keeps the words for custom keys and dates it cannot read", () => {
    const editor = kbEditor("Plan [scheduled:: 2027-03-04] [date:: 2027-03-05] [deadline:: 2027-03-06] [due:: Friday]");
    const [scheduled, date, deadline, friday] = chips(editor);
    for (const chip of [scheduled, date]) expect(chip.querySelector("svg.note-field-icon")).not.toBeNull();
    expect(scheduled.querySelector("svg")?.innerHTML).not.toBe(date.querySelector("svg")?.innerHTML);
    expect([scheduled.textContent, date.textContent]).toEqual(["Mar 4, 2027", "Mar 5, 2027"]);
    expect(date.getAttribute("aria-label")).toBe(`${enNotes.fields.keys.date}: Mar 5, 2027`);
    expect(deadline.textContent).toBe("deadlineMar 6, 2027");
    expect(deadline.dataset).toMatchObject({ kind: "date", when: "future" });
    expect(friday.textContent).toBe(`${enNotes.fields.keys.due}Friday`);
    expect(friday.dataset.kind).toBe("text");
    for (const chip of [deadline, friday]) expect(chip.querySelector("svg")).toBeNull();
  });

  it("marks a date chip as past, today or future", () => {
    const editor = kbEditor(`Plan [due:: ${inDays(-1)}] [due:: ${inDays(0)}] [due:: ${inDays(1)}] [scheduled:: ${inDays(-2)}]`);
    expect(chips(editor).map((chip) => chip.dataset.when)).toEqual(["past", "today", "future", "past"]);
    expect(chips(editor).map((chip) => chip.textContent)).toEqual([enNotes.fields.yesterday, enNotes.fields.today, enNotes.fields.tomorrow, expect.any(String)]);
  });

  it("puts the date chips of a checked task, and only that task, where the muted style reaches them", () => {
    const editor = kbEditor(`- [x] Sent [due:: ${inDays(-1)}]\n  - [ ] Follow up [due:: ${inDays(-1)}]\n- [ ] Open [due:: ${inDays(-1)}]`);
    const muted = '.note-task[data-checked="true"] > .note-task-content > p .note-field';
    const [sent, followUp] = chips(editor);
    expect(followUp.closest(".note-task")?.parentElement?.closest(".note-task")).toBe(sent.closest(".note-task"));
    expect(chips(editor).map((chip) => chip.matches(muted))).toEqual([true, false, false]);
  });

  it("copies a field as its Markdown and selects it as one piece", () => {
    const editor = kbEditor("Ship [due:: 2026-11-12] now");
    expect(editor.getText()).toBe("Ship [due:: 2026-11-12] now");
    expect(editor.getHTML()).toContain('data-note-field="" class="note-field"');
    editor.commands.setNodeSelection(6);
    expect(editor.view.dom.querySelector(".note-field")?.classList.contains("ProseMirror-selectednode")).toBe(true);
    editor.commands.setTextSelection(1);
    expect(editor.view.dom.querySelector(".note-field")?.classList.contains("ProseMirror-selectednode")).toBe(false);
  });

  it("leaves a typed field as text inside inline code", () => {
    const editor = kbEditor("Plan `x` end");
    placeCursor(editor, "x", 1);
    typeInto(editor, "[a:: b]");
    expect(editor.view.dom.querySelector(".note-field")).toBeNull();
  });

  it("turns a typed field into a chip when the bracket closes", () => {
    const editor = kbEditor("Plan");
    placeCursor(editor, "Plan", 4);
    typeInto(editor, " [status:: draft]");
    expect(fields(kbMarkdown(editor))).toEqual([{ key: "status", value: " draft" }]);
    expect(editor.view.dom.querySelector(".note-field")?.textContent).toBe("statusdraft");
    expect(kbMarkdown(editor)).toBe("Plan [status:: draft]");
  });

  it("asks the opener to edit a chip on click, only while editable", () => {
    const editor = kbEditor("Send [due:: 2027-03-04]");
    const opened: number[] = [];
    setFieldOpener(editor.view, (_view, pos) => opened.push(pos));
    const chip = () => editor.view.dom.querySelector<HTMLElement>(".note-field");
    chip()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(opened).toEqual([6]);
    editor.setEditable(false);
    editableChanged(editor);
    expect(chip()?.dataset.tooltip).toBe(`${enNotes.fields.keys.due}: Mar 4, 2027`);
    chip()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(opened).toEqual([6]);
    setFieldOpener(editor.view, null);
  });
});

describe("field chip styles", () => {
  const css = readFileSync(resolve(__dirname, "note-fields.css"), "utf8").replace(/\r\n/gu, "\n");

  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {\n`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  }

  it("tints chips by default and offers an outline and a dotted underline", () => {
    expect(rule(".note-field")).toContain("border: 1px solid transparent;");
    expect(rule(".note-field")).toContain("background: var(--note-field-tint);");
    expect(rule('[data-notes-field-style="outline"] .note-field')).toContain("border-color: var(--note-field-line);\n  background: transparent;");
    expect(rule('[data-notes-field-style="underline"] .note-field')).toContain("background: transparent;\n  text-decoration: underline dotted;");
    expect(rule('[data-notes-field-style="underline"] .note-field-inline')).toContain("text-underline-offset: 0.15em;");
  });

  it("colours each date by its state from the app tokens, in both themes", () => {
    expect(rule('.note-field[data-kind="date"]')).toContain("--note-field-ink: var(--primary);");
    expect(rule('.note-field[data-kind="date"]')).toContain("--note-field-hue: var(--note-field-ink);");
    expect(rule('.dark .note-field[data-kind="date"]')).toContain("--note-field-hue: var(--note-field-tone);");
    expect(css).toContain("--note-field-tone: var(--note-field-muted);\n  --note-field-hue: var(--note-field-muted);");
    expect(rule(".note-field-key")).toContain("color: var(--note-field-muted);");
    expect(rule('.note-field[data-field-key="due"][data-when="today"]')).toContain("--note-field-ink: var(--note-field-warning);");
    expect(rule('.note-field[data-field-key="due"][data-when="past"]')).toContain("--note-field-ink: var(--destructive);");
    expect(rule('.note-field[data-field-key="scheduled"]')).toContain("--note-field-ink: var(--note-field-info);");
    expect(rule(".dark .note-field")).toContain("--note-field-warning: var(--color-amber-500);");
    expect(css).not.toMatch(/in oklch[^;]*var\(--foreground\)/u);
  });

  it("marks hover and selection with a border and a tint, never an outline or a ring", () => {
    expect(rule('.ProseMirror[contenteditable="true"] .note-field:hover,\n.note-field.ProseMirror-selectednode')).toContain(
      "border-color: var(--note-field-line);\n  background: var(--note-field-tint);",
    );
    expect(css).not.toMatch(/^\s*(?:outline(?:-[a-z]+)?|box-shadow)\s*:/mu);
  });

  it("draws snippet chips as inline text so a line clamp never counts their inner lines", () => {
    const inline = rule(".note-field-inline");
    expect(inline).toContain("display: inline;");
    expect(inline).toContain("line-height: inherit;");
    expect(inline).not.toMatch(/padding: [^0]/u);
    expect(rule(".note-field-inline .note-field-icon")).toContain("display: inline-block;");
  });
});
