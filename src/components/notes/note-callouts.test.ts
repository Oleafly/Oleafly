// @vitest-environment jsdom
import type { NodeViewRenderer } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { destroyKbEditors, kbEditor, kbMarkdown, placeCursor, pressKey, typeInto } from "./tests/kb-editor-fixtures";
import { CALLOUT_TYPES, calloutFold, calloutKind, calloutLabel, leaveCalloutTitle, unwrapCallout } from "./note-callouts";

const plainView: NodeViewRenderer = () => {
  const dom = document.createElement("div");
  return { dom, contentDOM: dom };
};

function editorFor(markdown: string) {
  return kbEditor(markdown, { callout: plainView });
}

afterEach(destroyKbEditors);

describe("callout kinds", () => {
  it("maps aliases, research types and unknown types", () => {
    expect(calloutKind("SUMMARY")).toEqual({ id: "abstract", icon: "clipboard-list", tone: "cyan" });
    expect(calloutKind("faq").id).toBe("question");
    expect(calloutKind("error").tone).toBe("red");
    expect(calloutKind("lemma")).toMatchObject({ id: "lemma", tone: "purple" });
    expect(calloutKind("whatever").id).toBe("note");
    expect(CALLOUT_TYPES).toEqual(expect.arrayContaining(["theorem", "definition", "proof", "hypothesis", "method", "remark"]));
    expect(calloutLabel("warning")).toBe("Warning");
    expect(calloutLabel("")).toBe("");
    expect(calloutFold("-")).toBe("-");
    expect(calloutFold("x")).toBe("");
    expect(calloutFold(null)).toBe("");
  });
});

describe("typing callouts", () => {
  it("turns a quote that starts with a type into a callout with the rest as its title", () => {
    const editor = editorFor("> Results so far");
    placeCursor(editor, "Results");
    typeInto(editor, "[!tip] ");
    expect(editor.state.selection.$from.parent.type.name).toBe("calloutTitle");
    expect(kbMarkdown(editor)).toBe("> [!tip] Results so far");
    pressKey(editor, "Enter");
    typeInto(editor, "Body");
    expect(kbMarkdown(editor)).toBe("> [!tip] Results so far\n> Body");
  });

  it("converts inserted quotes, nested quotes and folded markers", () => {
    const editor = editorFor("x");
    editor.commands.insertContent({
      type: "blockquote",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "[!warning]- Careful" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "[!bug] Inner" }] }] },
      ],
    });
    const types: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "callout") types.push(`${node.attrs.type}${node.attrs.fold}`);
    });
    expect(types).toEqual(["warning-", "bug"]);
  });

  it("leaves quotes without a space after the marker alone", () => {
    const editor = editorFor("> plain");
    placeCursor(editor, "plain");
    typeInto(editor, "[!note]");
    expect(kbMarkdown(editor)).toBe("> \\[!note\\]plain");
  });

  it("moves from the title into the body", () => {
    const editor = editorFor("> [!note] Title\n> Body");
    placeCursor(editor, "Title", 2);
    expect(leaveCalloutTitle(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
    typeInto(editor, "First");
    expect(kbMarkdown(editor)).toBe("> [!note] Title\n> First\n>\n> Body");
    placeCursor(editor, "First");
    expect(leaveCalloutTitle(editor.state)).toBe(false);
    const titleOnly = editorFor("> [!info] Only");
    placeCursor(titleOnly, "Only", 4);
    expect(pressKey(titleOnly, "Enter", { shiftKey: true })).toBe(true);
    typeInto(titleOnly, "Now a body");
    expect(kbMarkdown(titleOnly)).toBe("> [!info] Only\n> Now a body");
  });

  it("turns a callout back into a quote with Backspace at the title start", () => {
    const editor = editorFor("> [!note] Title\n> Body");
    placeCursor(editor, "Title");
    expect(pressKey(editor, "Backspace")).toBe(true);
    expect(kbMarkdown(editor)).toBe("> Title\n>\n> Body");

    const empty = editorFor("> [!note]\n> Body");
    const title = empty.state.doc.child(0).child(0);
    expect(title.type.name).toBe("calloutTitle");
    empty.commands.setTextSelection(2);
    expect(unwrapCallout(empty.state, (tr) => empty.view.dispatch(tr))).toBe(true);
    expect(kbMarkdown(empty)).toBe("> Body");

    const only = editorFor("> [!note] Just this");
    only.commands.setTextSelection(2);
    unwrapCallout(only.state, (tr) => only.view.dispatch(tr));
    expect(kbMarkdown(only)).toBe("> Just this");

    const mid = editorFor("> [!note] Title");
    placeCursor(mid, "Title", 2);
    expect(unwrapCallout(mid.state)).toBe(false);
  });

  it("names an empty title after its type", () => {
    const editor = editorFor("> [!hypothesis]\n> H1");
    const title = editor.view.dom.querySelector<HTMLElement>(".note-callout-title");
    expect(title?.classList.contains("is-empty")).toBe(true);
    expect(title?.dataset.default).toBe("Hypothesis");
  });

  it("updates the empty title hint for the callout an edit touched", () => {
    const editor = editorFor("> [!hypothesis]\n> H1\n\nAfter\n\n> [!note] Kept\n> body");
    const title = () => editor.view.dom.querySelector<HTMLElement>(".note-callout-title");
    placeCursor(editor, "After", 5);
    typeInto(editor, "!");
    expect(title()?.classList.contains("is-empty")).toBe(true);
    expect(title()?.dataset.default).toBe("Hypothesis");
    const at = editor.state.doc.child(0);
    editor.view.dispatch(editor.state.tr.insertText("Named", 2));
    expect(editor.state.doc.child(0)).not.toBe(at);
    expect(title()?.classList.contains("is-empty")).toBe(false);
    editor.view.dispatch(editor.state.tr.delete(2, 7));
    expect(title()?.classList.contains("is-empty")).toBe(true);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, type: "warning" }));
    expect(title()?.dataset.default).toBe("Warning");
  });

  it("writes body edits back with the original spacing", () => {
    const joined = editorFor("> [!note] T\n> body");
    placeCursor(joined, "body", 4);
    typeInto(joined, "!");
    expect(kbMarkdown(joined)).toBe("> [!note] T\n> body!");
    const gap = editorFor("> [!note] T\n>\n> body");
    placeCursor(gap, "body", 4);
    typeInto(gap, "!");
    expect(kbMarkdown(gap)).toBe("> [!note] T\n>\n> body!");
  });
});

describe("callouts without views", () => {
  it("adds no keys or plugins when the editor only parses", () => {
    const editor = kbEditor("> [!note] T", null);
    expect(editor.state.plugins.some((plugin) => (plugin as unknown as { key: string }).key.startsWith("noteCallouts"))).toBe(false);
    placeCursor(editor, "T");
    expect(pressKey(editor, "Backspace")).toBe(false);
  });
});
