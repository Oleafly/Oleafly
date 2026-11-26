import { buildLibrary, parseSnippetFile } from "@oleafly/snippets";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEditorView: vi.fn(),
  insertAtCursor: vi.fn(),
  isWysiwygActive: vi.fn(() => false),
  insertSnippet: vi.fn((..._args: unknown[]) => true),
}));

vi.mock("@/components/editor/cm/controller", () => ({ getEditorView: mocks.getEditorView, insertAtCursor: mocks.insertAtCursor }));
vi.mock("@/components/editor/wysiwyg/controller", () => ({ isWysiwygActive: mocks.isWysiwygActive }));
vi.mock("@oleafly/editor/snippets/runtime", () => ({ insertSnippet: mocks.insertSnippet }));

import { useFilesStore } from "@/store/files";
import { insertSnippetAtCursor } from "./insert-at-cursor";
import { useSnippetStore } from "./store";

const FILES = [
  parseSnippetFile(
    JSON.stringify({
      "user.frac": { name: "Fraction", prefix: "//", body: `\\frac{\${1:a}}{\${2:b}}$0` },
      "user.empty": { name: "Exit only", prefix: "ee", body: "$0" },
    }),
    "mine",
    "user",
  ),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isWysiwygActive.mockReturnValue(false);
  useFilesStore.setState({ activePath: "main.tex" });
  useSnippetStore.setState({ library: buildLibrary({ files: FILES, disabledCollections: new Set(), overrides: [], disabledRegex: new Set() }) });
});

describe("insertSnippetAtCursor", () => {
  it("inserts a snippet with its fields in the source editor", () => {
    const record = useSnippetStore.getState().library.byId("user.frac");
    expect(insertSnippetAtCursor("missing")).toBe(false);
    mocks.getEditorView.mockReturnValue(null);
    expect(insertSnippetAtCursor("user.frac")).toBe(false);
    const view = { state: { selection: { main: { from: 2, to: 4 } } }, focus: vi.fn() };
    mocks.getEditorView.mockReturnValue(view);
    mocks.insertSnippet.mockReturnValueOnce(false);
    expect(insertSnippetAtCursor("user.frac")).toBe(false);
    expect(view.focus).not.toHaveBeenCalled();
    expect(insertSnippetAtCursor("user.frac")).toBe(true);
    expect(mocks.insertSnippet).toHaveBeenLastCalledWith(view, record, 2, 4, "palette");
    expect(view.focus).toHaveBeenCalledOnce();
  });

  it("inserts the snippet's text in Visual mode", () => {
    mocks.isWysiwygActive.mockReturnValue(true);
    expect(insertSnippetAtCursor("user.empty")).toBe(false);
    expect(insertSnippetAtCursor("user.frac")).toBe(true);
    expect(mocks.insertAtCursor).toHaveBeenCalledWith("\\frac{a}{b}");
    expect(mocks.insertSnippet).not.toHaveBeenCalled();
  });
});
