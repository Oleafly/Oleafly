// @vitest-environment jsdom
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
