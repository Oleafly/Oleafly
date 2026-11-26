// @vitest-environment jsdom

import { redo, undo } from "@codemirror/commands";
import { type EditorView, keymap } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { latexLanguage } from "../latex";
import { latexPairInputHandler, latexPairKeymap } from "../latex-pairs";
import { latexScriptGroups } from "../latex-scripts";
import { stubRangeGeometry } from "../test-geometry";
import { installEnglishEditorMessages } from "../test-messages";
import { lastAutoExpansion, restoreAutoTrigger, snippetAutoExpand } from "./auto";
import type { SnippetPort } from "./port";
import { snippetSessions } from "./session";
import { destroyViews, portWith, press, snippetEditor, type, withCursor } from "./tests/editor";
import { FAST_MATH_ENTRIES, PAPER_ENTRIES } from "./tests/fixtures";

stubRangeGeometry();

beforeAll(() => installEnglishEditorMessages());

afterEach(() => {
  destroyViews();
  vi.restoreAllMocks();
});

const ENTRIES = { ...FAST_MATH_ENTRIES, ...PAPER_ENTRIES };

function mathEditor(marked: string, overrides: Partial<SnippetPort> = {}, scripts = true): EditorView {
  return snippetEditor(marked, {
    port: portWith(ENTRIES, overrides),
    extensions: [
      latexLanguage(),
      snippetAutoExpand(),
      scripts ? latexScriptGroups() : [],
      latexPairInputHandler({ math: true, brackets: true }),
      keymap.of(latexPairKeymap),
    ],
  });
}

describe("snippetAutoExpand", () => {
  it("turns // in math into a fraction with the caret in the numerator", () => {
    const onAutoExpanded = vi.fn();
    const view = type(mathEditor("$x |$", { onAutoExpanded }), "//");
    expect(withCursor(view)).toBe("$x \\frac{|}{}$");
    expect(onAutoExpanded).toHaveBeenCalledWith(expect.objectContaining({ id: "math.frac" }));
  });

  it("gives back the typed trigger on one undo, and redo expands it again", () => {
    const view = type(mathEditor("$x |$"), "//");
    undo(view);
    expect(withCursor(view)).toBe("$x //|$");
    redo(view);
    expect(view.state.doc.toString()).toBe("$x \\frac{}{}$");
  });

  it("gives back the typed trigger on Backspace right after the expansion", () => {
    const view = type(mathEditor("$x |$"), "//");
    expect(press(view, "Backspace")).toBe(true);
    expect(withCursor(view)).toBe("$x //|$");
    expect(snippetSessions(view.state)).toHaveLength(0);
    expect(view.state.field(lastAutoExpansion)).toBeNull();
  });

  it("deletes normally once anything else happened after the expansion", () => {
    const view = type(mathEditor("$x |$"), "//");
    type(view, "a");
    expect(view.state.field(lastAutoExpansion)).toBeNull();
    expect(restoreAutoTrigger(view)).toBe(false);
  });

  it("keeps an outer field session when Backspace undoes an inner expansion", () => {
    const view = type(mathEditor("$|$"), "//");
    type(view, "sum");
    expect(snippetSessions(view.state)).toHaveLength(2);
    press(view, "Backspace");
    expect(withCursor(view)).toBe("$\\frac{sum|}{}$");
    expect(snippetSessions(view.state)).toHaveLength(1);
  });

  it("expands mk after a space into inline math", () => {
    expect(withCursor(type(mathEditor("Text |"), "mk"))).toBe("Text $|$");
  });

  it.each([
    ["Text |", "remark", "Text remark|"],
    ["Text |", "England", "Text England|"],
    ["$|$", "\\label{eq:sum", "$\\label{eq:sum|}$"],
    ["$|$", "\\mathrm{ooo", "$\\mathrm{ooo|}$"],
    ["% $x |$", "//", "% $x //|$"],
    ["Text |", "//", "Text //|"],
  ])("leaves %s + %s alone", (marked, typed, expected) => {
    expect(withCursor(type(mathEditor(marked), typed))).toBe(expected);
  });

  it("writes a subscript, and the script groups take the next digit", () => {
    const view = type(mathEditor("$|$"), "x1");
    expect(withCursor(view)).toBe("$x_1|$");
    expect(withCursor(type(view, "0"))).toBe("$x_{10|}$");
  });

  it("leaves typing inside a script group to the script groups", () => {
    expect(withCursor(type(mathEditor("$x_i|$"), "1"))).toBe("$x_{i1|}$");
    expect(withCursor(type(mathEditor("$x^a|$"), "sr"))).toBe("$x^{asr|}$");
  });

  it("fires an in-word trigger outside a script group", () => {
    expect(withCursor(type(mathEditor("$x|$"), "sr"))).toBe("$x^2|$");
  });

  it("fires a trigger that ends in a committed brace", () => {
    expect(withCursor(type(mathEditor("$|$"), "lr{"))).toBe("$\\left\\{ | \\right.$");
  });

  it("never fires while composing, in vim normal mode, with the switch off or with several cursors", () => {
    const composing = mathEditor("$x |$");
    Object.defineProperty(composing, "composing", { get: () => true });
    expect(type(composing, "//").state.doc.toString()).toBe("$x //$");

    const vim = mathEditor("$x |$");
    Object.assign(vim, { cm: { state: { vim: { insertMode: false } } } });
    expect(type(vim, "//").state.doc.toString()).toBe("$x //$");
    expect(restoreAutoTrigger(vim)).toBe(false);

    const off = mathEditor("$x |$", { enabled: () => ({ list: true, tab: true, auto: false, hint: true }) });
    expect(type(off, "//").state.doc.toString()).toBe("$x //$");

    const cursors = mathEditor("$x |$ $y |$");
    expect(type(cursors, "//").state.doc.toString()).toBe("$x //$ $y //$");
  });

  it("never fires without a language", () => {
    expect(type(mathEditor("$x |$", { language: () => null }), "//").state.doc.toString()).toBe("$x //$");
  });

  it("waits for the clipboard before remembering the expansion", async () => {
    const port = portWith(
      { paste: { prefix: "pp", body: "[${CLIPBOARD}]$0", expand: "auto", where: "text", languages: ["latex"] } },
      { readClipboard: () => Promise.resolve("copied") },
    );
    const view = snippetEditor("Text |", { port, extensions: [latexLanguage(), snippetAutoExpand()] });
    type(view, "pp");
    expect(view.state.doc.toString()).toBe("Text pp");
    expect(view.state.field(lastAutoExpansion)).toBeNull();
    await vi.waitFor(() => expect(withCursor(view)).toBe("Text [copied]|"));
  });

  it("never fires without a port or in a read-only editor", () => {
    const loose = snippetEditor("$x |$", { port: null, extensions: [latexLanguage(), snippetAutoExpand()] });
    expect(type(loose, "//").state.doc.toString()).toBe("$x //$");
    const view = type(mathEditor("$x |$"), "//");
    Object.defineProperty(view.state, "readOnly", { get: () => true });
    expect(restoreAutoTrigger(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("$x \\frac{}{}$");
  });

  it("counts a fraction typed by hand when no snippet fired", () => {
    const onHandTypedFraction = vi.fn();
    const view = type(mathEditor("$|$", { onHandTypedFraction }), "\\frac");
    expect(onHandTypedFraction).not.toHaveBeenCalled();
    type(view, "{");
    expect(onHandTypedFraction).toHaveBeenCalledTimes(1);
  });

  it("reports a regular expression that ran slowly", () => {
    const reportSlowRegex = vi.fn();
    const view = mathEditor("$|$", { reportSlowRegex });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 5));
    type(view, "y2");
    expect(reportSlowRegex).toHaveBeenCalledWith(expect.objectContaining({ id: "math.subscript" }));
  });
});
