// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forceLinting,
  forEachDiagnostic,
  setDiagnostics,
} from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { diagnosticCardSource } from "./diagnostic-card";
import {
  createHarperLinter,
  refreshEditorProofreadingPresentation,
  setSpellHost,
} from "./spellcheck";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingResult,
} from "./proofreading";

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

describe("proofreading presentation refresh", () => {
  it("repaints a cached presentation page synchronously", async () => {
    const text = "qwertzuiopz remains observable";
    let showRequestedPage = false;
    let finishProofreading = (_result: ProofreadingResult): void => {
      throw new Error("proofreading did not start");
    };
    const proofread = vi.fn(
      () =>
        new Promise<ProofreadingResult>((resolve) => {
          finishProofreading = resolve;
        }),
    );
    setSpellHost({
      getProjectId: () => "project",
      getActivePath: () => "main.tex",
      getLintPrefs: () => ({
        showRegionalism: true,
        showWordChoice: true,
        dialect: "american",
      }),
      proofread,
      presentDiagnostics: (result) =>
        showRequestedPage ? result.diagnostics : [],
      isSessionIgnored: () => false,
      isWordIgnored: () => false,
      ignoreWordForProject: () => undefined,
      ignoreWordGlobally: () => undefined,
    });

    view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [createHarperLinter(true)],
      }),
      parent: document.body,
    });
    forceLinting(view);
    await vi.waitFor(() => expect(proofread).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });
    finishProofreading({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result",
      requestId: 1,
      identity: {
        projectId: "project",
        path: "main.tex",
        revision: 1,
        requestGeneration: 1,
        surface: "source",
      },
      status: "ready",
      diagnostics: [
        {
          from: 0,
          to: "qwertzuiopz".length,
          message: "Possible misspelling",
          kind: "Spelling",
          source: "hunspell",
          word: "qwertzuiopz",
          suggestions: [],
        },
      ],
    });
    await vi.waitFor(
      () => expect(proofread).toHaveBeenCalledOnce(),
      { timeout: 2_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(diagnosticCardSource(view, 1)).toBeNull();
    view.dispatch(
      setDiagnostics(view.state, [
        {
          from: 12,
          to: 19,
          severity: "error",
          message: "Independent syntax diagnostic",
          source: "syntax",
        },
      ]),
    );

    showRequestedPage = true;
    refreshEditorProofreadingPresentation(view);

    expect(diagnosticCardSource(view, 1)).not.toBeNull();
    const messages: string[] = [];
    forEachDiagnostic(view.state, (diagnostic) => {
      messages.push(diagnostic.message);
    });
    expect(messages).toContain("Independent syntax diagnostic");
    expect(proofread).toHaveBeenCalledOnce();
  });

  it("keeps the requested page when an older lint result settles afterward", async () => {
    const text = "qwertzuiopz remains observable";
    let requestedPage = false;
    let injectedPageChange = false;
    const result: ProofreadingResult = {
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result",
      requestId: 1,
      identity: {
        projectId: "project",
        path: "main.tex",
        revision: 1,
        requestGeneration: 1,
        surface: "source",
      },
      status: "ready",
      diagnostics: [
        {
          from: 0,
          to: "qwertzuiopz".length,
          message: "Possible misspelling",
          kind: "Spelling",
          source: "hunspell",
          word: "qwertzuiopz",
          suggestions: [],
        },
      ],
    };
    const proofread = vi.fn(async () => result);
    setSpellHost({
      getProjectId: () => "project",
      getActivePath: () => "main.tex",
      getLintPrefs: () => ({
        showRegionalism: true,
        showWordChoice: true,
        dialect: "american",
      }),
      proofread,
      presentDiagnostics: (workerResult) => {
        if (!injectedPageChange) {
          injectedPageChange = true;
          requestedPage = true;
          refreshEditorProofreadingPresentation(view);
          // This represents the older page that was already being returned
          // when the user selected the new bounded diagnostics page.
          return [];
        }
        return requestedPage ? workerResult.diagnostics : [];
      },
      isSessionIgnored: () => false,
      isWordIgnored: () => false,
      ignoreWordForProject: () => undefined,
      ignoreWordGlobally: () => undefined,
    });

    view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [createHarperLinter(true)],
      }),
      parent: document.body,
    });
    forceLinting(view);

    await vi.waitFor(
      () => expect(diagnosticCardSource(view!, 1)).not.toBeNull(),
      { timeout: 2_000 },
    );
    expect(proofread).toHaveBeenCalledOnce();
  });

  it("coalesces a presentation refresh with an in-flight document pass", async () => {
    const text = "qwertzuiopz remains observable";
    let showRequestedPage = false;
    let finishProofreading = (_result: ProofreadingResult): void => {
      throw new Error("proofreading did not start");
    };
    const proofread = vi.fn(
      () =>
        new Promise<ProofreadingResult>((resolve) => {
          finishProofreading = resolve;
        }),
    );
    setSpellHost({
      getProjectId: () => "project",
      getActivePath: () => "main.tex",
      getLintPrefs: () => ({
        showRegionalism: true,
        showWordChoice: true,
        dialect: "american",
      }),
      proofread,
      presentDiagnostics: (result) =>
        showRequestedPage ? result.diagnostics : [],
      isSessionIgnored: () => false,
      isWordIgnored: () => false,
      ignoreWordForProject: () => undefined,
      ignoreWordGlobally: () => undefined,
    });

    view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [createHarperLinter(true)],
      }),
      parent: document.body,
    });
    forceLinting(view);
    await vi.waitFor(() => expect(proofread).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });

    showRequestedPage = true;
    refreshEditorProofreadingPresentation(view);
    finishProofreading({
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result",
      requestId: 1,
      identity: {
        projectId: "project",
        path: "main.tex",
        revision: 1,
        requestGeneration: 1,
        surface: "source",
      },
      status: "ready",
      diagnostics: [
        {
          from: 0,
          to: "qwertzuiopz".length,
          message: "Possible misspelling",
          kind: "Spelling",
          source: "hunspell",
          word: "qwertzuiopz",
          suggestions: [],
        },
      ],
    });

    await vi.waitFor(
      () => expect(diagnosticCardSource(view!, 1)).not.toBeNull(),
      { timeout: 2_000 },
    );
    expect(proofread).toHaveBeenCalledOnce();
  });

  it("repaints an exact retained result after CodeMirror replaces its document object", async () => {
    const text = "qwertzuiopz remains observable";
    let finishProofreading = (_result: ProofreadingResult): void => {
      throw new Error("proofreading did not start");
    };
    let retained:
      | {
          projectId: string | null;
          path: string;
          text: string;
          mode: "combined";
          result: ProofreadingResult;
        }
      | null = null;
    const proofread = vi.fn(
      (input: {
        projectId: string | null;
        path: string;
        text: string;
        mode: "grammar" | "spelling" | "combined";
      }) =>
        new Promise<ProofreadingResult>((resolve) => {
          finishProofreading = (result) => {
            retained = {
              projectId: input.projectId,
              path: input.path,
              text: input.text,
              mode: "combined",
              result,
            };
            resolve(result);
          };
        }),
    );
    setSpellHost({
      getProjectId: () => "project",
      getActivePath: () => "main.tex",
      getLintPrefs: () => ({
        showRegionalism: true,
        showWordChoice: true,
        dialect: "american",
      }),
      proofread,
      getRetainedProofreading: (input) => {
        if (
          !retained ||
          retained.projectId !== input.projectId ||
          retained.path !== input.path ||
          retained.text !== input.text ||
          retained.mode !== input.mode
        ) {
          return null;
        }
        return retained.result;
      },
      isSessionIgnored: () => false,
      isWordIgnored: () => false,
      ignoreWordForProject: () => undefined,
      ignoreWordGlobally: () => undefined,
    });

    view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [createHarperLinter(true)],
      }),
      parent: document.body,
    });
    forceLinting(view);
    await vi.waitFor(() => expect(proofread).toHaveBeenCalledOnce(), {
      timeout: 2_000,
    });

    // Replacing one character and restoring it gives CodeMirror a new
    // immutable Text object with the exact worker input.
    view.dispatch({
      changes: { from: text.length, insert: "x" },
    });
    view.dispatch({
      changes: { from: text.length, to: text.length + 1 },
    });

    const result: ProofreadingResult = {
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "result",
      requestId: 1,
      identity: {
        projectId: "project",
        path: "main.tex",
        revision: 1,
        requestGeneration: 1,
        surface: "source",
      },
      status: "ready",
      diagnostics: [
        {
          from: 0,
          to: "qwertzuiopz".length,
          message: "Possible misspelling",
          kind: "Spelling",
          source: "hunspell",
          word: "qwertzuiopz",
          suggestions: [],
        },
      ],
    };
    finishProofreading(result);
    await Promise.resolve();

    expect(diagnosticCardSource(view, 1)).toBeNull();
    refreshEditorProofreadingPresentation(view);
    await vi.waitFor(
      () => expect(diagnosticCardSource(view!, 1)).not.toBeNull(),
      { timeout: 2_000 },
    );
    expect(proofread).toHaveBeenCalledOnce();
  });
});
