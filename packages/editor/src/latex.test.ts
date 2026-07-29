// @vitest-environment jsdom

import {
  acceptCompletion,
  autocompletion,
  CompletionContext,
  completionStatus,
  currentCompletions,
  startCompletion,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  latexCommandCompletions,
  latexCompletions,
  setBibKeysProvider,
  slashCompletions,
} from "./latex";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

function completion(
  source: string,
  full = false,
  explicit = false,
): CompletionResult | null {
  const state = EditorState.create({ doc: source });
  const context = new CompletionContext(
    state,
    state.doc.length,
    explicit,
  );
  return full
    ? latexCompletions(context)
    : latexCommandCompletions(context);
}

function option(
  result: CompletionResult | null,
  label: string,
): Completion {
  const found = result?.options.find(
    (candidate) => candidate.label === label,
  );
  if (!found) throw new Error(`Missing completion ${label}`);
  return found;
}

afterEach(() => {
  setBibKeysProvider(() => []);
  document.body.replaceChildren();
});

describe("recovery-oriented LaTeX completion", () => {
  it("opens static command suggestions automatically while async language sources are unavailable", async () => {
    const unavailableLanguageService = async () => null;
    const unavailableProjectIndex = () => null;
    const state = EditorState.create({
      doc: "",
      extensions: [
        autocompletion({
          activateOnTyping: true,
          activateOnTypingDelay: 0,
          updateSyncTime: 20,
          override: [
            unavailableLanguageService,
            unavailableProjectIndex,
            latexCommandCompletions,
            slashCompletions,
          ],
        }),
      ],
    });
    const view = new EditorView({
      state,
      parent: document.body,
    });

    view.dispatch({
      changes: { from: 0, insert: "\\tex" },
      selection: { anchor: 4 },
      annotations: Transaction.userEvent.of("input.type"),
    });

    await vi.waitFor(() => {
      expect(completionStatus(view.state)).toBe("active");
      expect(
        currentCompletions(view.state).map(
          (candidate) => candidate.label,
        ),
      ).toEqual(
        expect.arrayContaining([
          "\\textbf",
          "\\textit",
          "\\texttt",
          "\\textcolor",
        ]),
      );
    });
    view.destroy();
  });

  it("completes current-document command definitions beside malformed source", () => {
    const source =
      "\\newcommand{\\widget}[2]{#1 + #2}\n" +
      "\\def\\legacy#1{#1}\n" +
      "\\section{Unclosed\n" +
      "\\wid";
    const result = completion(source);
    expect(option(result, "\\widget").detail).toContain("2 arguments");
    expect(option(result, "\\legacy").detail).toContain("1 argument");
  });

  it("excludes definitions and labels hidden in comments or verbatim content", () => {
    const source = String.raw`% \newcommand{\commented}[1]{#1}
\begin{verbatim}
\newcommand{\verbatimonly}[1]{#1}
\label{hidden}
\end{verbatim}
\newcommand{\visible}[1]{#1}
\vis`;
    const result = completion(source);
    expect(option(result, "\\visible")).toBeTruthy();
    expect(
      result?.options.some(
        (candidate) => candidate.label === "\\commented",
      ),
    ).toBe(false);
    expect(
      result?.options.some(
        (candidate) => candidate.label === "\\verbatimonly",
      ),
    ).toBe(false);

    const reference = completion(
      `${source}\n\\label{shown}\n\\ref{`,
      true,
    );
    expect(option(reference, "shown")).toBeTruthy();
    expect(
      reference?.options.some(
        (candidate) => candidate.label === "hidden",
      ),
    ).toBe(false);
  });

  it("does not offer completion inside comments or inline-verbatim bodies", () => {
    expect(completion("% \\\\sec")).toBeNull();
    expect(completion(String.raw`\verb|\sec`)).toBeNull();
    expect(completion(String.raw`\lstinline[language=TeX]!\sec`)).toBeNull();
    expect(completion(String.raw`\mintinline{latex}|\sec`)).toBeNull();
    expect(
      option(completion(String.raw`\verb|code|\sec`), "\\section"),
    ).toBeTruthy();
  });

  it("preserves classic optional defaults and xparse argument specs in snippets", () => {
    const classicSource =
      String.raw`\newcommand{\widget}[2][wide]{#1/#2}` + "\n\\wid";
    const classicState = EditorState.create({ doc: classicSource });
    const classicResult = latexCommandCompletions(
      new CompletionContext(
        classicState,
        classicState.doc.length,
        false,
      ),
    );
    const classic = option(classicResult, "\\widget");
    expect(classic.detail).toContain("1 optional + 1 required");
    const classicView = new EditorView({
      state: classicState,
      parent: document.body,
    });
    (
      classic.apply as Exclude<
        Completion["apply"],
        string | undefined
      >
    )(
      classicView,
      classic,
      classicResult?.from ?? classicState.doc.length - 4,
      classicState.doc.length,
    );
    expect(classicView.state.doc.toString()).toContain(
      "\\widget[wide]{}",
    );
    classicView.destroy();

    const xparseSource =
      String.raw`\NewDocumentCommand{\modern}{m O{fallback} r()}{#1}` +
      "\n\\mod";
    const xparseState = EditorState.create({ doc: xparseSource });
    const xparseResult = latexCommandCompletions(
      new CompletionContext(
        xparseState,
        xparseState.doc.length,
        false,
      ),
    );
    const xparse = option(xparseResult, "\\modern");
    expect(xparse.detail).toContain("m O{fallback} r()");
    const xparseView = new EditorView({
      state: xparseState,
      parent: document.body,
    });
    (
      xparse.apply as Exclude<
        Completion["apply"],
        string | undefined
      >
    )(
      xparseView,
      xparse,
      xparseResult?.from ?? xparseState.doc.length - 4,
      xparseState.doc.length,
    );
    expect(xparseView.state.doc.toString()).toContain(
      "\\modern{}[fallback]()",
    );
    xparseView.destroy();
  });

  it("parses control-sequence delimiters in local xparse snippets", () => {
    const source =
      String.raw`\NewDocumentCommand{\controlled}{r\foo\bar t\trigger m}{#1}` +
      "\n\\con";
    const state = EditorState.create({ doc: source });
    const result = latexCommandCompletions(
      new CompletionContext(state, state.doc.length, false),
    );
    const candidate = option(result, "\\controlled");
    expect(candidate.detail).toContain(
      String.raw`r\foo\bar t\trigger m`,
    );
    const view = new EditorView({
      state,
      parent: document.body,
    });
    (
      candidate.apply as Exclude<
        Completion["apply"],
        string | undefined
      >
    )(
      view,
      candidate,
      result?.from ?? state.doc.length - 4,
      state.doc.length,
    );
    expect(view.state.doc.toString()).toBe(
      String.raw`\NewDocumentCommand{\controlled}{r\foo\bar t\trigger m}{#1}` +
        "\n" +
        String.raw`\controlled\foo\bar{}`,
    );
    view.destroy();
  });

  it("completes standard and current-document environments at incomplete sites", () => {
    const source =
      "\\newenvironment{experiment}{\\begin{quote}}{\\end{quote}}\n" +
      "\\newtheorem{lemma}{Lemma}\n" +
      "\\begin{exp";
    const result = completion(source);
    expect(result?.from).toBe(source.length - 3);
    expect(option(result, "experiment").detail).toBe(
      "document environment",
    );
    expect(option(result, "lemma").detail).toBe("document environment");
    expect(option(result, "equation").detail).toContain("standard");
  });

  it("completes document classes, packages, and loaded-package commands", () => {
    const classSource = "\\documentclass{scr";
    const classResult = completion(classSource);
    expect(classResult?.from).toBe(classSource.length - 3);
    expect(option(classResult, "scrartcl").detail).toContain(
      "document class",
    );

    const packageSource = "\\usepackage{book";
    const packageResult = completion(packageSource);
    expect(packageResult?.from).toBe(packageSource.length - 4);
    expect(option(packageResult, "booktabs").detail).toContain("package");

    const commandResult = completion(
      "\\usepackage{booktabs}\n\\top",
    );
    expect(option(commandResult, "\\toprule").detail).toContain(
      "table top rule",
    );
  });

  it("handles optional package, class, and citation arguments without backtracking", () => {
    const packageSource =
      "\\RequirePackage [draft] {graphicx}\n\\rot";
    expect(option(completion(packageSource), "\\rotatebox")).toBeTruthy();

    const classSource = "\\documentclass[11pt]{scr";
    expect(option(completion(classSource), "scrartcl")).toBeTruthy();

    setBibKeysProvider(() => ["knuth1984"]);
    const citationSource = "\\cite*[see]{knu";
    const citation = completion(citationSource, true);
    expect(citation?.from).toBe(
      citationSource.length - "knu".length,
    );
    expect(option(citation, "knuth1984")).toBeTruthy();
  });

  it("bounds malformed structural completion input", () => {
    const repeated = 1_000;
    expect(completion("\\usepackage[".repeat(repeated))).toBeNull();
    expect(
      completion("\\documentclass[".repeat(repeated)),
    ).toBeNull();
    expect(
      completion("\\cite[".repeat(repeated), true),
    ).toBeNull();
  });

  it("replaces only the incomplete reference/citation query", () => {
    setBibKeysProvider(() => ["knuth1984", "lamport1994"]);
    const referenceSource =
      "\\label{sec:introduction}\n\\ref{sec:in";
    const reference = completion(referenceSource, true);
    expect(reference?.from).toBe(referenceSource.length - "sec:in".length);
    expect(option(reference, "sec:introduction")).toBeTruthy();

    const citationSource = "\\cite{knu";
    const citation = completion(citationSource, true);
    expect(citation?.from).toBe(citationSource.length - 3);
    expect(option(citation, "knuth1984")).toBeTruthy();
  });

  it("refuses to commit a current-document completion after the source revision changes", () => {
    const source = "\\newcommand{\\widget}[1]{#1}\n\\wid";
    const initial = EditorState.create({ doc: source });
    const result = latexCommandCompletions(
      new CompletionContext(initial, initial.doc.length, false),
    );
    const candidate = option(result, "\\widget");
    expect(typeof candidate.apply).toBe("function");

    const view = new EditorView({
      state: initial,
      parent: document.body,
    });
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "x" },
    });
    (
      candidate.apply as Exclude<
        Completion["apply"],
        string | undefined
      >
    )(
      view,
      candidate,
      result?.from ?? source.length - 4,
      source.length,
    );

    expect(view.state.doc.toString()).toBe(`${source}x`);
    view.destroy();
  });

  it("rejects same-text newer revisions and superseded completion requests", async () => {
    const source = "\\newcommand{\\widget}[1]{#1}\n\\wid";
    const initial = EditorState.create({ doc: source });
    const first = latexCommandCompletions(
      new CompletionContext(initial, initial.doc.length, false),
    );
    const firstCandidate = option(first, "\\widget");
    // A newer request against the same source revision supersedes the first.
    await Promise.resolve();
    latexCommandCompletions(
      new CompletionContext(initial, initial.doc.length, false),
    );
    const supersededView = new EditorView({
      state: initial,
      parent: document.body,
    });
    (
      firstCandidate.apply as Exclude<
        Completion["apply"],
        string | undefined
      >
    )(
      supersededView,
      firstCandidate,
      first?.from ?? source.length - 4,
      source.length,
    );
    expect(supersededView.state.doc.toString()).toBe(source);
    supersededView.destroy();

    const current = EditorState.create({ doc: source });
    const currentResult = latexCompletions(
      new CompletionContext(current, current.doc.length, true),
    );
    const standard = option(currentResult, "\\section");
    const newerSameText = current.update({
      changes: { from: 0, to: current.doc.length, insert: source },
    }).state;
    const newerView = new EditorView({
      state: newerSameText,
      parent: document.body,
    });
    (
      standard.apply as Exclude<
        Completion["apply"],
        string | undefined
      >
    )(
      newerView,
      standard,
      currentResult?.from ?? source.length,
      source.length,
    );
    expect(newerView.state.doc.toString()).toBe(source);
    newerView.destroy();
  });

  it("shares one request generation across the app's ordered override sources", () => {
    const source = "\\sec";
    const state = EditorState.create({ doc: source });
    const context = new CompletionContext(
      state,
      state.doc.length,
      false,
    );
    const projectSource = (_context: CompletionContext) => null;
    const results = [
      projectSource(context),
      latexCommandCompletions(context),
      slashCompletions(context),
    ];
    const commandResult = results[1];
    const candidate = option(commandResult, "\\section");
    const view = new EditorView({
      state,
      parent: document.body,
    });
    (
      candidate.apply as Exclude<
        Completion["apply"],
        string | undefined
      >
    )(
      view,
      candidate,
      commandResult?.from ?? 0,
      source.length,
    );
    expect(view.state.doc.toString()).toBe("\\section{}");
    view.destroy();
  });

  it("requeries guarded completions after a valid query edit before accepting", async () => {
    let sourceCalls = 0;
    const completionSource = (context: CompletionContext) => {
      sourceCalls += 1;
      return latexCommandCompletions(context);
    };
    const state = EditorState.create({
      doc: "\\sec",
      selection: { anchor: 4 },
      extensions: [
        autocompletion({
          activateOnTyping: false,
          override: [completionSource],
        }),
      ],
    });
    const view = new EditorView({
      state,
      parent: document.body,
    });

    expect(startCompletion(view)).toBe(true);
    await vi.waitFor(() => {
      expect({
        calls: sourceCalls,
        status: completionStatus(view.state),
        labels: currentCompletions(view.state).map(
          (candidate) => candidate.label,
        ),
      }).toMatchObject({
        status: "active",
        labels: expect.arrayContaining(["\\section"]),
      });
    });
    const callsBeforeEdit = sourceCalls;
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "t" },
      selection: { anchor: view.state.doc.length + 1 },
      annotations: Transaction.userEvent.of("input.type"),
    });
    await vi.waitFor(() => {
      expect(sourceCalls).toBeGreaterThan(callsBeforeEdit);
      expect(
        currentCompletions(view.state).some(
          (candidate) => candidate.label === "\\section",
        ),
      ).toBe(true);
    });

    expect(acceptCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\section{}");
    view.destroy();
  });

  it.each([
    {
      source: "\\begin{equ",
      full: false,
      label: "equation",
    },
    {
      source: "\\label{sec:one}\n\\ref{sec:",
      full: true,
      label: "sec:one",
    },
    {
      source: "\\cite{k",
      full: true,
      label: "knuth1984",
    },
  ])(
    "revision-guards structural/reference/citation completion $label",
    ({ source, full, label }) => {
      setBibKeysProvider(() => ["knuth1984"]);
      const initial = EditorState.create({ doc: source });
      const result = full
        ? latexCompletions(
            new CompletionContext(
              initial,
              initial.doc.length,
              false,
            ),
          )
        : latexCommandCompletions(
            new CompletionContext(
              initial,
              initial.doc.length,
              false,
            ),
          );
      const candidate = option(result, label);
      const newer = initial.update({
        changes: {
          from: 0,
          to: initial.doc.length,
          insert: source,
        },
      }).state;
      const view = new EditorView({
        state: newer,
        parent: document.body,
      });
      (
        candidate.apply as Exclude<
          Completion["apply"],
          string | undefined
        >
      )(
        view,
        candidate,
        result?.from ?? source.length,
        source.length,
      );
      expect(view.state.doc.toString()).toBe(source);
      view.destroy();
    },
  );
});
