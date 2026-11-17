// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { destroyOpenedEditors, openMarkdown, positionAfter, typeText } from "../test-helpers";

afterEach(destroyOpenedEditors);

const NOTE = "Bedload grows[^shear] with stress[^2].\n\n[^shear]: Measured at 5 mm.\n\n[^2]: Second.\n";

describe("footnotes in Markdown", () => {
  it("shows each reference as a raised marker and marks its definition, keeping the source", () => {
    const { editor, save } = openMarkdown(NOTE);
    const markers = [...editor.view.dom.querySelectorAll<HTMLElement>('sup[data-type="footnote"]')];
    expect(markers.map((marker) => marker.textContent)).toEqual(["shear", "2", "shear", "2"]);
    expect(markers[0]).toHaveAccessibleName(/ shear$/u);
    const definitions = [...editor.view.dom.querySelectorAll("[data-footnote-definition]")];
    expect(definitions.map((paragraph) => paragraph.textContent)).toEqual(["shear: Measured at 5 mm.", "2: Second."]);
    expect(save()).toBe(NOTE);
  });

  it("styles a definition typed as text", () => {
    const { editor } = openMarkdown("Text\n");
    editor.commands.setTextSelection(positionAfter(editor, "Text"));
    editor.commands.splitBlock();
    typeText(editor, "[^7]: typed");
    expect(editor.view.dom.querySelector("[data-footnote-definition]")?.textContent).toBe("[^7]: typed");
  });

  it("keeps definitions marked through edits elsewhere, and unmarks one that stops being a definition", () => {
    const { editor } = openMarkdown(NOTE);
    const marked = () =>
      [...editor.view.dom.querySelectorAll("[data-footnote-definition]")].map((paragraph) => paragraph.textContent);
    editor.commands.setTextSelection(positionAfter(editor, "Bedload"));
    typeText(editor, " transport");
    editor.commands.splitBlock();
    expect(marked()).toEqual(["shear: Measured at 5 mm.", "2: Second."]);
    const secondDefinition = editor.state.doc.child(editor.state.doc.childCount - 1);
    const start = editor.state.doc.content.size - secondDefinition.nodeSize + 1;
    editor.commands.setTextSelection(start);
    typeText(editor, "See ");
    expect(marked()).toEqual(["shear: Measured at 5 mm."]);
  });

  it("inserts the next free number at the cursor and puts the cursor in its new definition", () => {
    const { editor, save } = openMarkdown(NOTE.replace("Second.", "Second, see [^9] typed."));
    editor.commands.setTextSelection(positionAfter(editor, "Bedload"));
    expect(editor.commands.insertFootnoteReference()).toBe(true);
    typeText(editor, "Flume data.");
    expect(save()).toBe(
      "Bedload[^10] grows[^shear] with stress[^2].\n\n[^shear]: Measured at 5 mm.\n\n[^2]: Second, see [^9] typed.\n\n[^10]: Flume data.\n",
    );
  });

  it("puts the reference after a selection and fills an empty last line", () => {
    const { editor, save } = openMarkdown("Some words\n");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.splitBlock();
    editor.commands.setTextSelection({ from: 1, to: positionAfter(editor, "Some") });
    editor.commands.insertFootnoteReference();
    typeText(editor, "Why.");
    expect(save()).toBe("Some[^1] words\n\n[^1]: Why.\n");
  });

  it("refuses a footnote inside code", () => {
    const { editor } = openMarkdown("```\ncode\n```\n");
    editor.commands.setTextSelection(positionAfter(editor, "co"));
    expect(editor.commands.insertFootnoteReference()).toBe(false);
  });
});

describe("footnote definitions under block actions", () => {
  const SOURCE = "Text[^1] here.\n\n[^1]: Def zfae here.\n";

  it.each([
    ["a heading", (editor: Editor) => editor.chain().setTextSelection(positionAfter(editor, "zfae")).toggleHeading({ level: 2 }).run()],
    ["a bullet", (editor: Editor) => editor.chain().setTextSelection(positionAfter(editor, "zfae")).toggleBulletList().run()],
    ["a quote", (editor: Editor) => editor.chain().setTextSelection(positionAfter(editor, "zfae")).toggleBlockquote().run()],
    ["a heading over both blocks", (editor: Editor) => editor.chain().setTextSelection({ from: 2, to: positionAfter(editor, "zfae") }).toggleHeading({ level: 2 }).run()],
  ])("keeps a definition a definition when it is made %s", (_name, act) => {
    const { editor, save } = openMarkdown(SOURCE);
    act(editor);
    expect(save()).toBe(SOURCE);
  });

  it("still lets other blocks become headings, and keeps the definition unaligned", () => {
    const { editor, save } = openMarkdown(SOURCE);
    editor.chain().setTextSelection(positionAfter(editor, "Text")).toggleHeading({ level: 2 }).run();
    editor.chain().setTextSelection(positionAfter(editor, "zfae")).setTextAlign("center").run();
    expect(save()).toBe("## Text[^1] here.\n\n[^1]: Def zfae here.\n");
  });

  it.each([
    ["a code block", (editor: Editor) => editor.chain().setTextSelection(positionAfter(editor, "zfae")).toggleCodeBlock().run()],
    ["centred", (editor: Editor) => editor.chain().setTextSelection(positionAfter(editor, "zfae")).setTextAlign("center").run()],
  ])("keeps a definition a definition when it is made %s", (_name, act) => {
    const { editor, save } = openMarkdown(SOURCE);
    act(editor);
    expect(save()).toBe(SOURCE);
  });

  const NESTED: [string, string, string, (editor: Editor) => void][] = [
    ["a heading in a list item", "- item[^1] one\n- two\n\n  [^1]: in list def\n", "in list", (editor) => editor.chain().toggleHeading({ level: 2 }).run()],
    ["a heading in a quote", "> quote[^q] text\n>\n> [^q]: quoted def\n", "quoted", (editor) => editor.chain().toggleHeading({ level: 1 }).run()],
    ["a quote in a list item", "- item[^1] one\n- two\n\n  [^1]: in list def\n", "in list", (editor) => editor.chain().toggleBlockquote().run()],
    ["a bullet in a quote", "> quote[^q] text\n>\n> [^q]: quoted def\n", "quoted", (editor) => editor.chain().toggleBulletList().run()],
    ["a code block in a quote", "> quote[^q] text\n>\n> [^q]: quoted def\n", "quoted", (editor) => editor.chain().toggleCodeBlock().run()],
  ];

  it.each(NESTED)("keeps a nested definition when it is made %s", (_name, source, needle, act) => {
    const { editor, save } = openMarkdown(source);
    editor.commands.setTextSelection(positionAfter(editor, needle));
    act(editor);
    expect(save()).toBe(source);
  });
});

describe("marks on a footnote definition", () => {
  const SOURCE = "Text[^1] here.\n\n[^1]: Def zfae here.\n";
  const lineOf = (editor: Editor) => {
    const last = editor.state.doc.lastChild;
    const end = editor.state.doc.content.size - (last && last.content.size === 0 ? last.nodeSize : 0);
    const definition = editor.state.doc.childAfter(end - 2);
    return { from: definition.offset + 1, to: definition.offset + (definition.node?.nodeSize ?? 2) - 1 };
  };

  it.each([
    ["bold", (editor: Editor) => editor.chain().setTextSelection(lineOf(editor)).toggleBold().run(), "[^1]: **Def zfae here.**"],
    ["strike", (editor: Editor) => editor.chain().setTextSelection(lineOf(editor)).toggleStrike().run(), "[^1]: ~~Def zfae here.~~"],
    ["italic", (editor: Editor) => editor.chain().setTextSelection(lineOf(editor)).toggleItalic().run(), "[^1]: *Def zfae here.*"],
    ["a link", (editor: Editor) => editor.chain().setTextSelection(lineOf(editor)).setLink({ href: "https://a.b" }).run(), "[^1]: [Def zfae here.](https://a.b)"],
    ["bold after the marker", (editor: Editor) => editor.chain().setTextSelection({ from: lineOf(editor).from + 1, to: lineOf(editor).to }).toggleBold().run(), "[^1]: **Def zfae here.**"],
  ])("keeps the marker first and plain when the whole line gets %s", (_name, act, definition) => {
    const { editor, save } = openMarkdown(SOURCE);
    act(editor);
    expect(save()).toBe(`Text[^1] here.\n\n${definition}\n`);
  });

  it("keeps the marker first in a nested definition", () => {
    const source = "> quote[^q] text\n>\n> [^q]: quoted def\n";
    const { editor, save } = openMarkdown(source);
    const end = positionAfter(editor, "quoted def");
    editor.chain().setTextSelection({ from: end - "quoted def".length - 3, to: end }).toggleBold().run();
    expect(save()).toBe("> quote[^q] text\n>\n> [^q]: **quoted def**\n");
  });
});
