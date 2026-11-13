// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NOTES_TEXT_REPLACEMENTS } from "@/lib/notes-appearance";
import { useSettingsStore } from "@/store/settings";
import { replacementBefore } from "./note-text-replacements";
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, pressKey, typeInto } from "./tests/kb-editor-fixtures";

function typed(start: string, text: string, at = start): string {
  const editor = kbEditor(start);
  placeCursor(editor, at, at.length);
  typeInto(editor, text);
  return kbMarkdown(editor);
}

beforeEach(() => {
  useSettingsStore.setState({ notesTextReplace: true, notesTextReplacements: NOTES_TEXT_REPLACEMENTS });
});

afterEach(destroyKbEditors);

describe("text replacements", () => {
  it("picks the longest pair that ends the text", () => {
    expect(replacementBefore("a ->", NOTES_TEXT_REPLACEMENTS)).toEqual(["->", "→"]);
    expect(replacementBefore("a x->", { "->": "→", "x->": "⟶" })).toEqual(["x->", "⟶"]);
    expect(replacementBefore("a -", NOTES_TEXT_REPLACEMENTS)).toBeNull();
  });

  it.each([
    [" -> b", "a → b"],
    [" <- b", "a ← b"],
    [" => b", "a ⇒ b"],
    [" != b", "a ≠ b"],
    [" <= b", "a ≤ b"],
    [" >= b", "a ≥ b"],
    [" +- 2", "a ± 2"],
    [" and so on...", "a and so on…"],
    [" -- b", "a — b"],
  ])("turns %j into %j as you type", (text, expected) => {
    expect(typed("a", text)).toBe(expected);
  });

  it("still makes a divider from three hyphens", () => {
    const editor = kbEditor("first\n\nx");
    placeCursor(editor, "x", 0);
    editor.commands.deleteRange({ from: editor.state.selection.from, to: editor.state.selection.from + 1 });
    typeInto(editor, "---");
    expect(editor.getJSON().content?.some((node) => node.type === "horizontalRule")).toBe(true);
  });

  it("leaves inline code and code blocks as typed", () => {
    expect(typed("see `ab` here", "->", "a")).toBe("see `a->b` here");
    expect(typed("```\nab\n```", "->", "a")).toBe("```\na->b\n```");
  });

  it("leaves inline code and math being typed in Markdown as typed", () => {
    expect(typed("x", " `a->b`")).toBe("x `a->b`");
    expect(typed("x", " ``a->b``")).toContain("a->b");
    expect(typed("x", " $a<=b$")).toBe("x $a<=b$");
    expect(typed("x", " $$a<=b")).toBe("x $$a<=b");
  });

  it("swaps again after a closed code span, a closed formula or an escaped dollar", () => {
    expect(typed("x", " `a` b->c")).toBe("x `a` b→c");
    expect(typed("x", " $a$ b->c")).toBe("x $a$ b→c");
    expect(typed("x", " \\$5 <= 6")).toContain("$5 ≤ 6");
  });

  it("swaps after a lone dollar sign that a space follows, since it cannot open a formula", () => {
    expect(typed("x", " R$ 12 -- y")).toContain("R$ 12 — y");
    expect(typed("x", " $ 5 -> 6 and $ 7 ... 8")).toContain("$ 5 → 6 and $ 7 … 8");
    expect(typed("x", " $ 5 then $a<=b")).toContain("$a<=b");
  });

  it("swaps after a dollar amount, since an unclosed dollar before a digit is not a formula", () => {
    expect(typed("x", " Lunch was $12 -- worth it")).toContain("$12 — worth it");
    expect(typed("x", " costs $5 -> cheap")).toContain("$5 → cheap");
    expect(typed("x", " $1,200.50 and $3 ... y")).toContain("$1,200.50 and $3 … y");
    expect(typed("x", " $12 then $a<=b")).toContain("$a<=b");
  });

  it("fires a longer pair after a shorter one inside it has already swapped", () => {
    useSettingsStore.setState({ notesTextReplacements: { ...NOTES_TEXT_REPLACEMENTS, "<->": "↔", "-->": "⟶", "<=>": "⇔" } });
    expect(typed("a", " <-> x --> y <=> z -> w")).toBe("a ↔ x ⟶ y ⇔ z → w");
    expect(replacementBefore("a —>", { "--": "—", "-->": "⟶" })).toEqual(["—>", "⟶"]);
  });

  it("puts the typed text back on Backspace right after a replacement", () => {
    const editor = kbEditor("a");
    placeCursor(editor, "a", 1);
    typeInto(editor, " ->");
    expect(kbMarkdown(editor)).toBe("a →");
    pressKey(editor, "Backspace");
    expect(kbMarkdown(editor)).toBe("a ->");
  });

  it("follows the setting and the pairs at once, without a new editor", () => {
    const editor = kbEditor("a");
    placeCursor(editor, "a", 1);
    useSettingsStore.setState({ notesTextReplace: false });
    typeInto(editor, " ->");
    expect(kbMarkdown(editor)).toBe("a ->");
    useSettingsStore.setState({ notesTextReplace: true, notesTextReplacements: { "(c)": "©" } });
    typeInto(editor, " (c) ->");
    expect(kbMarkdown(editor)).toBe("a -> © ->");
  });
});
