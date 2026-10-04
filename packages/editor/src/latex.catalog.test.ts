// @vitest-environment jsdom

import { type Completion, CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { latexCommandCompletions, latexCompletions, slashCompletions } from "./latex";
import { installEnglishEditorMessages } from "./test-messages";

installEnglishEditorMessages();

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function commands(source: string): CompletionResult | null {
  const doc = `${source}\n\\`;
  const state = EditorState.create({ doc });
  return latexCommandCompletions(new CompletionContext(state, doc.length, false));
}

function labels(source: string): string[] {
  return (commands(source)?.options ?? []).map((option) => option.label);
}

function find(source: string, label: string): Completion {
  const found = commands(source)?.options.find((option) => option.label === label);
  if (!found) throw new Error(`Missing completion ${label}`);
  return found;
}

function inserted(source: string, label: string): string {
  const doc = `${source}\n\\`;
  const state = EditorState.create({ doc });
  const result = latexCommandCompletions(new CompletionContext(state, doc.length, false));
  const option = result?.options.find((candidate) => candidate.label === label);
  if (!option || typeof option.apply !== "function") throw new Error(`Missing completion ${label}`);
  view = new EditorView({ state, parent: document.body });
  option.apply(view, option, result?.from ?? doc.length - 1, doc.length);
  return view.state.doc.toString().slice(source.length + 1);
}

describe("document macro catalog for classic definitions", () => {
  it("describes plain, optional-only and required-only macros", () => {
    const source = String.raw`\newcommand\plain{x}
\newcommand{\opt}[1][d]{#1}
\renewcommand*{\two}[2]{#1#2}`;
    expect(find(source, "\\plain").detail).toBe("document macro");
    expect(find(source, "\\opt").detail).toBe("document macro · 1 optional argument");
    expect(find(source, "\\two").detail).toBe("document macro · 2 arguments");
    expect(inserted(source, "\\plain")).toBe("\\plain");
    expect(inserted(source, "\\opt")).toBe("\\opt[d]");
    expect(inserted(source, "\\two")).toBe("\\two{}{}");
  });

  it("skips definitions without a usable name, count or body", () => {
    const names = labels(String.raw`\newcommand{bad}{x}
\newcommand{\badcount}[a]{y}
\newcommand{\nobody}
\newcommand{\two words}{z}`);
    expect(names).not.toContain("bad");
    expect(names).not.toContain("\\badcount");
    expect(names).not.toContain("\\nobody");
    expect(names.some((name) => name.startsWith("\\two"))).toBe(false);
  });
});

describe("document macro catalog for xparse definitions", () => {
  it("builds a snippet for every argument type", () => {
    const source = String.raw`\NewDocumentCommand{\all}{+m !o >{\TrimSpaces}m b v s t* d<> D(){x} R[]{y} e{^_} E{^_}{{a}{b}} O{}}{}`;
    expect(find(source, "\\all").detail).toContain("xparse +m !o");
    expect(inserted(source, "\\all")).toBe(String.raw`\all{}[]{}{}{}<>()[][]`);
  });

  it("describes a command without arguments", () => {
    expect(find(String.raw`\DeclareDocumentCommand{\none}{}{x}`, "\\none").detail).toBe(
      "document macro · xparse no arguments",
    );
  });

  it("skips xparse definitions with an invalid specification, a bad name or no body", () => {
    const names = labels(String.raw`\NewDocumentCommand{\bad}{Z}{x}
\NewDocumentCommand{nope}{m}{x}
\NewDocumentCommand{\unfinished}{m}
\NewDocumentCommand{\nospec}`);
    for (const name of ["\\bad", "nope", "\\unfinished", "\\nospec"]) expect(names).not.toContain(name);
  });
});

describe("document macro catalog for primitive definitions", () => {
  it("counts parameter markers and requires a body", () => {
    const source = String.raw`\def\prim#1#2{#1 #2}
\gdef\nobody#1
\edef\@at{x}`;
    expect(find(source, "\\prim").detail).toBe("document macro · 2 arguments");
    expect(inserted(source, "\\prim")).toBe("\\prim{}{}");
    expect(find(source, "\\@at").detail).toBe("document macro");
    expect(labels(source)).not.toContain("\\nobody");
  });
});

describe("loaded package commands", () => {
  it("reads every package in a list and ignores empty entries", () => {
    const names = labels(String.raw`\usepackage[final]{ amsmath , , siunitx }`);
    expect(names).toContain("\\dfrac");
    expect(names).toContain("\\num");
  });

  it("skips a package directive without a braced list", () => {
    expect(labels(String.raw`\usepackage booktabs
\usepackage{hyperref}`)).toContain("\\hypersetup");
    expect(labels(String.raw`\usepackage booktabs`)).not.toContain("\\toprule");
  });

  it("stops at an unclosed option or package list", () => {
    expect(labels(String.raw`\usepackage[draft{booktabs}`)).not.toContain("\\toprule");
    expect(labels(String.raw`\usepackage{booktabs`)).not.toContain("\\toprule");
  });
});

describe("explicit completion", () => {
  it("offers every command at an explicit request without a prefix", () => {
    const doc = "Text ";
    const state = EditorState.create({ doc });
    const result = latexCompletions(new CompletionContext(state, doc.length, true));
    expect(result?.from).toBe(doc.length);
    expect(result?.options.some((option) => option.label === "\\section")).toBe(true);
    expect(latexCompletions(new CompletionContext(state, doc.length, false))).toBeNull();
  });

  it("offers slash snippets after a slash and nothing elsewhere", () => {
    const doc = "Intro /sec";
    const state = EditorState.create({ doc });
    const result = slashCompletions(new CompletionContext(state, doc.length, false));
    expect(result?.from).toBe(doc.indexOf("/"));
    expect(result?.options.map((option) => option.label)).toContain("/section");
    const plain = EditorState.create({ doc: "Intro" });
    expect(slashCompletions(new CompletionContext(plain, 5, false))).toBeNull();
    const comment = EditorState.create({ doc: "% /sec" });
    expect(slashCompletions(new CompletionContext(comment, 6, false))).toBeNull();
  });
});
