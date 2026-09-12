// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forceLinting } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  PROOFREADING_PROTOCOL_VERSION,
  createHarperLinter,
  diagnosticCardSource,
  diagnosticPresentationExtensions,
  refreshEditorLints,
  setSpellHost,
  type ProofreadingResult,
} from "@oleafly/editor";
import { i18n } from "@/i18n";
import { isWordIgnored, useDictionary } from "@/lib/dictionary";
import { useSettingsStore } from "@/store/settings";
import { installProofreadingActionHost } from "./actions";
import {
  clearWordsIgnoredHere,
  forgetFindingSuppressedHere,
  forgetRuleSuppressedHere,
  forgetWordIgnoredHere,
  ignoreWordHere,
  isFindingSuppressedHere,
  isSessionIgnoredWord,
  isWordIgnoredHere,
  suppressFindingHere,
} from "./ignored";

afterEach(() => clearWordsIgnoredHere());

describe("session word ignores", () => {
  it("keeps one project's decision out of another project", () => {
    ignoreWordHere("alpha", "main.tex", "Qwertzuiopz");
    expect(isWordIgnoredHere("alpha", "main.tex", "Qwertzuiopz")).toBe(
      true,
    );
    expect(isWordIgnoredHere("beta", "main.tex", "Qwertzuiopz")).toBe(
      false,
    );
    expect(isWordIgnoredHere(null, "main.tex", "Qwertzuiopz")).toBe(false);
  });

  it("keeps one file's decision out of another file", () => {
    ignoreWordHere("alpha", "main.tex", "Qwertzuiopz");
    expect(isWordIgnoredHere("alpha", "intro.tex", "Qwertzuiopz")).toBe(
      false,
    );
  });

  it("matches the word after punctuation and case are normalized", () => {
    ignoreWordHere("alpha", "main.tex", "“Qwertzuiopz”,");
    expect(isWordIgnoredHere("alpha", "main.tex", "qwertzuiopz")).toBe(
      true,
    );
  });

  it("clears one file, one project, or everything", () => {
    ignoreWordHere("alpha", "main.tex", "one");
    ignoreWordHere("alpha", "intro.tex", "two");
    ignoreWordHere("beta", "main.tex", "three");

    clearWordsIgnoredHere("alpha", "main.tex");
    expect(isWordIgnoredHere("alpha", "main.tex", "one")).toBe(false);
    expect(isWordIgnoredHere("alpha", "intro.tex", "two")).toBe(true);

    clearWordsIgnoredHere("alpha");
    expect(isWordIgnoredHere("alpha", "intro.tex", "two")).toBe(false);
    expect(isWordIgnoredHere("beta", "main.tex", "three")).toBe(true);

    clearWordsIgnoredHere();
    expect(isWordIgnoredHere("beta", "main.tex", "three")).toBe(false);
  });
});

describe("session finding suppressions", () => {
  it("keeps one project's dismissal out of another project", () => {
    suppressFindingHere("alpha", "main.tex", "RepeatedWords:abcd1234");
    expect(
      isFindingSuppressedHere(
        "alpha",
        "main.tex",
        "RepeatedWords:abcd1234",
      ),
    ).toBe(true);
    expect(
      isFindingSuppressedHere(
        "beta",
        "main.tex",
        "RepeatedWords:abcd1234",
      ),
    ).toBe(false);
  });

  it("ignores an empty key", () => {
    suppressFindingHere("alpha", "main.tex", "");
    expect(isFindingSuppressedHere("alpha", "main.tex", "")).toBe(false);
  });

  it("is cleared alongside the ignored words", () => {
    suppressFindingHere("alpha", "main.tex", "RepeatedWords:abcd1234");
    clearWordsIgnoredHere("alpha", "main.tex");
    expect(
      isFindingSuppressedHere(
        "alpha",
        "main.tex",
        "RepeatedWords:abcd1234",
      ),
    ).toBe(false);
  });
});

describe("isSessionIgnoredWord", () => {
  it("passes over acronyms, numbers, and known tooling words", () => {
    expect(isSessionIgnoredWord("LaTeX")).toBe(true);
    expect(isSessionIgnoredWord("IEEE")).toBe(true);
    expect(isSessionIgnoredWord("H100")).toBe(true);
    expect(isSessionIgnoredWord("Qwertzuiopz")).toBe(false);
  });
});

describe("forgetting a session decision", () => {
  it("forgets one word across every file and project", () => {
    ignoreWordHere("alpha", "main.tex", "Qwertzuiopz");
    ignoreWordHere("alpha", "intro.tex", "Qwertzuiopz");
    ignoreWordHere("beta", "main.tex", "Qwertzuiopz");
    ignoreWordHere("alpha", "main.tex", "Plurdled");

    forgetWordIgnoredHere("qwertzuiopz");

    expect(isWordIgnoredHere("alpha", "main.tex", "Qwertzuiopz")).toBe(
      false,
    );
    expect(isWordIgnoredHere("alpha", "intro.tex", "Qwertzuiopz")).toBe(
      false,
    );
    expect(isWordIgnoredHere("beta", "main.tex", "Qwertzuiopz")).toBe(
      false,
    );
    expect(isWordIgnoredHere("alpha", "main.tex", "Plurdled")).toBe(true);
  });

  it("forgets one suppression key across every file and project", () => {
    suppressFindingHere("alpha", "main.tex", "RepeatedWords:abcd1234");
    suppressFindingHere("beta", "intro.tex", "RepeatedWords:abcd1234");
    suppressFindingHere("alpha", "main.tex", "RepeatedWords:99887766");

    forgetFindingSuppressedHere("RepeatedWords:abcd1234");

    expect(
      isFindingSuppressedHere("alpha", "main.tex", "RepeatedWords:abcd1234"),
    ).toBe(false);
    expect(
      isFindingSuppressedHere("beta", "intro.tex", "RepeatedWords:abcd1234"),
    ).toBe(false);
    expect(
      isFindingSuppressedHere("alpha", "main.tex", "RepeatedWords:99887766"),
    ).toBe(true);
  });

  it("forgets every sentence dismissed under one rule", () => {
    suppressFindingHere("alpha", "main.tex", "RepeatedWords:abcd1234");
    suppressFindingHere("alpha", "intro.tex", "RepeatedWords:99887766");
    suppressFindingHere("alpha", "main.tex", "RepeatedWordsPlus:abcd1234");
    suppressFindingHere("alpha", "main.tex", "SentenceCase:abcd1234");

    forgetRuleSuppressedHere("RepeatedWords");

    expect(
      isFindingSuppressedHere("alpha", "main.tex", "RepeatedWords:abcd1234"),
    ).toBe(false);
    expect(
      isFindingSuppressedHere("alpha", "intro.tex", "RepeatedWords:99887766"),
    ).toBe(false);
    expect(
      isFindingSuppressedHere(
        "alpha",
        "main.tex",
        "RepeatedWordsPlus:abcd1234",
      ),
    ).toBe(true);
    expect(
      isFindingSuppressedHere("alpha", "main.tex", "SentenceCase:abcd1234"),
    ).toBe(true);
  });
});

const PROJECT = "alpha";
const PATH = "main.tex";

function workerResult(
  diagnostics: ProofreadingResult["diagnostics"],
): ProofreadingResult {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: 1,
    identity: {
      projectId: PROJECT,
      path: PATH,
      revision: 1,
      requestGeneration: 1,
      surface: "source",
    },
    status: "ready",
    diagnostics,
  };
}

function spelling(
  from: number,
  word: string,
): ProofreadingResult["diagnostics"][number] {
  return {
    from,
    to: from + word.length,
    message: "Possible misspelling",
    kind: "Spelling",
    source: "hunspell",
    word,
    suggestions: [],
    rule: null,
  };
}

function grammar(
  from: number,
  word: string,
  rule: string,
): ProofreadingResult["diagnostics"][number] {
  return {
    from,
    to: from + word.length,
    message: "Did you mean to repeat this word?",
    kind: "Repetition",
    source: "harper",
    word,
    suggestions: [],
    rule,
  };
}

function cardAt(editor: EditorView, position: number): HTMLElement {
  const tooltip = diagnosticCardSource(editor, position);
  if (!tooltip) throw new Error("no card at this position");
  return tooltip.create(editor).dom as HTMLElement;
}

function press(dom: HTMLElement, label: string): void {
  const button = [...dom.querySelectorAll(".cm-proofread-ignore")].find(
    (entry) => entry.textContent === label,
  );
  if (!button) throw new Error(`no footer action named ${label}`);
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
}

describe("restoring a finding clears the matching session decision", () => {
  let editor: EditorView | null = null;
  const box: { findings: ProofreadingResult["diagnostics"] } = {
    findings: [],
  };

  beforeEach(() => {
    useDictionary.setState({
      ignored: {},
      global: [],
      suppressed: {},
      revision: 0,
    });
    useSettingsStore.getState().setHarperDisabledRules([]);
    clearWordsIgnoredHere();
    installProofreadingActionHost();
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  async function mount(
    text: string,
    findings: ProofreadingResult["diagnostics"],
  ): Promise<EditorView> {
    box.findings = findings;
    setSpellHost({
      t: (key: string, params?: Record<string, string | number>) =>
        (
          i18n.t as unknown as (
            key: string,
            params?: Record<string, string | number>,
          ) => string
        )(`editor:package.${key}`, params),
      getProjectId: () => PROJECT,
      getActivePath: () => PATH,
      getProofreadingContextKey: () =>
        `${useDictionary.getState().revision}:${useSettingsStore
          .getState()
          .harperDisabledRules.join(",")}`,
      getLintPrefs: () => ({
        showRegionalism: true,
        showWordChoice: true,
      }),
      proofread: async () => workerResult(box.findings),
      isSessionIgnored: () => false,
      isWordIgnored,
      ignoreWordForProject: () => undefined,
      ignoreWordGlobally: () => undefined,
    } as never);
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [
          diagnosticPresentationExtensions(),
          createHarperLinter(true),
        ],
      }),
      parent: document.body,
    });
    editor = view;
    forceLinting(view);
    return view;
  }

  async function relintWithControl(
    view: EditorView,
    findings: ProofreadingResult["diagnostics"],
    control: number,
    present: boolean,
  ): Promise<void> {
    box.findings = findings;
    refreshEditorLints(view);
    forceLinting(view);
    await vi.waitFor(() => {
      if (present) {
        expect(diagnosticCardSource(view, control)).not.toBeNull();
      } else {
        expect(diagnosticCardSource(view, control)).toBeNull();
      }
    });
  }

  it("shows a dismissed grammar finding again after Show again", async () => {
    const text = "We compare the the results. A later sentence follows.";
    const at = text.indexOf("the the");
    const control = text.indexOf("later");
    const target = grammar(at, "the the", "RepeatedWords");
    const marker = grammar(control, "later", "OtherRule");
    const view = await mount(text, [target]);
    await vi.waitFor(() =>
      expect(diagnosticCardSource(view, at)).not.toBeNull(),
    );

    press(cardAt(view, at), "Ignore in this project");
    await relintWithControl(view, [target, marker], control, true);
    expect(diagnosticCardSource(view, at)).toBeNull();

    useDictionary.getState().clearSuppressed(PROJECT);
    await relintWithControl(view, [target], control, false);
    expect(diagnosticCardSource(view, at)).not.toBeNull();
  });

  it("shows a word again after it leaves the project dictionary", async () => {
    const text = "The qwertzuiopz result and a plurdled second one.";
    const at = text.indexOf("qwertzuiopz");
    const kept = text.indexOf("plurdled");
    const control = text.indexOf("second");
    const target = spelling(at, "qwertzuiopz");
    const other = spelling(kept, "plurdled");
    const marker = spelling(control, "second");
    const view = await mount(text, [target, other]);
    await vi.waitFor(() =>
      expect(diagnosticCardSource(view, at)).not.toBeNull(),
    );

    ignoreWordHere(PROJECT, PATH, "plurdled");
    press(cardAt(view, at), "Ignore in this project");
    expect(isWordIgnored(PROJECT, "qwertzuiopz")).toBe(true);
    await relintWithControl(view, [target, other, marker], control, true);
    expect(diagnosticCardSource(view, at)).toBeNull();
    expect(diagnosticCardSource(view, kept)).toBeNull();

    useDictionary.getState().unignore(PROJECT, "qwertzuiopz");
    await relintWithControl(view, [target, other], control, false);
    expect(diagnosticCardSource(view, at)).not.toBeNull();
    expect(diagnosticCardSource(view, kept)).toBeNull();
  });

  it("shows a word again after it leaves the personal dictionary", async () => {
    const text = "The qwertzuiopz result and a second one.";
    const at = text.indexOf("qwertzuiopz");
    const control = text.indexOf("second");
    const target = spelling(at, "qwertzuiopz");
    const marker = spelling(control, "second");
    const view = await mount(text, [target]);
    await vi.waitFor(() =>
      expect(diagnosticCardSource(view, at)).not.toBeNull(),
    );

    press(cardAt(view, at), "Ignore everywhere");
    expect(isWordIgnored(null, "qwertzuiopz")).toBe(true);
    await relintWithControl(view, [target, marker], control, true);
    expect(diagnosticCardSource(view, at)).toBeNull();

    useDictionary.getState().unignoreGlobal("qwertzuiopz");
    await relintWithControl(view, [target], control, false);
    expect(diagnosticCardSource(view, at)).not.toBeNull();
  });

  it("shows a rule's findings again after the rule is turned back on", async () => {
    const text = "We compare the the results. A later sentence follows.";
    const at = text.indexOf("the the");
    const control = text.indexOf("later");
    const target = grammar(at, "the the", "RepeatedWords");
    const marker = grammar(control, "later", "OtherRule");
    const view = await mount(text, [target]);
    await vi.waitFor(() =>
      expect(diagnosticCardSource(view, at)).not.toBeNull(),
    );

    press(cardAt(view, at), "Turn off rule “RepeatedWords”");
    expect(useSettingsStore.getState().harperDisabledRules).toEqual([
      "RepeatedWords",
    ]);
    await relintWithControl(view, [target, marker], control, true);
    expect(diagnosticCardSource(view, at)).toBeNull();

    useSettingsStore.getState().enableHarperRule("RepeatedWords");
    await relintWithControl(view, [target], control, false);
    expect(diagnosticCardSource(view, at)).not.toBeNull();
  });
});
