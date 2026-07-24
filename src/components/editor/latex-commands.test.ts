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
  insertBlockquote,
  insertBold,
  insertCode,
  insertEnumerate,
  insertHeading,
  insertItalic,
  insertItemize,
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
});
