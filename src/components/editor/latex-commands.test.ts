// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

const controller = vi.hoisted(() => ({
  insertEnvironment: vi.fn(),
  insertTemplate: vi.fn(),
  wrapSelectionOrPlaceholder: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => controller);

import {
  setWysiwygEditor,
  setWysiwygVisible,
} from "@/components/editor/wysiwyg/controller";
import {
  HEADING_LEVELS,
  insertAlign,
  insertBlockquote,
  insertBold,
  insertCode,
  insertEnumerate,
  insertEquation,
  insertFigure,
  insertFootnote,
  insertFraction,
  insertHeading,
  insertItalic,
  insertItemize,
  insertLink,
  insertRef,
  insertTable,
  insertUnderline,
} from "./latex-commands";

function headingLevel(cmd: string) {
  const level = HEADING_LEVELS.find((l) => l.cmd === cmd);
  if (!level) throw new Error(`no heading level for ${cmd}`);
  return level;
}

function fakeWysiwygEditor() {
  const run = vi.fn();
  const toggleBold = vi.fn().mockReturnThis();
  const toggleItalic = vi.fn().mockReturnThis();
  const toggleCode = vi.fn().mockReturnThis();
  const toggleHeading = vi.fn().mockReturnThis();
  const toggleBlockquote = vi.fn().mockReturnThis();
  const toggleBulletList = vi.fn().mockReturnThis();
  const toggleOrderedList = vi.fn().mockReturnThis();
  const focus = vi.fn().mockReturnThis();
  const self = {
    focus,
    toggleBold,
    toggleItalic,
    toggleCode,
    toggleHeading,
    toggleBlockquote,
    toggleBulletList,
    toggleOrderedList,
    run,
  };
  const chain = vi.fn(() => self);
  return { chain, ...self };
}

describe("latex-commands wysiwyg native routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWysiwygEditor(null);
    setWysiwygVisible(false);
  });

  it("falls back to the LaTeX text path when wysiwyg is not active", () => {
    insertBold();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\textbf{", "}", "text");
  });

  it("toggles the native bold/italic/code marks when wysiwyg is active", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertBold();
    expect(editor.toggleBold).toHaveBeenCalled();
    expect(editor.run).toHaveBeenCalled();
    expect(controller.wrapSelectionOrPlaceholder).not.toHaveBeenCalled();

    insertItalic();
    expect(editor.toggleItalic).toHaveBeenCalled();

    insertCode();
    expect(editor.toggleCode).toHaveBeenCalled();
  });

  it("toggles a native heading for section/subsection/subsubsection", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertHeading(headingLevel("section"));
    expect(editor.toggleHeading).toHaveBeenCalledWith({ level: 1 });
    expect(controller.wrapSelectionOrPlaceholder).not.toHaveBeenCalled();
  });

  it("falls back to raw text for heading levels with no native representation (part/chapter/paragraph)", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertHeading(headingLevel("part"));
    expect(editor.toggleHeading).not.toHaveBeenCalled();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith("\\part{", "}\n", "Part Title");
  });

  it("toggles native lists and blockquote", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertItemize();
    expect(editor.toggleBulletList).toHaveBeenCalled();

    insertEnumerate();
    expect(editor.toggleOrderedList).toHaveBeenCalled();

    insertBlockquote();
    expect(editor.toggleBlockquote).toHaveBeenCalled();
    expect(controller.insertEnvironment).not.toHaveBeenCalled();
  });

  it("routes every non-native Visual-mode command through a serializable raw node", () => {
    const editor = fakeWysiwygEditor();
    setWysiwygEditor(editor as never);
    setWysiwygVisible(true);

    insertUnderline();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "\\underline{",
      "}",
      "text",
    );
    insertFootnote();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "\\footnote{",
      "}",
      "note text",
    );
    insertRef();
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenLastCalledWith(
      "\\ref{",
      "}",
      "label",
    );

    insertLink();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith(
      "\\href{url}{link text}",
      6,
      9,
    );
    insertFraction();
    expect(controller.insertTemplate).toHaveBeenLastCalledWith(
      "\\frac{numerator}{denominator}",
      6,
      15,
    );
    insertFigure();
    expect(controller.insertTemplate.mock.lastCall?.[0]).toContain(
      "\\begin{figure}",
    );

    insertAlign();
    expect(controller.insertEnvironment).toHaveBeenLastCalledWith("align");
    insertEquation();
    expect(controller.insertEnvironment).toHaveBeenLastCalledWith("equation");

    for (const command of ["part", "chapter", "paragraph"]) {
      insertHeading(headingLevel(command));
    }
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith(
      "\\part{",
      "}\n",
      "Part Title",
    );
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith(
      "\\chapter{",
      "}\n",
      "Chapter Title",
    );
    expect(controller.wrapSelectionOrPlaceholder).toHaveBeenCalledWith(
      "\\paragraph{",
      "}\n",
      "Paragraph Title",
    );
  });

  it("generates every 1..8 by 1..10 toolbar table without changing its dimensions", () => {
    for (let rows = 1; rows <= 8; rows++) {
      for (let columns = 1; columns <= 10; columns++) {
        insertTable(rows, columns);
        const call = controller.insertTemplate.mock.lastCall;
        expect(call).toBeDefined();
        const [template, selectionStart, selectionEnd] = call as [
          string,
          number,
          number,
        ];
        expect(template).toContain(
          `\\begin{tabular}{${"l".repeat(columns)}}`,
        );
        const body =
          template.match(
            /\\begin\{tabular\}\{l+\}\n([\s\S]*?)\n {2}\\end\{tabular\}/,
          )?.[1] ?? "";
        const tableRows = body.split("\n");
        expect(tableRows).toHaveLength(rows);
        for (const row of tableRows) {
          expect(row.match(/&/g) ?? []).toHaveLength(columns - 1);
          expect(row.trimEnd().endsWith("\\\\")).toBe(true);
        }
        expect(template.slice(selectionStart, selectionEnd)).toBe("");
        expect(template.slice(0, selectionStart)).toMatch(/\\caption\{$/u);
      }
    }
    expect(controller.insertTemplate).toHaveBeenCalledTimes(80);
  });
});
