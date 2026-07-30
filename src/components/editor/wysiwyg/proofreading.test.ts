// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { RawBlock } from "@oleafly/wysiwyg";
import {
  extractVisualProofreadingProse,
  groupVisualProofreadingIssues,
  mapVisualProofreadingDiagnostics,
} from "./proofreading";

describe("Visual semantic raw-block proofreading", () => {
  it("extracts abstract prose and maps findings to exact source offsets safely", () => {
    const source =
      "\\begin{abstract}This abstrakt remains visible.\\end{abstract}";
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, RawBlock],
      content: {
        type: "doc",
        content: [{ type: "rawBlock", attrs: { source } }],
      },
    });
    const extraction = extractVisualProofreadingProse(
      editor.state.doc,
      "latex",
    );
    const from = extraction.text.indexOf("abstrakt");
    const to = from + "abstrakt".length;

    expect(from).toBeGreaterThanOrEqual(0);
    expect(extraction.text).toContain(
      "This abstrakt remains visible.",
    );
    const painted = mapVisualProofreadingDiagnostics(
      editor.state.doc,
      [
        {
          from,
          to,
          message: "Possible misspelling",
          kind: "Spelling",
          source: "hunspell",
          word: "abstrakt",
          suggestions: [{ text: "abstract", kind: 0 }],
        },
      ],
      extraction,
      {
        path: "main.tex",
        projectId: "project",
        documentVersion: 1,
      },
      2,
      3,
    );

    expect(painted.issues).toHaveLength(1);
    const mapped = painted.issues[0]?.rawBlockSource;
    expect(mapped).toBeDefined();
    expect(
      source.slice(mapped?.sourceFrom, mapped?.sourceTo),
    ).toBe("abstrakt");
    expect(mapped?.sourceSnapshot).toBe(source);
    expect(painted.decorations.find()).toHaveLength(1);

    editor.destroy();
  });

  it("keeps one bounded raw-block decoration while paging every exact finding", () => {
    const source =
      "\\begin{abstract}Firstt problem and secondd problem.\\end{abstract}";
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, RawBlock],
      content: {
        type: "doc",
        content: [{ type: "rawBlock", attrs: { source } }],
      },
    });
    const extraction = extractVisualProofreadingProse(
      editor.state.doc,
      "latex",
    );
    const words = ["Firstt", "secondd"];
    const diagnostics = words.map((word) => {
      const from = extraction.text.indexOf(word);
      return {
        from,
        to: from + word.length,
        message: `${word} may be misspelled`,
        kind: "Spelling" as const,
        source: "hunspell" as const,
        word,
        suggestions: [{ text: word.slice(0, -1), kind: 0 as const }],
      };
    });
    const painted = mapVisualProofreadingDiagnostics(
      editor.state.doc,
      diagnostics,
      extraction,
      {
        path: "main.tex",
        projectId: "project",
        documentVersion: 1,
      },
      4,
      5,
    );

    expect(painted.issues).toHaveLength(2);
    expect(painted.decorations.find()).toHaveLength(1);
    expect(painted.decorations.find()[0]?.spec.proofreadingCount).toBe(
      2,
    );
    for (const [index, issue] of painted.issues.entries()) {
      expect(
        source.slice(
          issue.rawBlockSource?.sourceFrom,
          issue.rawBlockSource?.sourceTo,
        ),
      ).toBe(words[index]);
    }

    const firstPage = groupVisualProofreadingIssues(
      painted.issues,
      painted.issues[0],
    );
    expect(firstPage).toMatchObject({
      index: 0,
      count: 2,
      previous: null,
      next: painted.issues[1],
    });
    const secondPage = groupVisualProofreadingIssues(
      painted.issues,
      painted.issues[1],
    );
    expect(secondPage).toMatchObject({
      index: 1,
      count: 2,
      previous: painted.issues[0],
      next: null,
    });

    editor.destroy();
  });
});
