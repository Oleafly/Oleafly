// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import type { ProofreadingResult } from "@oleafly/editor";
import { setDictionaryNotice, useDictionary } from "@/lib/dictionary";
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
  ignoreVisualProofreadingIssue,
  setVisualProofreadingIssueListener,
  VisualProofreading,
  type VisualProofreadingIssue,
} from "./proofreading";

let editor: Editor | null = null;

async function paintedIssue(text: string, word: string): Promise<VisualProofreadingIssue> {
  client.words = [word];
  const issues: VisualProofreadingIssue[] = [];
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, VisualProofreading],
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
