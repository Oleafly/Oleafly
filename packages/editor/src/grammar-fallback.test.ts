// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { forEachDiagnostic, forceLinting } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createHarperLinter,
  diagnosticPresentationExtensions,
  setSpellHost,
  type SpellHost,
} from "./spellcheck";
import {
  englishEditorMessage,
  installEnglishEditorMessages,
} from "./test-messages";

installEnglishEditorMessages();

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

function host(overrides: Partial<SpellHost>): SpellHost {
  return {
    t: englishEditorMessage,
    getProjectId: () => "project",
    getActivePath: () => "main.tex",
    getLintPrefs: () => ({
      showRegionalism: true,
      showWordChoice: true,
      dialect: "american",
    }),
    isSessionIgnored: () => false,
    isWordIgnored: () => false,
    ignoreWordForProject: () => undefined,
    ignoreWordGlobally: () => undefined,
    ...overrides,
  };
}

function open(doc: string): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [createHarperLinter(true), diagnosticPresentationExtensions()],
    }),
    parent: document.body,
  });
  forceLinting(view);
  return view;
}

function findings(target: EditorView): string[] {
  const found: string[] = [];
  forEachDiagnostic(target.state, (_diagnostic, from, to) =>
    found.push(target.state.doc.sliceString(from, to)),
  );
  return found;
}

describe("grammar linting when the worker fails", () => {
  it("does not replace worker results with an English typo list", async () => {
    const proofread = vi.fn(() =>
      Promise.reject(new Error("Offline proofreading timed out.")),
    );
    setSpellHost(host({ proofread }));
    const target = open("Le modèle dont nous parlons est simple, dont acte.\n");

    await vi.waitFor(() => expect(proofread).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(findings(target)).toEqual([]);
  });

  it("finds repeated words that start or end with accented letters", async () => {
    setSpellHost(host({}));
    const target = open("Myslím že že to platí a já já také.\n");

    await vi.waitFor(() =>
      expect(findings(target)).toEqual(["že že", "já já"]),
    );
  });

  it("does not match a typo key inside a longer accented word", async () => {
    setSpellHost(host({}));
    const target = open("Le mot édont reste, mais dont is wrong.\n");

    await vi.waitFor(() => expect(findings(target)).toEqual(["dont"]));
  });
});
