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
  diagnosticPresentationExtensions,
  refreshEditorLints,
  refreshEditorProofreadingPresentation,
  setProofreadingActionHost,
  setSpellHost,
  type ProofreadingActionHost,
} from "./spellcheck";
import {
  PROOFREADING_PROTOCOL_VERSION,
  grammarSuppressionKey,
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
        extensions: [
          createHarperLinter(true),
          diagnosticPresentationExtensions(),
        ],
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
          rule: null,
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

    // Simulate CodeMirror applying a lint result that was already resolving
    // when the presentation page changed. The requested page must be
    // reasserted after that asynchronous last write without another worker
    // request.
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
    expect(diagnosticCardSource(view, 1)).toBeNull();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    expect(diagnosticCardSource(view, 1)).not.toBeNull();

    // A separate linter can publish much later than the presentation event,
    // after all event-owned frames and promises have settled. The persistent
    // diagnostics transaction guard must still keep the selected page.
    await new Promise((resolve) => setTimeout(resolve, 20));
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
    expect(diagnosticCardSource(view, 1)).toBeNull();
    await vi.waitFor(
      () => expect(diagnosticCardSource(view!, 1)).not.toBeNull(),
      { timeout: 2_000 },
    );
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
          rule: null,
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
          rule: null,
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
          rule: null,
        },
      ],
    };
    finishProofreading(result);
    await Promise.resolve();

    expect(diagnosticCardSource(view, 1)).toBeNull();
    refreshEditorProofreadingPresentation(view);
    expect(diagnosticCardSource(view, 1)).not.toBeNull();
    await vi.waitFor(
      () => expect(diagnosticCardSource(view!, 1)).not.toBeNull(),
      { timeout: 2_000 },
    );
    expect(proofread).toHaveBeenCalledOnce();
  });
});

function stubActionHost(
  overrides: Partial<ProofreadingActionHost> = {},
): ProofreadingActionHost & {
  projectWords: string[];
  personalWords: string[];
  here: string[];
  suppressedHere: string[];
  suppressions: string[];
  disabled: string[];
  notices: string[];
} {
  const state = {
    projectWords: [] as string[],
    personalWords: [] as string[],
    here: [] as string[],
    suppressedHere: [] as string[],
    suppressions: [] as string[],
    disabled: [] as string[],
    notices: [] as string[],
  };
  const host: ProofreadingActionHost = {
    addToProjectDictionary: (_projectId, word) => {
      state.projectWords.push(word);
      return true;
    },
    addToPersonalDictionary: (word) => {
      state.personalWords.push(word);
      return true;
    },
    ignoreHere: (projectId, path, word) =>
      void state.here.push(`${projectId ?? ""}:${path}:${word}`),
    isIgnoredHere: (projectId, path, word) =>
      state.here.includes(`${projectId ?? ""}:${path}:${word}`),
    suppressHere: (projectId, path, key) =>
      void state.suppressedHere.push(`${projectId ?? ""}:${path}:${key}`),
    isSuppressedHere: (projectId, path, key) =>
      state.suppressedHere.includes(`${projectId ?? ""}:${path}:${key}`),
    suppressFinding: (_projectId, key) => {
      state.suppressions.push(key);
      return true;
    },
    isFindingSuppressed: (_projectId, key) =>
      state.suppressions.includes(key),
    disableRule: (rule) => void state.disabled.push(rule),
    notify: (message) => void state.notices.push(message),
    ...overrides,
  };
  setProofreadingActionHost(host);
  return Object.assign(host, state);
}

function proofreadingHost(
  result: ProofreadingResult,
  overrides: Record<string, unknown> = {},
) {
  return {
    getProjectId: () => "project",
    getActivePath: () => "main.tex",
    getProofreadingContextKey: () => "context",
    getLintPrefs: () => ({
      showRegionalism: true,
      showWordChoice: true,
    }),
    proofread: async () => result,
    isSessionIgnored: () => false,
    isWordIgnored: () => false,
    ignoreWordForProject: () => {},
    ignoreWordGlobally: () => {},
    ...overrides,
  };
}

function workerResult(
  diagnostics: ProofreadingResult["diagnostics"],
): ProofreadingResult {
  return {
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
    diagnostics,
  };
}

async function mountLinted(
  text: string,
  diagnostics: ProofreadingResult["diagnostics"],
  hostOverrides: Record<string, unknown> = {},
) {
  setSpellHost(
    proofreadingHost(workerResult(diagnostics), hostOverrides) as never,
  );
  const editor = new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        diagnosticPresentationExtensions(),
        createHarperLinter(true),
      ],
    }),
    parent: document.body,
  });
  view = editor;
  forceLinting(editor);
  await vi.waitFor(() => {
    let count = 0;
    forEachDiagnostic(editor.state, () => void count++);
    expect(count).toBeGreaterThan(0);
  });
  return editor;
}

function cardAt(editor: EditorView, pos: number): HTMLElement {
  const tooltip = diagnosticCardSource(editor, pos);
  if (!tooltip) throw new Error("no card at this position");
  return tooltip.create(editor).dom as HTMLElement;
}

function footerLabels(dom: HTMLElement): string[] {
  return [...dom.querySelectorAll(".cm-proofread-ignore")].map(
    (entry) => entry.textContent ?? "",
  );
}

function press(dom: HTMLElement, label: string): void {
  const button = [...dom.querySelectorAll(".cm-proofread-ignore")].find(
    (entry) => entry.textContent === label,
  );
  if (!button) throw new Error(`no footer action named ${label}`);
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
}

describe("proofreading actions by kind", () => {
  afterEach(() => setProofreadingActionHost(null));

  it("offers the two dictionaries and a session ignore for a misspelling", async () => {
    stubActionHost();
    const text = "The qwertzuiopz result.";
    const at = text.indexOf("qwertzuiopz");
    const editor = await mountLinted(text, [
      {
        from: at,
        to: at + 11,
        message: "Possible misspelling",
        kind: "Spelling",
        source: "hunspell",
        word: "qwertzuiopz",
        suggestions: [],
        rule: null,
      },
    ]);
    expect(footerLabels(cardAt(editor, at))).toEqual([
      "Ignore in this project",
      "Ignore everywhere",
      "Ignore for now",
    ]);
  });

  it("offers a dismissal and a rule switch for a grammar finding", async () => {
    stubActionHost();
    const text = "We compare the the results.";
    const at = text.indexOf("the the");
    const editor = await mountLinted(text, [
      {
        from: at,
        to: at + 7,
        message: "Did you mean to repeat this word?",
        kind: "Repetition",
        source: "harper",
        word: "the the",
        suggestions: [],
        rule: "RepeatedWords",
      },
    ]);
    expect(footerLabels(cardAt(editor, at))).toEqual([
      "Ignore in this project",
      "Turn off rule “RepeatedWords”",
    ]);
  });

  it("stores a word in the project dictionary and clears its squiggle", async () => {
    const actions = stubActionHost();
    const text = "The qwertzuiopz result.";
    const at = text.indexOf("qwertzuiopz");
    const editor = await mountLinted(text, [
      {
        from: at,
        to: at + 11,
        message: "Possible misspelling",
        kind: "Spelling",
        source: "hunspell",
        word: "qwertzuiopz",
        suggestions: [],
        rule: null,
      },
    ]);
    press(cardAt(editor, at), "Ignore in this project");
    expect(actions.projectWords).toEqual(["qwertzuiopz"]);
  });

  it("hides a word it cannot store and says why", async () => {
    const actions = stubActionHost({
      addToPersonalDictionary: () => false,
    });
    const text = `A ${"x".repeat(30)} span.`;
    const editor = await mountLinted(text, [
      {
        from: 2,
        to: 32,
        message: "Possible misspelling",
        kind: "Spelling",
        source: "hunspell",
        word: "x".repeat(30),
        suggestions: [],
        rule: null,
      },
    ]);
    press(cardAt(editor, 3), "Ignore everywhere");
    expect(actions.here).toEqual([`project:main.tex:${"x".repeat(30)}`]);
  });

  it("remembers a dismissed grammar finding by rule and sentence", async () => {
    const actions = stubActionHost();
    const text = "We compare the the results.";
    const at = text.indexOf("the the");
    const editor = await mountLinted(text, [
      {
        from: at,
        to: at + 7,
        message: "Did you mean to repeat this word?",
        kind: "Repetition",
        source: "harper",
        word: "the the",
        suggestions: [],
        rule: "RepeatedWords",
      },
    ]);
    press(cardAt(editor, at), "Ignore in this project");
    expect(actions.suppressions).toEqual([
      grammarSuppressionKey("RepeatedWords", text, at),
    ]);
  });

  it("turns a rule off from the card", async () => {
    const actions = stubActionHost();
    const text = "We compare the the results.";
    const at = text.indexOf("the the");
    const editor = await mountLinted(text, [
      {
        from: at,
        to: at + 7,
        message: "Did you mean to repeat this word?",
        kind: "Repetition",
        source: "harper",
        word: "the the",
        suggestions: [],
        rule: "RepeatedWords",
      },
    ]);
    press(cardAt(editor, at), "Turn off rule “RepeatedWords”");
    expect(actions.disabled).toEqual(["RepeatedWords"]);
  });

  it("clears every finding that overlaps the dismissed span", async () => {
    stubActionHost();
    const text = "The qwertzuiopz result.";
    const at = text.indexOf("qwertzuiopz");
    const editor = await mountLinted(text, [
      {
        from: at,
        to: at + 11,
        message: "Possible misspelling",
        kind: "Spelling",
        source: "hunspell",
        word: "qwertzuiopz",
        suggestions: [],
        rule: null,
      },
      {
        from: at + 3,
        to: at + 8,
        message: "Another view of the same text",
        kind: "Spelling",
        source: "harper",
        word: "rtzui",
        suggestions: [],
        rule: null,
      },
    ]);
    press(cardAt(editor, at), "Ignore for now");
    let remaining = 0;
    forEachDiagnostic(editor.state, () => void remaining++);
    expect(remaining).toBe(0);
  });

  it("keeps a dismissed misspelling hidden through the next lint", async () => {
    const actions = stubActionHost({
      addToProjectDictionary: () => false,
      addToPersonalDictionary: () => false,
    });
    const text = "The qwertzuiopz result and a second one.";
    const at = text.indexOf("qwertzuiopz");
    const other = text.indexOf("second");
    const findings: ProofreadingResult["diagnostics"] = [
      {
        from: at,
        to: at + 11,
        message: "Possible misspelling",
        kind: "Spelling",
        source: "hunspell",
        word: "qwertzuiopz",
        suggestions: [],
        rule: null,
      },
    ];
    const box = { findings };
    const editor = await mountLinted(text, findings, {
      proofread: async () => workerResult(box.findings),
    });
    press(cardAt(editor, at), "Ignore everywhere");
    expect(actions.here).toEqual([`project:main.tex:qwertzuiopz`]);

    box.findings = [
      ...findings,
      {
        from: other,
        to: other + 6,
        message: "A later finding",
        kind: "Spelling",
        source: "hunspell",
        word: "second",
        suggestions: [],
        rule: null,
      },
    ];
    refreshEditorLints(editor);
    forceLinting(editor);
    await vi.waitFor(() =>
      expect(diagnosticCardSource(editor, other)).not.toBeNull(),
    );
    expect(diagnosticCardSource(editor, at)).toBeNull();
  });

  it("keeps a dismissed grammar finding hidden when the project store is full", async () => {
    const actions = stubActionHost({ suppressFinding: () => false });
    const text = "We compare the the results. A later sentence follows.";
    const at = text.indexOf("the the");
    const other = text.indexOf("later");
    const findings: ProofreadingResult["diagnostics"] = [
      {
        from: at,
        to: at + 7,
        message: "Did you mean to repeat this word?",
        kind: "Repetition",
        source: "harper",
        word: "the the",
        suggestions: [],
        rule: "RepeatedWords",
      },
    ];
    const box = { findings };
    const editor = await mountLinted(text, findings, {
      proofread: async () => workerResult(box.findings),
    });
    press(cardAt(editor, at), "Ignore in this project");
    expect(actions.notices).toEqual([
      "This finding could not be saved, so it is hidden for now.",
    ]);
    expect(actions.suppressedHere).toEqual([
      `project:main.tex:${grammarSuppressionKey("RepeatedWords", text, at)}`,
    ]);

    box.findings = [
      ...findings,
      {
        from: other,
        to: other + 5,
        message: "A later finding",
        kind: "Repetition",
        source: "harper",
        word: "later",
        suggestions: [],
        rule: "OtherRule",
      },
    ];
    refreshEditorLints(editor);
    forceLinting(editor);
    await vi.waitFor(() =>
      expect(diagnosticCardSource(editor, other)).not.toBeNull(),
    );
    expect(diagnosticCardSource(editor, at)).toBeNull();
  });

  it("keeps every dismissed misspelling hidden when the dictionary write throws", async () => {
    const actions = stubActionHost({
      addToPersonalDictionary: () => {
        const error = new Error("storage quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      },
    });
    const text = "The qwertzuiopz result and a second one.";
    const at = text.indexOf("qwertzuiopz");
    const other = text.indexOf("second");
    const findings: ProofreadingResult["diagnostics"] = [
      {
        from: at,
        to: at + 11,
        message: "Possible misspelling",
        kind: "Spelling",
        source: "hunspell",
        word: "qwertzuiopz",
        suggestions: [],
        rule: null,
      },
      {
        from: at + 3,
        to: at + 8,
        message: "Another view of the same text",
        kind: "Spelling",
        source: "harper",
        word: "rtzui",
        suggestions: [],
        rule: null,
      },
    ];
    const box = { findings };
    const editor = await mountLinted(text, findings, {
      proofread: async () => workerResult(box.findings),
    });
    press(cardAt(editor, at), "Ignore everywhere");
    expect([...actions.here].sort()).toEqual([
      "project:main.tex:qwertzuiopz",
      "project:main.tex:rtzui",
    ]);
    expect(actions.personalWords).toEqual([]);
    expect(actions.notices).toEqual([
      "That word could not be saved, so it is hidden for now.",
    ]);

    box.findings = [
      ...findings,
      {
        from: other,
        to: other + 6,
        message: "A later finding",
        kind: "Spelling",
        source: "hunspell",
        word: "second",
        suggestions: [],
        rule: null,
      },
    ];
    refreshEditorLints(editor);
    forceLinting(editor);
    await vi.waitFor(() =>
      expect(diagnosticCardSource(editor, other)).not.toBeNull(),
    );
    expect(diagnosticCardSource(editor, at)).toBeNull();
    expect(diagnosticCardSource(editor, at + 4)).toBeNull();
  });

  it("keeps every dismissed grammar finding hidden when the suppression write throws", async () => {
    const actions = stubActionHost({
      suppressFinding: () => {
        const error = new Error("storage quota exceeded");
        error.name = "QuotaExceededError";
        throw error;
      },
    });
    const text = "We compare the the results. A later sentence follows.";
    const at = text.indexOf("the the");
    const other = text.indexOf("later");
    const findings: ProofreadingResult["diagnostics"] = [
      {
        from: at,
        to: at + 7,
        message: "Did you mean to repeat this word?",
        kind: "Repetition",
        source: "harper",
        word: "the the",
        suggestions: [],
        rule: "RepeatedWords",
      },
      {
        from: at + 4,
        to: at + 11,
        message: "Another view of the same span",
        kind: "WordChoice",
        source: "harper",
        word: "the res",
        suggestions: [],
        rule: "OverlappingRule",
      },
    ];
    const box = { findings };
    const editor = await mountLinted(text, findings, {
      proofread: async () => workerResult(box.findings),
    });
    press(cardAt(editor, at), "Ignore in this project");
    expect(actions.notices).toEqual([
      "This finding could not be saved, so it is hidden for now.",
    ]);
    expect([...actions.suppressedHere].sort()).toEqual(
      [
        `project:main.tex:${grammarSuppressionKey("RepeatedWords", text, at)}`,
        `project:main.tex:${grammarSuppressionKey("OverlappingRule", text, at + 4)}`,
      ].sort(),
    );

    box.findings = [
      ...findings,
      {
        from: other,
        to: other + 5,
        message: "A later finding",
        kind: "Repetition",
        source: "harper",
        word: "later",
        suggestions: [],
        rule: "OtherRule",
      },
    ];
    refreshEditorLints(editor);
    forceLinting(editor);
    await vi.waitFor(() =>
      expect(diagnosticCardSource(editor, other)).not.toBeNull(),
    );
    expect(diagnosticCardSource(editor, at)).toBeNull();
    expect(diagnosticCardSource(editor, at + 8)).toBeNull();
  });

  it("hides a finding the writer already dismissed", async () => {
    const actions = stubActionHost();
    const text = "We compare the the results.";
    const at = text.indexOf("the the");
    const sentinel = text.indexOf("results");
    actions.suppressFinding(
      null,
      grammarSuppressionKey("RepeatedWords", text, at),
    );
    const editor = await mountLinted(text, [
      {
        from: at,
        to: at + 7,
        message: "Did you mean to repeat this word?",
        kind: "Repetition",
        source: "harper",
        word: "the the",
        suggestions: [],
        rule: "RepeatedWords",
      },
      {
        from: sentinel,
        to: sentinel + 7,
        message: "Consider another word here",
        kind: "WordChoice",
        source: "harper",
        word: "results",
        suggestions: [],
        rule: "KeptRule",
      },
    ]);

    await vi.waitFor(() =>
      expect(diagnosticCardSource(editor, sentinel)).not.toBeNull(),
    );
    expect(diagnosticCardSource(editor, at)).toBeNull();
  });

  it("drops a finding wider than a word before it reaches the editor", async () => {
    stubActionHost();
    const text = `A ${"long ".repeat(30)}tail.`;
    const sentinel = text.indexOf("tail");
    const editor = await mountLinted(text, [
      {
        from: 0,
        to: text.length - 1,
        message: "Possible misspelling",
        kind: "Spelling",
        source: "hunspell",
        word: text.slice(0, text.length - 1),
        suggestions: [],
        rule: null,
      },
      {
        from: sentinel,
        to: sentinel + 4,
        message: "Possible misspelling",
        kind: "Spelling",
        source: "hunspell",
        word: "tail",
        suggestions: [],
        rule: null,
      },
    ]);

    await vi.waitFor(() =>
      expect(diagnosticCardSource(editor, sentinel)).not.toBeNull(),
    );
    expect(diagnosticCardSource(editor, 5)).toBeNull();
  });
});
