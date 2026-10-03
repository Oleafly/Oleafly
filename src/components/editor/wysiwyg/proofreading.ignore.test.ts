// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import type { ProofreadingResult } from "@oleafly/editor";
import { setDictionaryNotice, useDictionary } from "@/lib/dictionary";
import { proofreadDocument } from "@/lib/proofreading/client";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const client = vi.hoisted(() => ({
  words: [] as string[],
}));

vi.mock("./controller", () => ({ isWysiwygActive: () => true }));

vi.mock("@/lib/proofreading/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proofreading/client")>()),
  cancelProofreading: vi.fn(),
  proofreadDocument: vi.fn(
    async (request: {
      identity: ProofreadingResult["identity"];
      text: string;
    }) => ({
      identity: request.identity,
      status: "ready",
      diagnostics: client.words.map((word) => {
        const from = request.text.indexOf(word);
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
      }),
    }),
  ),
}));

import {
  applyVisualProofreadingSuggestion,
  ignoreVisualProofreadingIssue,
  setVisualProofreadingIssueListener,
  VisualProofreading,
  type VisualProofreadingIssue,
} from "./proofreading";

let editor: Editor | null = null;

const dropEdits = { active: false };

const EditGate = Extension.create({
  name: "proofreadingTestEditGate",
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction: (transaction) => !transaction.docChanged || !dropEdits.active,
    })];
  },
});

async function paintedIssue(text: string, word: string): Promise<VisualProofreadingIssue> {
  client.words = [word];
  const issues: VisualProofreadingIssue[] = [];
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, VisualProofreading, EditGate],
    content: `<p>${text}</p>`,
  });
  await vi.waitFor(() => {
    const target = editor?.view.dom.querySelector("[data-proofreading-issue]");
    expect(target).not.toBeNull();
  });
  setVisualProofreadingIssueListener((issue) => {
    if (issue) issues.push(issue);
  });
  const target = editor.view.dom.querySelector("[data-proofreading-issue]") as HTMLElement;
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  expect(issues).toHaveLength(1);
  return issues[0] as VisualProofreadingIssue;
}

describe("ignoring a Visual proofreading word", () => {
  const notices: string[] = [];

  beforeEach(() => {
    notices.length = 0;
    setDictionaryNotice((message) => void notices.push(message));
    useDictionary.setState({ ignored: {}, global: [], suppressed: {}, revision: 0 });
    useFilesStore.setState({ activePath: "main.tex", projectId: "project", docVersion: 1 });
    useSettingsStore.setState({ spellcheck: true, harper: false });
  });

  afterEach(() => {
    setVisualProofreadingIssueListener(null);
    setDictionaryNotice(null);
    editor?.destroy();
    editor = null;
  });

  it("stores the whole word and closes", async () => {
    const issue = await paintedIssue("Das Wort हिंदी bleibt.", "हिंदी");
    expect(ignoreVisualProofreadingIssue(editor as Editor, issue, "global")).toBe(true);
    expect(useDictionary.getState().global).toEqual(["हिंदी"]);
  });

  it("stays open when the dictionary refuses the word", async () => {
    const issue = await paintedIssue("Das Wort wo\u202Erd bleibt.", "wo\u202Erd");
    expect(ignoreVisualProofreadingIssue(editor as Editor, issue, "project")).toBe(false);
    expect(ignoreVisualProofreadingIssue(editor as Editor, issue, "global")).toBe(false);
    expect(useDictionary.getState().global).toEqual([]);
    expect(useDictionary.getState().ignored).toEqual({});
    expect(notices).toHaveLength(2);
  });
});

describe("applying a Visual proofreading suggestion", () => {
  const text = "Das Wort Straßee bleibt.";
  const word = "Straßee";
  const fix = { text: "Straße", kind: 0 as const };

  beforeEach(() => {
    dropEdits.active = false;
    useDictionary.setState({ ignored: {}, global: [], suppressed: {}, revision: 0 });
    useFilesStore.setState({ activePath: "main.tex", projectId: "project", docVersion: 1 });
    useSettingsStore.setState({ spellcheck: true, harper: false });
  });

  afterEach(() => {
    dropEdits.active = false;
    setVisualProofreadingIssueListener(null);
    editor?.destroy();
    editor = null;
  });

  it("replaces the whole word in an editable document", async () => {
    const issue = await paintedIssue(text, word);
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, fix)).toBe(true);
    expect(editor?.getText()).toBe("Das Wort Straße bleibt.");
  });

  it("reports failure instead of closing when the document is read-only", async () => {
    const issue = await paintedIssue(text, word);
    editor?.setEditable(false, false);

    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, fix)).toBe(false);
    expect(editor?.getText()).toBe(text);
    expect(ignoreVisualProofreadingIssue(editor as Editor, issue, "project")).toBe(true);
    expect(useDictionary.getState().ignored).toEqual({ project: [word] });
  });

  it("reports failure when the edit is dropped before it lands", async () => {
    const issue = await paintedIssue(text, word);
    dropEdits.active = true;

    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, fix)).toBe(false);
    expect(editor?.getText()).toBe(text);
  });
});

describe("Visual proofreading of vendored Typst packages", () => {
  beforeEach(() => {
    useDictionary.setState({ ignored: {}, global: [], suppressed: {}, revision: 0 });
    useSettingsStore.setState({ spellcheck: true, harper: false });
    client.words = ["Straßee"];
    vi.mocked(proofreadDocument).mockClear();
  });

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function open(path: string) {
    useFilesStore.setState({ activePath: path, projectId: "project", docVersion: 1 });
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, VisualProofreading],
      content: "<p>Das Wort Straßee bleibt.</p>",
    });
  }

  it("checks a project file but never a file inside typst-packages", async () => {
    open("typst-packages/preview/cetz/0.5.2/README.md");
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(proofreadDocument).not.toHaveBeenCalled();
    editor?.destroy();

    open("notes/README.md");
    await vi.waitFor(() => expect(proofreadDocument).toHaveBeenCalled(), { timeout: 3_000 });
  });
});
