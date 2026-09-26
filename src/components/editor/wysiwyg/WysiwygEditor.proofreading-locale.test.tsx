// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import cs from "@/i18n/locales/cs/editor.json" with { type: "json" };
import { applyLocale, i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import type { VisualProofreadingIssue } from "./proofreading";

const proofreading = vi.hoisted(() => ({
  listener: null as null | ((issue: VisualProofreadingIssue | null) => void),
}));

vi.mock("./proofreading", async () => {
  const { Extension } = await import("@tiptap/core");
  const actual = await vi.importActual<typeof import("./proofreading")>("./proofreading");
  return {
    ...actual,
    VisualProofreading: Extension.create({ name: "visualProofreadingTestStub" }),
    refreshVisualProofreading: vi.fn(),
    setVisualProofreadingIssueListener: (l: typeof proofreading.listener) => {
      proofreading.listener = l;
    },
    isVisualProofreadingIssueCurrent: () => true,
    visualProofreadingIssueGroup: () => null,
    applyVisualProofreadingSuggestion: () => true,
    ignoreVisualProofreadingIssue: () => true,
  };
});

import { WysiwygEditor } from "./WysiwygEditor";

beforeAll(async () => {
  await applyLocale("cs");
  const rect = new DOMRect(10, 10, 40, 16);
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect;
  useFilesStore.setState({
    projectId: "p",
    activePath: "notes.md",
    files: { "notes.md": { content: "Toto je chybne slovo.\n", dirty: false } },
  } as unknown as ReturnType<typeof useFilesStore.getState>);
});

const WORKER_MESSAGE = "Possible misspelling: “chybne”";
const CZECH_MESSAGE = cs.package.spellcheck.notInDictionary.replace(
  "{{word}}",
  "chybne",
);

function decorationAttributes(
  mapped: ReturnType<typeof import("./proofreading").mapVisualProofreadingDiagnostics>,
): Record<string, string>[] {
  const attrs: Record<string, string>[] = [];
  for (const decoration of mapped.decorations.find()) {
    attrs.push(
      (decoration as unknown as { type: { attrs: Record<string, string> } })
        .type.attrs,
    );
  }
  return attrs;
}

describe("visual proofreading under the Czech UI", () => {
  it("shows the spelling finding in Czech in the popover", () => {
    expect(i18n.language).toBe("cs");
    render(<WysiwygEditor wysiwyg={true} />);
    act(() =>
      proofreading.listener?.({
        id: "i1",
        path: "notes.md",
        projectId: "p",
        documentVersion: 1,
        revision: 1,
        requestGeneration: 1,
        from: 9,
        to: 15,
        message: WORKER_MESSAGE,
        kind: "Spelling",
        source: "hunspell",
        word: "chybne",
        rule: null,
        suggestions: [{ kind: 0, text: "chybně" }],
      } as VisualProofreadingIssue),
    );
    const panel = screen.getByRole("dialog", {
      name: cs.visual.proofreadingPanel,
    });
    expect(panel).toHaveTextContent(cs.visual.spelling);
    expect(panel).toHaveTextContent(CZECH_MESSAGE);
    expect(panel).not.toHaveTextContent(WORKER_MESSAGE);
  });

  it("builds the tooltip and accessible label in Czech", async () => {
    const actual =
      await vi.importActual<typeof import("./proofreading")>("./proofreading");
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      content: "<p>Toto je chybne slovo.</p>",
    });
    const extraction = actual.extractVisualProofreadingProse(
      editor.state.doc,
      "markdown",
    );
    const from = extraction.text.indexOf("chybne");
    const painted = actual.mapVisualProofreadingDiagnostics(
      editor.state.doc,
      [
        {
          from,
          to: from + 6,
          message: WORKER_MESSAGE,
          kind: "Spelling",
          source: "hunspell",
          word: "chybne",
          suggestions: [],
          rule: null,
        },
      ],
      extraction,
      { path: "notes.md", projectId: "p", documentVersion: 1 },
      1,
      1,
    );
    const [attrs] = decorationAttributes(painted);
    expect(attrs?.title).toBe(CZECH_MESSAGE);
    expect(attrs?.["aria-label"]).toBe(
      cs.visual.findingLabel.replace("{{message}}", CZECH_MESSAGE),
    );
    editor.destroy();
  });

  it("uses the Czech plural for several findings in one raw block", async () => {
    const actual =
      await vi.importActual<typeof import("./proofreading")>("./proofreading");
    const { RawBlock } = await import("@oleafly/wysiwyg");
    const source =
      "\\begin{abstract}Prvni chybaa a druha chybab.\\end{abstract}";
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, RawBlock],
      content: {
        type: "doc",
        content: [{ type: "rawBlock", attrs: { source } }],
      },
    });
    const extraction = actual.extractVisualProofreadingProse(
      editor.state.doc,
      "latex",
    );
    const diagnostics = ["chybaa", "chybab"].map((word) => {
      const start = extraction.text.indexOf(word);
      return {
        from: start,
        to: start + word.length,
        message: `Possible misspelling: “${word}”`,
        kind: "Spelling",
        source: "hunspell" as const,
        word,
        suggestions: [],
        rule: null,
      };
    });
    const painted = actual.mapVisualProofreadingDiagnostics(
      editor.state.doc,
      diagnostics,
      extraction,
      { path: "main.tex", projectId: "p", documentVersion: 1 },
      1,
      1,
    );
    const [attrs] = decorationAttributes(painted);
    expect(attrs?.["aria-label"]).toBe(
      cs.visual.rawBlockFindings_few
        .replace("{{count}}", "2")
        .replace(
          "{{message}}",
          cs.package.spellcheck.notInDictionary.replace("{{word}}", "chybaa"),
        ),
    );
    editor.destroy();
  });
});
