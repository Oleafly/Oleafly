// @vitest-environment jsdom

import {
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
import {
  latexCommandCompletions,
  setEditorDocumentPath,
  slashCompletions,
} from "@oleafly/editor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  projectIntelligenceCompletion,
  projectIntelligenceExtensions,
} from "./project-intelligence";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

function snapshot(
  sources: Readonly<Record<string, string>>,
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path,
      analyzeProjectFile(path, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: {
      projectId: "completion-project",
      projectRevision: 1,
      requestGeneration: 1,
    },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: "main.tex",
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: Object.values(sources).reduce(
        (total, source) => total + source.length,
        0,
      ),
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

function installProject(
  sources: Readonly<Record<string, string>>,
): ProjectIntelligenceSnapshot {
  const value = snapshot(sources);
  useFilesStore.setState({
    projectId: "completion-project",
    activePath: "main.tex",
    files: Object.fromEntries(
      Object.entries(sources).map(([path, content]) => [
        path,
        { content, dirty: false },
      ]),
    ),
  });
  useIndexStore.setState({
    texts: { ...sources },
    intelligenceState: {
      status: "success",
      identity: value.identity,
      data: value,
      stale: false,
    },
  });
  setEditorDocumentPath("main.tex");
  return value;
}

function synchronousProjectCompletion(
  context: CompletionContext,
): CompletionResult | null {
  const value = projectIntelligenceCompletion(context);
  if (
    value &&
    typeof (value as Promise<CompletionResult | null>).then ===
      "function"
  ) {
    throw new Error("Expected synchronous project completion");
  }
  return value as CompletionResult | null;
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

function apply(
  view: EditorView,
  result: CompletionResult,
  candidate: Completion,
  to: number,
): void {
  if (typeof candidate.apply !== "function") {
    throw new Error("Expected guarded completion apply");
  }
  candidate.apply(view, candidate, result.from, to);
}

afterEach(() => {
  setEditorDocumentPath(null);
  useIndexStore.getState().reset();
  useFilesStore.setState({
    projectId: null,
    activePath: null,
    tree: [],
    files: {},
  });
  document.body.replaceChildren();
});

describe("project LaTeX completion revisions and argument parity", () => {
  it("keeps a project macro valid through later app-order override sources", () => {
    const source = "\\clas";
    installProject({
      "main.tex": source,
      "macros.sty":
        String.raw`\newcommand{\classic}[2][wide]{#1/#2}`,
    });
    const state = EditorState.create({ doc: source });
    const context = new CompletionContext(
      state,
      state.doc.length,
      false,
    );
    const project = synchronousProjectCompletion(context);
    // This is the production override order after project completion.
    latexCommandCompletions(context);
    slashCompletions(context);

    const candidate = option(project, "classic");
    const view = new EditorView({
      state,
      parent: document.body,
    });
    apply(view, project as CompletionResult, candidate, source.length);
    expect(view.state.doc.toString()).toBe(
      "\\classic[wide]{}",
    );
    view.destroy();
  });

  it("inserts cross-file xparse environment arguments after the closing name brace", () => {
    const source = "\\begin{modern}";
    installProject({
      "main.tex": source,
      "macros.sty":
        String.raw`\NewDocumentEnvironment{modernenv}{m o}{}{} `,
    });
    const state = EditorState.create({ doc: source });
    const cursor = source.length - 1;
    const result = synchronousProjectCompletion(
      new CompletionContext(state, cursor, false),
    );
    const candidate = option(result, "modernenv");
    const view = new EditorView({
      state,
      parent: document.body,
    });
    apply(view, result as CompletionResult, candidate, cursor);
    expect(view.state.doc.toString()).toBe(
      "\\begin{modernenv}{}[]",
    );
    view.destroy();
  });

  it("rejects project completion after an edit-away/edit-back same-text revision", () => {
    const source = "\\clas";
    installProject({
      "main.tex": source,
      "macros.sty":
        String.raw`\newcommand{\classic}[1]{#1}`,
    });
    const initial = EditorState.create({ doc: source });
    const result = synchronousProjectCompletion(
      new CompletionContext(
        initial,
        initial.doc.length,
        false,
      ),
    );
    const candidate = option(result, "classic");
    const view = new EditorView({
      state: initial,
      parent: document.body,
    });
    view.dispatch({
      changes: { from: 0, to: source.length, insert: "\\other" },
    });
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: source,
      },
    });
    apply(
      view,
      result as CompletionResult,
      candidate,
      source.length,
    );
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });

  it("requeries beyond the initial result cap so every project symbol is reachable", () => {
    const source = "\\needle";
    const bulkMacros = Array.from({ length: 260 }, (_, index) => {
      const suffix = String.fromCharCode(
        97 + Math.floor(index / 26),
        97 + (index % 26),
      );
      return String.raw`\newcommand{\macro${suffix}}{}`;
    });
    installProject({
      "main.tex": source,
      "macros.sty": [
        ...bulkMacros,
        String.raw`\newcommand{\needletarget}[1]{#1}`,
      ].join("\n"),
    });
    const state = EditorState.create({ doc: source });

    const initial = synchronousProjectCompletion(
      new CompletionContext(state, 1, false),
    );
    expect(initial?.options).toHaveLength(200);
    expect(
      initial?.options.some(
        (candidate) => candidate.label === "needletarget",
      ),
    ).toBe(false);

    const narrowed = synchronousProjectCompletion(
      new CompletionContext(state, state.doc.length, false),
    );
    expect(narrowed?.validFor).toBeUndefined();
    expect(option(narrowed, "needletarget")).toBeTruthy();
  });

  it("requeries item 261 through the mounted production lifecycle without a nested update", async () => {
    const initialSource = "\\";
    const narrowedSource = "\\needle";
    const bulkMacros = Array.from({ length: 260 }, (_, index) => {
      const suffix = String.fromCharCode(
        97 + Math.floor(index / 26),
        97 + (index % 26),
      );
      return String.raw`\newcommand{\macro${suffix}}{}`;
    });
    const macros = [
      ...bulkMacros,
      String.raw`\newcommand{\needletarget}[1]{#1}`,
    ].join("\n");
    installProject({
      "main.tex": initialSource,
      "macros.sty": macros,
    });

    const state = EditorState.create({
      doc: initialSource,
      selection: { anchor: initialSource.length },
      extensions: [
        autocompletion({
          activateOnTyping: false,
          override: [projectIntelligenceCompletion],
        }),
        ...projectIntelligenceExtensions(),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          installProject({
            "main.tex": update.state.doc.toString(),
            "macros.sty": macros,
          });
        }),
      ],
    });
    const view = new EditorView({
      state,
      parent: document.body,
    });

    expect(startCompletion(view)).toBe(true);
    await vi.waitFor(() => {
      expect(completionStatus(view.state)).toBe("active");
      expect(currentCompletions(view.state)).toHaveLength(200);
      expect(
        currentCompletions(view.state).some(
          (candidate) => candidate.label === "needletarget",
        ),
      ).toBe(false);
    });

    expect(() => {
      view.dispatch({
        changes: {
          from: view.state.doc.length,
          insert: narrowedSource.slice(initialSource.length),
        },
        selection: { anchor: narrowedSource.length },
        annotations: Transaction.userEvent.of("input.type"),
      });
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(view.state.doc.toString()).toBe(narrowedSource);
      expect(completionStatus(view.state)).toBe("active");
      expect(
        currentCompletions(view.state).some(
          (candidate) => candidate.label === "needletarget",
        ),
      ).toBe(true);
    });
    const target = currentCompletions(view.state).find(
      (candidate) => candidate.label === "needletarget",
    );
    if (typeof target?.apply !== "function") {
      throw new Error("Expected guarded item 261 completion");
    }
    target.apply(
      view,
      target,
      initialSource.length,
      view.state.doc.length,
    );
    expect(view.state.doc.toString()).toBe("\\needletarget{}");
    await Promise.resolve();
    view.destroy();
  });
});
