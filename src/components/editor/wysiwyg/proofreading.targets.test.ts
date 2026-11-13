// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import type { ProofreadingDiagnostic, ProofreadingMode, ProofreadingResult } from "@oleafly/editor";
import { useDictionary } from "@/lib/dictionary";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

interface Request {
  identity: ProofreadingResult["identity"];
  text: string;
  mode: string;
  ignoredWords: string[];
  preferences: { dictionaryLocale?: string };
}

const client = vi.hoisted(() => ({
  words: [] as string[],
  pending: null as Promise<unknown> | null,
  proofreadDocument: vi.fn(),
  cancelProofreading: vi.fn(),
}));

vi.mock("@/lib/proofreading/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proofreading/client")>()),
  cancelProofreading: client.cancelProofreading,
  proofreadDocument: client.proofreadDocument,
}));

import {
  applyVisualProofreadingSuggestion,
  createProofreading,
  isVisualProofreadingIssueCurrent,
  type ProofreadingTarget,
  resumeVisualProofreading,
  VisualProofreading,
  type VisualProofreadingIssue,
} from "./proofreading";

interface Probe {
  target: ProofreadingTarget;
  published: (VisualProofreadingIssue | null)[];
  visible: boolean;
  mode: ProofreadingMode | null;
}

const editors: Editor[] = [];

function probe(path: string, options: Partial<Pick<ProofreadingTarget, "protect" | "replacesNativeSpellcheck">> = {}): Probe {
  const state: Probe = {
    published: [],
    visible: true,
    mode: "spelling",
    target: null as unknown as ProofreadingTarget,
  };
  state.target = {
    surface: "notes",
    document: () => ({ path, projectId: null, documentVersion: 0, format: "markdown" }),
    active: () => state.visible,
    mode: () => state.mode,
    locale: () => "de_DE",
    publish: (issue) => state.published.push(issue),
    ...options,
  };
  return state;
}

function mount(target: ProofreadingTarget | null, html: string): Editor {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, target ? createProofreading(target) : VisualProofreading],
    content: html,
  });
  editors.push(editor);
  return editor;
}

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
}

function findings(editor: Editor): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>("[data-proofreading-issue]")];
}

function requests(): Request[] {
  return client.proofreadDocument.mock.calls.map(([request]) => request as Request);
}

function click(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
}

function composing(editor: Editor, value: () => boolean) {
  Object.defineProperty(editor.view, "composing", { configurable: true, get: value });
}

beforeEach(() => {
  vi.useFakeTimers();
  client.words = ["Speling"];
  client.pending = null;
  client.proofreadDocument.mockReset();
  client.proofreadDocument.mockImplementation(async (request: Request) => {
    if (client.pending) await client.pending;
    return {
      identity: request.identity,
      status: "ready",
      diagnostics: client.words.flatMap((word) => {
        const from = request.text.indexOf(word);
        return from < 0
          ? []
          : [{
              from,
              to: from + word.length,
              message: `${word} looks wrong.`,
              kind: "Spelling",
              source: "hunspell",
              word,
              suggestions: [{ text: "Spelling", kind: 0 }],
              rule: null,
            } as ProofreadingDiagnostic];
      }),
    };
  });
  client.cancelProofreading.mockReset();
  useDictionary.setState({ ignored: {}, global: ["oleafly"], suppressed: {}, revision: 0 });
  useProofreadingStore.getState().clear("notes");
});

const initialSettings = useSettingsStore.getState();

afterEach(() => {
  useSettingsStore.setState(initialSettings, true);
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("proofreading several editors", () => {
  it("checks each editor in its own lane with its own mode and dictionary", async () => {
    const first = probe("notes/1/a");
    const second = probe("notes/2/b");
    second.mode = "combined";
    mount(first.target, "<p>Speling one.</p>");
    mount(second.target, "<p>Speling two.</p>");
    await settle();

    expect(requests().map((request) => [request.identity.surface, request.identity.path, request.mode])).toEqual([
      ["notes", "notes/1/a", "spelling"],
      ["notes", "notes/2/b", "combined"],
    ]);
    expect(requests()[0]).toMatchObject({
      ignoredWords: ["oleafly"],
      preferences: { dictionaryLocale: "de_DE" },
    });
  });

  it("opens and fixes a finding only in the editor it belongs to", async () => {
    const first = probe("notes/1/a");
    const second = probe("notes/2/b");
    const one = mount(first.target, "<p>Speling one.</p>");
    const two = mount(second.target, "<p>Speling two.</p>");
    await settle();

    click(findings(one)[0]);
    const issue = first.published.at(-1);
    expect(issue?.word).toBe("Speling");
    expect(second.published.filter(Boolean)).toEqual([]);
    expect(isVisualProofreadingIssueCurrent(one, issue as VisualProofreadingIssue)).toBe(true);
    expect(isVisualProofreadingIssueCurrent(two, issue as VisualProofreadingIssue)).toBe(false);

    expect(applyVisualProofreadingSuggestion(one, issue as VisualProofreadingIssue, { text: "Spelling", kind: 0 })).toBe(true);
    expect(one.getText()).toBe("Spelling one.");
    expect(two.getText()).toBe("Speling two.");
    expect(first.published.at(-1)).toBeNull();
  });

  it("stays quiet while the target has no mode", async () => {
    const off = probe("notes/1/a");
    off.mode = null;
    const editor = mount(off.target, "<p>Speling.</p>");
    await settle();
    expect(client.proofreadDocument).not.toHaveBeenCalled();
    expect(client.cancelProofreading).toHaveBeenCalledWith("notes", "notes/1/a");
    expect(findings(editor)).toEqual([]);
  });
});

describe("hidden editors", () => {
  it("skips a hidden editor and catches up once it is shown", async () => {
    const hidden = probe("notes/1/a");
    hidden.visible = false;
    const editor = mount(hidden.target, "<p>Speling.</p>");
    await settle();
    expect(client.proofreadDocument).not.toHaveBeenCalled();

    hidden.visible = true;
    resumeVisualProofreading(editor);
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledOnce();
    expect(findings(editor).map((node) => node.textContent)).toEqual(["Speling"]);

    resumeVisualProofreading(editor);
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledOnce();
  });

  it("checks again when a result arrives after the editor was hidden", async () => {
    const shown = probe("notes/1/a");
    let release: () => void = () => {};
    client.pending = new Promise<void>((done) => {
      release = done;
    });
    const editor = mount(shown.target, "<p>Speling.</p>");
    await settle();
    shown.visible = false;
    release();
    await settle();
    expect(findings(editor)).toEqual([]);

    client.pending = null;
    shown.visible = true;
    resumeVisualProofreading(editor);
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
    expect(findings(editor)).toHaveLength(1);
  });
});

describe("what a target can change", () => {
  it("keeps protected ranges out of the text it sends", async () => {
    client.words = ["Speling", "tagg"];
    const tags = probe("notes/1/a", {
      protect: (text) => {
        const from = text.indexOf("#tagg");
        return from < 0 ? [] : [{ from, to: from + 5 }];
      },
    });
    const editor = mount(tags.target, "<p>Speling #tagg here.</p>");
    await settle();
    expect(requests()[0].text).not.toContain("tagg");
    expect(findings(editor).map((node) => node.textContent)).toEqual(["Speling"]);
  });

  it("turns the WebView's own spell check off only while the app checks spelling", () => {
    const own = probe("notes/1/a", { replacesNativeSpellcheck: true });
    const editor = mount(own.target, "<p>Text.</p>");
    const plain = mount(probe("notes/1/b").target, "<p>Text.</p>");
    const native = () => editor.view.dom.getAttribute("spellcheck");
    expect(native()).toBe("false");
    expect(plain.view.dom.hasAttribute("spellcheck")).toBe(false);
    for (const [mode, expected] of [["grammar", null], [null, null], ["combined", "false"]] as const) {
      own.mode = mode;
      editor.view.dispatch(editor.state.tr);
      expect(native()).toBe(expected);
    }
  });

  it.each([
    [true, false, "false"],
    [true, true, "false"],
    [false, true, null],
    [false, false, null],
  ] as const)("leaves the system spell check to the visual editor with spelling %s and grammar %s", (spellcheck, harper, expected) => {
    useSettingsStore.setState({ spellcheck, harper });
    expect(mount(null, "<p>Text.</p>").view.dom.getAttribute("spellcheck")).toBe(expected);
  });
});

describe("IME composition", () => {
  it("does not open a finding from the Enter that confirms a composition", async () => {
    const target = probe("notes/1/a");
    const editor = mount(target.target, "<p>Speling.</p>");
    await settle();
    editor.setEditable(false, false);
    const [finding] = findings(editor);
    const confirming = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
    finding.dispatchEvent(confirming);
    const webkit = new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true });
    finding.dispatchEvent(webkit);
    expect(confirming.defaultPrevented).toBe(false);
    expect(webkit.defaultPrevented).toBe(false);
    expect(target.published.filter(Boolean)).toEqual([]);

    finding.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(target.published.filter(Boolean)).toHaveLength(1);
  });

  it("waits for a composition to end before painting a result", async () => {
    const target = probe("notes/1/a");
    let release: () => void = () => {};
    client.pending = new Promise<void>((done) => {
      release = done;
    });
    const editor = mount(target.target, "<p>Speling.</p>");
    await settle();
    let active = true;
    composing(editor, () => active);
    release();
    await settle();
    expect(findings(editor)).toEqual([]);

    await settle(250);
    expect(client.proofreadDocument).toHaveBeenCalledOnce();

    active = false;
    await settle(250);
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
    expect(findings(editor)).toHaveLength(1);
  });
});
