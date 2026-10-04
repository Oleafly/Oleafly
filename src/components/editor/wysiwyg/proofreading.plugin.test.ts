// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { RawBlock } from "@oleafly/wysiwyg";
import type { ProofreadingDiagnostic, ProofreadingResult } from "@oleafly/editor";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useDictionary } from "@/lib/dictionary";
import { useFilesStore } from "@/store/files";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

interface Request {
  identity: ProofreadingResult["identity"];
  text: string;
  mode: string;
  format: string;
  ignoredWords: string[];
  preferences: Record<string, unknown>;
}

const client = vi.hoisted(() => ({
  words: [] as string[],
  status: "ready" as string,
  pending: null as Promise<unknown> | null,
  proofreadDocument: vi.fn(),
  cancelProofreading: vi.fn(),
}));
const wysiwyg = vi.hoisted(() => ({ active: true }));

vi.mock("./controller", () => ({ isWysiwygActive: () => wysiwyg.active }));
vi.mock("@/lib/proofreading/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proofreading/client")>()),
  cancelProofreading: client.cancelProofreading,
  proofreadDocument: client.proofreadDocument,
}));

import {
  applyVisualProofreadingSuggestion,
  ignoreVisualProofreadingIssue,
  isVisualProofreadingIssueCurrent,
  refreshVisualProofreading,
  setVisualProofreadingIssueListener,
  VisualProofreading,
  visualProofreadingIssueGroup,
  visualProofreadingMessage,
  type VisualProofreadingIssue,
} from "./proofreading";

function diagnosticsFor(text: string): ProofreadingDiagnostic[] {
  return client.words.flatMap((word) => {
    const from = text.indexOf(word);
    return from < 0
      ? []
      : [{
          from,
          to: from + word.length,
          message: `${word} looks wrong.`,
          kind: "Spelling",
          source: "hunspell",
          word,
          suggestions: [{ text: word.toLowerCase(), kind: 0 }],
          rule: null,
        } as ProofreadingDiagnostic];
  });
}

function respond(request: Request) {
  return {
    identity: request.identity,
    status: client.status,
    diagnostics: diagnosticsFor(request.text),
  };
}

let editor: Editor | null = null;
let published: (VisualProofreadingIssue | null)[] = [];

function mount(content: string | object, extensions = [StarterKit, RawBlock, VisualProofreading]): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions, content });
  return editor;
}

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
}

function findings(): HTMLElement[] {
  return [...(editor?.view.dom.querySelectorAll<HTMLElement>("[data-proofreading-issue]") ?? [])];
}

function requests(): Request[] {
  return client.proofreadDocument.mock.calls.map(([request]) => request as Request);
}

function openFirstFinding(): VisualProofreadingIssue {
  findings()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  const issue = published.at(-1);
  if (!issue) throw new Error("no issue published");
  return issue;
}

beforeEach(() => {
  vi.useFakeTimers();
  client.words = [];
  client.status = "ready";
  client.pending = null;
  client.proofreadDocument.mockReset();
  client.proofreadDocument.mockImplementation(async (request: Request) => {
    if (client.pending) await client.pending;
    return respond(request);
  });
  client.cancelProofreading.mockReset();
  wysiwyg.active = true;
  published = [];
  setVisualProofreadingIssueListener((issue) => published.push(issue));
  useDictionary.setState({ ignored: {}, global: [], suppressed: {}, revision: 0 });
  useFilesStore.setState({ activePath: "main.tex", projectId: "project", docVersion: 1 });
  useSettingsStore.setState({ spellcheck: true, harper: true });
  useProofreadingStore.setState({
    visual: { ...useProofreadingStore.getState().visual, phase: "idle", identity: null, diagnostics: [] },
  });
});

afterEach(() => {
  setVisualProofreadingIssueListener(null);
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("Visual proofreading requests", () => {
  it("sends the visible prose with the ignored words and paints the findings", async () => {
    useDictionary.setState({ global: ["oleafly"], ignored: { project: ["teh"] } });
    client.words = ["Speling"];
    mount("<p>Speling matters.</p>");
    await settle();
    const [request] = requests();
    expect(request).toMatchObject({
      text: "Speling matters.",
      format: "plaintext",
      mode: "combined",
      ignoredWords: ["oleafly", "teh"],
      identity: { path: "main.tex", projectId: "project", surface: "visual" },
    });
    const [finding] = findings();
    expect(finding.textContent).toBe("Speling");
    expect(finding.getAttribute("title")).toBe(
      en.package.spellcheck.notInDictionary.replace("{{word}}", "Speling"),
    );
    expect(finding.getAttribute("aria-label")).toBe(
      en.visual.findingLabel.replace(
        "{{message}}",
        en.package.spellcheck.notInDictionary.replace("{{word}}", "Speling"),
      ),
    );
  });

  it.each([
    [false, true, "spelling"],
    [true, false, "grammar"],
  ])("uses the right mode when grammar is %s and spelling is %s", async (harper, spellcheck, mode) => {
    useSettingsStore.setState({ harper, spellcheck });
    mount("<p>Some text.</p>");
    await settle();
    expect(requests()[0].mode).toBe(mode);
  });

  it("clears and cancels when proofreading is off, the editor is hidden or the file is not prose", async () => {
    useSettingsStore.setState({ spellcheck: false, harper: false });
    mount("<p>Text.</p>");
    await settle();
    expect(client.proofreadDocument).not.toHaveBeenCalled();
    expect(client.cancelProofreading).toHaveBeenCalledWith("visual", "main.tex");
    editor?.destroy();

    useSettingsStore.setState({ spellcheck: true });
    wysiwyg.active = false;
    mount("<p>Text.</p>");
    await settle();
    expect(client.proofreadDocument).not.toHaveBeenCalled();
    editor?.destroy();

    wysiwyg.active = true;
    useFilesStore.setState({ activePath: "data.csv" });
    mount("<p>Text.</p>");
    await settle();
    expect(client.proofreadDocument).not.toHaveBeenCalled();
    expect(client.cancelProofreading).toHaveBeenLastCalledWith("visual", undefined);
  });

  it("paints nothing for a failed run and drops answers for an older document", async () => {
    client.status = "error";
    client.words = ["Speling"];
    mount("<p>Speling here.</p>");
    await settle();
    expect(findings()).toEqual([]);

    client.status = "ready";
    let release: () => void = () => {};
    client.pending = new Promise<void>((done) => {
      release = done;
    });
    refreshVisualProofreading(editor as Editor);
    await settle(800);
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
    editor?.commands.insertContentAt(1, "x");
    release();
    await settle();
    expect(findings()).toEqual([]);
  });

  it("waits for edits to settle and cancels the request it made", async () => {
    mount("<p>Text.</p>");
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledTimes(1);
    editor?.commands.insertContentAt(1, "More ");
    expect(client.cancelProofreading).toHaveBeenCalledWith("visual", "main.tex");
    await settle(799);
    expect(client.proofreadDocument).toHaveBeenCalledTimes(1);
    await settle(1);
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
  });

  it("retries on request for its own visual file only", async () => {
    mount("<p>Text.</p>");
    await settle();
    const retry = (detail: object) =>
      window.dispatchEvent(new CustomEvent("oleafly:proofreading-retry", { detail }));
    retry({ surface: "source" });
    retry({ surface: "visual", path: "other.tex" });
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledTimes(1);
    retry({ surface: "visual", path: "main.tex" });
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
    retry({ surface: "visual" });
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledTimes(3);
  });

  it("restarts when proofreading settings change", async () => {
    mount("<p>Text.</p>");
    await settle();
    published = [];
    window.dispatchEvent(new Event("oleafly:proofreading-settings-changed"));
    expect(client.cancelProofreading).toHaveBeenCalledWith("visual", "main.tex");
    expect(published).toEqual([null]);
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
  });

  it("repaints a new page of findings from the store without asking again", async () => {
    client.words = ["Speling"];
    mount("<p>Speling and grammer.</p>");
    await settle();
    expect(findings().map((node) => node.textContent)).toEqual(["Speling"]);
    const identity = requests()[0].identity;
    useProofreadingStore.setState({
      visual: {
        ...useProofreadingStore.getState().visual,
        phase: "ready",
        identity,
        diagnostics: [
          {
            from: 12,
            to: 19,
            message: "Check grammer.",
            kind: "Spelling",
            source: "harper",
            word: "grammer",
            suggestions: [],
            rule: null,
          } as ProofreadingDiagnostic,
        ],
      },
    });
    window.dispatchEvent(new Event("oleafly:proofreading-presentation-changed"));
    await settle();
    expect(findings().map((node) => node.textContent)).toEqual(["grammer"]);
    expect(findings()[0].getAttribute("title")).toBe("Check grammer.");
    expect(client.proofreadDocument).toHaveBeenCalledTimes(1);

    useProofreadingStore.setState({
      visual: { ...useProofreadingStore.getState().visual, phase: "idle", identity: null },
    });
    window.dispatchEvent(new Event("oleafly:proofreading-presentation-changed"));
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
  });

  it("opens a finding from the keyboard and leaves other keys alone", async () => {
    client.words = ["Speling"];
    mount("<p>Speling matters.</p>");
    await settle();
    const [finding] = findings();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    finding.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    finding.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(published.filter(Boolean)).toHaveLength(2);
    const other = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    finding.dispatchEvent(other);
    expect(published.filter(Boolean)).toHaveLength(2);
    editor?.view.dom.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(published.filter(Boolean)).toHaveLength(2);
  });

  it("cancels and clears the open finding when the editor closes", async () => {
    mount("<p>Text.</p>");
    await settle();
    published = [];
    editor?.destroy();
    editor = null;
    expect(client.cancelProofreading).toHaveBeenLastCalledWith("visual", "main.tex");
    expect(published).toEqual([null]);
  });
});

describe("acting on Visual findings", () => {
  async function paintedIssue(html: string, word: string): Promise<VisualProofreadingIssue> {
    client.words = [word];
    mount(html);
    await settle();
    return openFirstFinding();
  }

  it("replaces, deletes and inserts after a word", async () => {
    let issue = await paintedIssue("<p>Teh cat.</p>", "Teh");
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, { text: "The", kind: 0 })).toBe(true);
    expect(editor?.getText()).toBe("The cat.");
    expect(published.at(-1)).toBeNull();
    editor?.destroy();

    issue = await paintedIssue("<p>very very good.</p>", "very ");
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, { text: "", kind: 1 })).toBe(true);
    expect(editor?.getText()).toBe("very good.");
    editor?.destroy();

    issue = await paintedIssue("<p>Hello world</p>", "world");
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, { text: "!", kind: 2 })).toBe(true);
    expect(editor?.getText()).toBe("Hello world!");
  });

  it("refuses a suggestion for an outdated or read-only document", async () => {
    const issue = await paintedIssue("<p>Teh cat.</p>", "Teh");
    editor?.setEditable(false);
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, { text: "The", kind: 0 })).toBe(false);
    editor?.setEditable(true);
    useFilesStore.setState({ docVersion: 2 });
    expect(isVisualProofreadingIssueCurrent(editor as Editor, issue)).toBe(false);
    expect(visualProofreadingIssueGroup(editor as Editor, issue)).toBeNull();
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, { text: "The", kind: 0 })).toBe(false);
    useFilesStore.setState({ docVersion: 1, activePath: null });
    expect(isVisualProofreadingIssueCurrent(editor as Editor, issue)).toBe(false);
  });

  it("groups a plain finding on its own", async () => {
    const issue = await paintedIssue("<p>Teh cat.</p>", "Teh");
    expect(visualProofreadingIssueGroup(editor as Editor, issue)).toMatchObject({
      index: 0,
      count: 1,
      previous: null,
      next: null,
    });
  });

  it("edits the exact source of a raw block", async () => {
    const source = String.raw`\begin{abstract}Teh result holds.\end{abstract}`;
    const content = {
      type: "doc",
      content: [
        { type: "rawBlock", attrs: { source } },
        { type: "paragraph", content: [{ type: "text", text: "After." }] },
      ],
    };
    const sources = () => {
      const node = editor?.state.doc.firstChild;
      return String(node?.attrs.source ?? "");
    };
    const rawIssue = async () => {
      client.words = ["Teh"];
      mount(content);
      await settle();
      return openFirstFinding();
    };

    let issue = await rawIssue();
    expect(findings()[0].getAttribute("aria-label")).toBe(
      en.visual.findingLabel.replace(
        "{{message}}",
        en.package.spellcheck.notInDictionary.replace("{{word}}", "Teh"),
      ),
    );
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, { text: "The", kind: 0 })).toBe(true);
    expect(sources()).toBe(String.raw`\begin{abstract}The result holds.\end{abstract}`);
    editor?.destroy();

    issue = await rawIssue();
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, { text: "", kind: 1 })).toBe(true);
    expect(sources()).toBe(String.raw`\begin{abstract} result holds.\end{abstract}`);
    editor?.destroy();

    issue = await rawIssue();
    expect(applyVisualProofreadingSuggestion(editor as Editor, issue, { text: "!", kind: 2 })).toBe(true);
    expect(sources()).toBe(String.raw`\begin{abstract}Teh! result holds.\end{abstract}`);
  });

  it("pages through several findings in one raw block", async () => {
    const source = String.raw`\begin{abstract}Teh resutl holds.\end{abstract}`;
    client.words = ["Teh", "resutl"];
    mount({
      type: "doc",
      content: [
        { type: "rawBlock", attrs: { source } },
        { type: "paragraph", content: [{ type: "text", text: "After." }] },
      ],
    });
    await settle();
    const [block] = findings();
    expect(block.getAttribute("data-proofreading-count")).toBe("2");
    expect(block.getAttribute("aria-label")).toBe(
      en.visual.rawBlockFindings_other
        .replace("{{count}}", "2")
        .replace("{{message}}", en.package.spellcheck.notInDictionary.replace("{{word}}", "Teh")),
    );
    const first = openFirstFinding();
    const group = visualProofreadingIssueGroup(editor as Editor, first);
    expect(group).toMatchObject({ index: 0, count: 2, previous: null });
    expect(group?.next?.word).toBe("resutl");
    const second = visualProofreadingIssueGroup(editor as Editor, group?.next as VisualProofreadingIssue);
    expect(second).toMatchObject({ index: 1, count: 2, next: null });
    expect(second?.previous?.word).toBe("Teh");
  });

  it("ignores a word for the project or everywhere and asks again", async () => {
    const issue = await paintedIssue("<p>Oleaflyy rocks.</p>", "Oleaflyy");
    const calls = client.proofreadDocument.mock.calls.length;
    expect(ignoreVisualProofreadingIssue(editor as Editor, issue, "project")).toBe(true);
    expect(useDictionary.getState().ignored.project).toEqual(["Oleaflyy"]);
    await settle(800);
    expect(client.proofreadDocument.mock.calls.length).toBeGreaterThan(calls);
  });

  it("cannot ignore a word for a file outside a project", async () => {
    useFilesStore.setState({ projectId: null });
    const issue = await paintedIssue("<p>Oleaflyy rocks.</p>", "Oleaflyy");
    expect(ignoreVisualProofreadingIssue(editor as Editor, issue, "project")).toBe(false);
    expect(ignoreVisualProofreadingIssue(editor as Editor, { ...issue, id: "missing" }, "global")).toBe(false);
  });
});

describe("visualProofreadingMessage", () => {
  it("uses the dictionary wording for spelling and the checker message otherwise", () => {
    expect(visualProofreadingMessage({ source: "harper", word: "x", message: "Use a comma." })).toBe("Use a comma.");
    expect(visualProofreadingMessage({ source: "hunspell", word: "", message: "Unknown." })).toBe("Unknown.");
  });
});

describe("prose extraction around protected spans", () => {
  it("skips code, keeps math and links out of findings", async () => {
    client.words = ["Speling", "x", "example"];
    mount(
      "<p>Speling <code>Speling</code> $x$ https://example.com done</p><pre><code>Speling</code></pre><p>End.</p>",
    );
    await settle();
    const [request] = requests();
    expect(request.text).not.toContain("https://example.com");
    expect(request.text.match(/Speling/gu)).toHaveLength(1);
    expect(findings().map((node) => node.textContent)).toEqual(["Speling"]);
  });

  it("drops findings that point outside the prose or across paragraphs", async () => {
    client.proofreadDocument.mockImplementation(async (request: Request) => ({
      identity: request.identity,
      status: "ready",
      diagnostics: [
        { from: -1, to: 2, message: "bad", kind: "Spelling", source: "harper", suggestions: [], rule: null },
        { from: 3, to: 3, message: "empty", kind: "Spelling", source: "harper", suggestions: [], rule: null },
        { from: 0, to: 999, message: "long", kind: "Spelling", source: "harper", suggestions: [], rule: null },
        { from: 2, to: 8, message: "across", kind: "Spelling", source: "harper", suggestions: [], rule: null },
      ],
    }));
    mount("<p>One</p><p>Two</p>");
    await settle();
    expect(findings()).toEqual([]);
  });
});
