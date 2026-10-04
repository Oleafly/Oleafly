// @vitest-environment jsdom

import { type Diagnostic, forceLinting, forEachDiagnostic, setDiagnostics } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROOFREADING_PROTOCOL_VERSION, type ProofreadingResult } from "./proofreading";
import {
  cancelSourceProofreading,
  clearEditorProofreadingDiagnostics,
  createHarperLinter,
  createSpellLinter,
  proofreadingActionHost,
  type ProofreadingActionHost,
  refreshEditorLints,
  setProofreadingActionHost,
  type GrammarDiag,
  type SpellHost,
  setSpellHost,
  spellLintExtensions,
} from "./spellcheck";
import { englishEditorMessage, installEnglishEditorMessages } from "./test-messages";

installEnglishEditorMessages();

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function spellHost(overrides: Partial<SpellHost> = {}): SpellHost {
  const host: SpellHost = {
    t: englishEditorMessage,
    getProjectId: () => "project",
    getActivePath: () => "main.tex",
    getLintPrefs: () => ({ showRegionalism: false, showWordChoice: false }),
    isSessionIgnored: () => false,
    isWordIgnored: () => false,
    ignoreWordForProject: vi.fn(),
    ignoreWordGlobally: vi.fn(),
    ...overrides,
  };
  setSpellHost(host);
  return host;
}

function mount(doc: string, extension: Extension): EditorView {
  view = new EditorView({ state: EditorState.create({ doc, extensions: [extension] }), parent: document.body });
  return view;
}

function diagnostics(editor: EditorView): Diagnostic[] {
  const found: Diagnostic[] = [];
  forEachDiagnostic(editor.state, (diagnostic) => found.push(diagnostic));
  return found;
}

async function linted(editor: EditorView, count: number): Promise<Diagnostic[]> {
  forceLinting(editor);
  await vi.waitFor(() => expect(diagnostics(editor)).toHaveLength(count), { timeout: 2_000 });
  return diagnostics(editor);
}

function flagged(editor: EditorView, found: Diagnostic[]): string[] {
  return found.map((diagnostic) => editor.state.sliceDoc(diagnostic.from, diagnostic.to));
}

describe("local grammar fallback", () => {
  it("flags repeated words and common typos when no grammar engine is available", async () => {
    spellHost();
    const editor = mount("We recieve the the data.", createHarperLinter());
    const found = await linted(editor, 2);
    expect(flagged(editor, found)).toEqual(["recieve", "the the"]);
    const typo = found[0];
    expect(typo.actions?.map((action) => action.name)).toEqual([
      "“receive”",
      "Ignore “recieve” in this project",
      "Ignore “recieve” everywhere",
    ]);
    typo.actions?.[0].apply(editor, typo.from, typo.to);
    expect(editor.state.doc.toString()).toBe("We receive the the data.");
  });

  it("resolves the project when ignoring a word and skips it without a project", async () => {
    let project: string | null = "project";
    const host = spellHost({ getProjectId: () => project });
    const editor = mount("We recieve data.", createHarperLinter());
    const [typo] = await linted(editor, 1);
    project = null;
    typo.actions?.[1].apply(editor, typo.from, typo.to);
    expect(host.ignoreWordForProject).not.toHaveBeenCalled();
    project = "next";
    typo.actions?.[1].apply(editor, typo.from, typo.to);
    expect(host.ignoreWordForProject).toHaveBeenCalledWith("next", "recieve");
    typo.actions?.[2].apply(editor, typo.from, typo.to);
    expect(host.ignoreWordGlobally).toHaveBeenCalledWith("recieve");
  });

  it("offers only the global ignore outside a project and skips ignored words", async () => {
    spellHost({ getProjectId: () => null, isWordIgnored: (_project, word) => word === "seperate" });
    const editor = mount("We recieve seperate data.", createHarperLinter());
    const [typo] = await linted(editor, 1);
    expect(typo.actions?.map((action) => action.name)).toEqual(["“receive”", "Ignore “recieve” everywhere"]);
  });

  it("checks Markdown and Typst prose and skips typo hints for other languages", async () => {
    spellHost({ getActivePath: () => "notes.md" });
    const markdown = mount("Text `teh code` and teh end.", createHarperLinter());
    expect(flagged(markdown, await linted(markdown, 1))).toEqual(["teh"]);
    markdown.destroy();
    spellHost({ getActivePath: () => "doc.typ" });
    const typst = mount("Text $teh$ and teh end.", createHarperLinter());
    expect(flagged(typst, await linted(typst, 1))).toEqual(["teh"]);
    typst.destroy();
    spellHost({ getDictionaryLocale: () => "de_DE" });
    const german = mount("Das das teh.", createHarperLinter());
    expect(flagged(german, await linted(german, 1))).toEqual(["Das das"]);
  });

  it("ignores files that are not prose documents", async () => {
    const lintGrammar = vi.fn(async () => []);
    const getActivePath = vi.fn(() => "data.json");
    spellHost({ getActivePath, lintGrammar });
    const editor = mount("teh teh", createHarperLinter());
    forceLinting(editor);
    await vi.waitFor(() => expect(getActivePath).toHaveBeenCalled(), { timeout: 2_000 });
    expect(diagnostics(editor)).toEqual([]);
    expect(lintGrammar).not.toHaveBeenCalled();
  });
});

describe("main-thread grammar linting", () => {
  it("maps findings back to the source and hides muted categories and ignored words", async () => {
    const lintGrammar = vi.fn(async (prose: string): Promise<GrammarDiag[]> => {
      const at = (word: string) => prose.indexOf(word);
      return [
        { from: at("colour"), to: at("colour") + 6, message: "Regional spelling", kind: "Regionalism", suggestions: [] },
        { from: at("utilize"), to: at("utilize") + 7, message: "Simpler word", kind: "WordChoice", suggestions: [] },
        {
          from: at("an"),
          to: at("an") + 2,
          message: "Use a",
          kind: "Miscellaneous",
          suggestions: [
            { text: "a", kind: 0 },
            { text: "x".repeat(50), kind: 2 },
            { text: "", kind: 1 },
          ],
        },
        { from: at("skipme"), to: at("skipme") + 6, message: "Ignored", kind: "Miscellaneous", suggestions: [] },
        { from: prose.length + 5, to: prose.length + 9, message: "Outside", kind: "Miscellaneous", suggestions: [] },
      ];
    });
    spellHost({ lintGrammar, isWordIgnored: (_project, word) => word === "skipme" });
    const editor = mount("\\section{Intro}\nThe colour, utilize an book skipme.", createHarperLinter());
    const [finding] = await linted(editor, 1);
    expect(editor.state.sliceDoc(finding.from, finding.to)).toBe("an");
    expect(finding.actions?.map((action) => action.name).slice(0, 3)).toEqual([
      "“a”",
      `Add “${"x".repeat(43)}…”`,
      "Remove",
    ]);
    finding.actions?.[1].apply(editor, finding.from, finding.to);
    expect(editor.state.doc.toString()).toContain(`an${"x".repeat(50)} book`);
  });

  it("removes text with a remove suggestion", async () => {
    spellHost({
      lintGrammar: async (prose) => [
        { from: prose.indexOf("very"), to: prose.indexOf("very") + 4, message: "Wordy", kind: "Style", suggestions: [{ text: "", kind: 1 }] },
      ],
    });
    const editor = mount("A very good day.", createHarperLinter());
    const [finding] = await linted(editor, 1);
    finding.actions?.[0].apply(editor, finding.from, finding.to);
    expect(editor.state.doc.toString()).toBe("A  good day.");
  });

  it("shows muted categories when the preferences allow them", async () => {
    spellHost({
      getLintPrefs: () => ({ showRegionalism: true, showWordChoice: true }),
      lintGrammar: async (prose) => [
        { from: prose.indexOf("colour"), to: prose.indexOf("colour") + 6, message: "Regional", kind: "Regionalism", suggestions: [] },
      ],
    });
    const editor = mount("The colour.", createHarperLinter());
    expect(flagged(editor, await linted(editor, 1))).toEqual(["colour"]);
  });

  it("falls back to the local checks when the grammar engine fails or the document is huge", async () => {
    const failing = vi.fn(async () => {
      throw new Error("wasm");
    });
    spellHost({ lintGrammar: failing });
    const editor = mount("We recieve data.", createHarperLinter());
    expect(flagged(editor, await linted(editor, 1))).toEqual(["recieve"]);
    editor.destroy();
    const lintGrammar = vi.fn(async () => []);
    spellHost({ lintGrammar });
    const huge = mount(`${"Plain words here. ".repeat(9_000)}We recieve data.`, createHarperLinter());
    expect(flagged(huge, await linted(huge, 1))).toEqual(["recieve"]);
    expect(lintGrammar).not.toHaveBeenCalled();
  });
});

describe("main-thread spell checking", () => {
  it("flags words the dictionary rejects and skips short, session-ignored and ignored words", async () => {
    spellHost({
      getSpellchecker: async () => ({ spell: (word: string) => word !== "wrod" && word !== "nope" && word !== "mine" }),
      isSessionIgnored: (word) => word === "nope",
      isWordIgnored: (_project, word) => word === "mine",
    });
    const editor = mount("A wrod and nope and mine and x.", createSpellLinter());
    const [finding] = await linted(editor, 1);
    expect(editor.state.sliceDoc(finding.from, finding.to)).toBe("wrod");
    expect(finding.message).toBe('Possible misspelling: "wrod"');
  });

  it("reads Markdown and Typst prose ranges", async () => {
    spellHost({ getActivePath: () => "a.md", getSpellchecker: async () => ({ spell: (word: string) => word !== "wrod" }) });
    const markdown = mount("`wrod` and wrod", createSpellLinter());
    expect(flagged(markdown, await linted(markdown, 1))).toEqual(["wrod"]);
    markdown.destroy();
    spellHost({ getActivePath: () => "a.typ", getSpellchecker: async () => ({ spell: (word: string) => word !== "wrod" }) });
    const typst = mount("$wrod$ and wrod", createSpellLinter());
    expect(flagged(typst, await linted(typst, 1))).toEqual(["wrod"]);
  });

  it("reports nothing without a spellchecker", async () => {
    const getProjectId = vi.fn(() => "project");
    spellHost({ getProjectId });
    const editor = mount("wrod", createSpellLinter());
    forceLinting(editor);
    await vi.waitFor(() => expect(getProjectId).toHaveBeenCalled(), { timeout: 2_000 });
    expect(diagnostics(editor)).toEqual([]);
  });
});

describe("spellLintExtensions", () => {
  it("installs one proofreading linter for any combination of switches", () => {
    expect(spellLintExtensions()).toHaveLength(0);
    expect(spellLintExtensions({ spell: true })).toHaveLength(1);
    expect(spellLintExtensions({ harper: true })).toHaveLength(1);
    expect(spellLintExtensions({ spell: true, harper: true })).toHaveLength(1);
  });
});

function workerResult(text: string, word: string, status: ProofreadingResult["status"] = "ready"): ProofreadingResult {
  const from = text.indexOf(word);
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: 1,
    identity: { projectId: "project", path: "main.tex", revision: 1, requestGeneration: 1, surface: "source" },
    status,
    diagnostics:
      status === "ready"
        ? [
            {
              from,
              to: from + word.length,
              message: "Possible misspelling",
              kind: "Spelling",
              source: "hunspell",
              word,
              suggestions: [],
              rule: null,
            },
          ]
        : [],
  };
}

describe("worker proofreading", () => {
  it.each([
    ["main.tex", "latex"],
    ["notes.markdown", "markdown"],
    ["paper.typ", "typst"],
  ])("sends %s to the worker as %s", async (path, format) => {
    const text = "A wrod here.";
    const proofread = vi.fn(async () => workerResult(text, "wrod"));
    spellHost({ getActivePath: () => path, proofread });
    const editor = mount(text, createSpellLinter());
    expect(flagged(editor, await linted(editor, 1))).toEqual(["wrod"]);
    expect(proofread).toHaveBeenCalledWith(expect.objectContaining({ format, mode: "spelling", path }));
  });

  it("does not send other files to the worker", async () => {
    const proofread = vi.fn(async () => workerResult("x", "x"));
    const getProjectId = vi.fn(() => "project");
    spellHost({ getActivePath: () => "data.csv", proofread, getProjectId });
    const editor = mount("A wrod here.", createSpellLinter());
    forceLinting(editor);
    await vi.waitFor(() => expect(getProjectId).toHaveBeenCalled(), { timeout: 2_000 });
    expect(proofread).not.toHaveBeenCalled();
    expect(diagnostics(editor)).toEqual([]);
  });

  it("clears earlier findings when the worker skips the document", async () => {
    const text = "A wrod here.";
    let status: ProofreadingResult["status"] = "ready";
    spellHost({ proofread: async () => workerResult(text, "wrod", status) });
    const editor = mount(text, createSpellLinter());
    await linted(editor, 1);
    status = "too_large";
    refreshEditorLints(editor);
    await vi.waitFor(() => expect(diagnostics(editor)).toEqual([]), { timeout: 2_000 });
  });

  it("clears proofreading findings but keeps other diagnostics", async () => {
    const text = "A wrod here.";
    spellHost({ proofread: async () => workerResult(text, "wrod") });
    const editor = mount(text, createHarperLinter(true));
    await linted(editor, 1);
    editor.dispatch(
      setDiagnostics(editor.state, [
        ...diagnostics(editor),
        { from: 7, to: 11, severity: "error", message: "Syntax problem", source: "syntax" },
      ]),
    );
    clearEditorProofreadingDiagnostics(editor);
    expect(diagnostics(editor).map((diagnostic) => diagnostic.message)).toEqual(["Syntax problem"]);
    expect(() => clearEditorProofreadingDiagnostics(null)).not.toThrow();
  });

  it("re-runs the linters on request", async () => {
    let calls = 0;
    const text = "A wrod here.";
    spellHost({
      proofread: async () => {
        calls += 1;
        return workerResult(text, "wrod");
      },
    });
    const editor = mount(text, createSpellLinter());
    await linted(editor, 1);
    const before = calls;
    refreshEditorLints(editor);
    await vi.waitFor(() => expect(calls).toBeGreaterThan(before), { timeout: 2_000 });
    expect(() => refreshEditorLints(null)).not.toThrow();
  });

  it("forwards cancellation to the host and exposes the action host", () => {
    const cancelProofreading = vi.fn();
    spellHost({ cancelProofreading });
    cancelSourceProofreading("main.tex");
    expect(cancelProofreading).toHaveBeenCalledWith("source", "main.tex");
    const actions = { notify: vi.fn() } as unknown as ProofreadingActionHost;
    setProofreadingActionHost(actions);
    expect(proofreadingActionHost()).toBe(actions);
    setProofreadingActionHost(null);
    expect(proofreadingActionHost()).toBeNull();
  });
});
