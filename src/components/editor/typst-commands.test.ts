// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const controller = vi.hoisted(() => ({
  getEditorView: vi.fn<() => unknown>(() => null),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

const languageService = vi.hoisted(() => ({
  session: null as unknown,
}));

vi.mock("@/components/editor/cm/controller", () => controller);
vi.mock("@/lib/analysis/interactive-language-service", () => ({
  currentInteractiveLanguageService: () => languageService.session,
}));

import { EditorSelection, EditorState } from "@codemirror/state";
import { typstLanguage } from "../../../packages/editor/src/typst";
import { useFigureDialogStore } from "@/store/figure-dialog";
import { useFilesStore } from "@/store/files";
import {
  insertTypstAlignedMath,
  insertTypstDisplayMath,
  insertTypstFigure,
  insertTypstFootnote,
  insertTypstFraction,
  insertTypstQuote,
  toggleTypstComment,
  typstLanguageServiceOffers,
  insertTypstBold,
  insertTypstBulletList,
  insertTypstCodeBlock,
  insertTypstHeading,
  insertTypstImage,
  insertTypstItalic,
  insertTypstLink,
  insertTypstMath,
  insertTypstNumberedList,
  insertTypstRawInline,
  insertTypstReference,
  insertTypstStrikethrough,
  insertTypstUnderline,
  TYPST_HEADING_LEVELS,
} from "./typst-commands";

describe("typst commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the six heading levels from the catalog and writes their markup", () => {
    expect(TYPST_HEADING_LEVELS.map((level) => level.hLabel)).toEqual([
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
    ]);
    expect(TYPST_HEADING_LEVELS.map((level) => level.label())).toEqual([
      en.headings.title,
      en.headings.section,
      en.headings.subsection,
      en.headings.subsubsection,
      en.headings.minor,
      en.headings.paragraphHeading,
    ]);

    insertTypstHeading(TYPST_HEADING_LEVELS[2]);

    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith(
      "=== ",
      "\n",
      "Subsection",
    );
  });

  it("wraps the selection for every inline mark", () => {
    insertTypstBold();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("*", "*", "text");

    insertTypstItalic();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("_", "_", "text");

    insertTypstUnderline();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "#underline[",
      "]",
      "text",
    );

    insertTypstStrikethrough();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "#strike[",
      "]",
      "text",
    );

    insertTypstRawInline();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("`", "`", "code");

    insertTypstMath();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("$", "$", "x");

    insertTypstReference();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("@", "", "label");
  });

  it("writes both list markers and a fenced code block", () => {
    insertTypstBulletList();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("- ", "\n", "Item");

    insertTypstNumberedList();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("+ ", "\n", "Item");

    insertTypstCodeBlock();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "```\n",
      "\n```\n",
      "code",
    );
  });

  it("selects the editable part of a link and an image template", () => {
    insertTypstLink();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith('#link("url")[text]', 7, 10);

    insertTypstImage();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith(
      '#image("image-filename")',
      8,
      22,
    );
  });
});

function viewAt(doc: string) {
  const anchor = doc.indexOf("|");
  const text = anchor < 0 ? doc : doc.slice(0, anchor) + doc.slice(anchor + 1);
  const state = EditorState.create({ doc: text, selection: EditorSelection.single(anchor) });
  return { state, focus: vi.fn(), dispatch: vi.fn() };
}

describe("typst insert commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controller.getEditorView.mockReturnValue(null);
    useFigureDialogStore.setState({ open: false, edit: null });
  });

  it("wraps footnotes, quotes and display or aligned equations", () => {
    insertTypstFootnote();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("#footnote[", "]", "note text");
    insertTypstQuote();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("#quote(block: true)[", "]", "quote");
    insertTypstDisplayMath();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("$ ", " $", "x");
    insertTypstAlignedMath();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith("$ ", " $", "a &= b \\ c &= d");
  });

  it("writes a fraction in math and wraps it in an equation in text", () => {
    controller.getEditorView.mockReturnValue(viewAt("Ratio |here"));
    insertTypstFraction();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith("$frac(a, b)$", 6, 7);

    controller.getEditorView.mockReturnValue(viewAt("$ x |$"));
    insertTypstFraction();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith("frac(a, b)", 5, 6);

    controller.getEditorView.mockReturnValue(viewAt("$x|$"));
    insertTypstFraction();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith(" frac(a, b)", 6, 7);

    const selected = viewAt("$ |dx $");
    const withSelection = { ...selected, state: EditorState.create({ doc: "$ dx $", selection: EditorSelection.single(2, 4) }) };
    controller.getEditorView.mockReturnValue(withSelection);
    insertTypstFraction();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith("frac(dx, b)", 9, 10);
  });

  it("opens the figure dialog, or edits the figure under the cursor", async () => {
    await insertTypstFigure();
    expect(useFigureDialogStore.getState()).toMatchObject({ open: true, edit: null });

    const doc = 'Intro\n#figure(image("a.png", width: 50%), caption: [A]) <fig:a>\n';
    controller.getEditorView.mockReturnValue(viewAt(doc.replace("a.png", "a.|png")));
    await insertTypstFigure();
    const edit = useFigureDialogStore.getState().edit;
    expect(edit).toMatchObject({ from: 6, to: doc.indexOf("\n", 6), path: "a.png", width: "50%" });
    expect(edit?.typst).toMatchObject({ caption: "A", label: "fig:a", placement: "none" });
  });

  it("toggles a Typst line comment", () => {
    const dispatch = vi.fn();
    const view = { state: EditorState.create({ doc: "text", extensions: typstLanguage() }), dispatch, focus: vi.fn() };
    controller.getEditorView.mockReturnValue(view);
    toggleTypstComment();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].state.doc.toString()).toBe("// text");
    expect(view.focus).toHaveBeenCalled();
  });

  it("reports language server features only for the open Typst document", () => {
    useFilesStore.setState({ projectId: "p1", activePath: "main.typ" } as never);
    expect(typstLanguageServiceOffers("definition")).toBe(false);
    languageService.session = {
      projectId: "p1",
      client: { supports: (feature: string) => feature === "definition" },
      documentForPath: (path: string) => (path === "main.typ" ? {} : null),
    };
    expect(typstLanguageServiceOffers("definition")).toBe(true);
    expect(typstLanguageServiceOffers("rename")).toBe(false);
    useFilesStore.setState({ activePath: "main.tex" } as never);
    expect(typstLanguageServiceOffers("definition")).toBe(false);
    languageService.session = null;
  });
});
