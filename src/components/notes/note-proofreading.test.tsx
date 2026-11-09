// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  ignoredWords: string[];
  preferences: { dictionaryLocale?: string };
}

const client = vi.hoisted(() => ({
  words: [] as string[],
  proofreadDocument: vi.fn(),
  cancelProofreading: vi.fn(),
}));

vi.mock("@/lib/proofreading/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proofreading/client")>()),
  cancelProofreading: client.cancelProofreading,
  proofreadDocument: client.proofreadDocument,
  suggestSpelling: async () => [],
}));

import { NoteProofreading, NoteProofreadingPopover } from "./note-proofreading";

const editors: Editor[] = [];

function mount(proofreading: NoteProofreading, html: string, host: HTMLElement = document.body): Editor {
  const element = document.createElement("div");
  host.append(element);
  const editor = new Editor({ element, extensions: [StarterKit, proofreading.extension], content: html });
  editors.push(editor);
  return editor;
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function requests(): Request[] {
  return client.proofreadDocument.mock.calls.map(([request]) => request as Request);
}

function findings(editor: Editor): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>("[data-proofreading-issue]")];
}

function open(editor: Editor) {
  act(() => {
    findings(editor)[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

function dialogs(): HTMLElement[] {
  return screen.queryAllByRole("dialog", { name: en.visual.proofreadingPanel });
}

function notInDictionary(word: string): string {
  return en.package.spellcheck.notInDictionary.replace("{{word}}", word);
}

beforeEach(() => {
  vi.useFakeTimers();
  const rect = new DOMRect(10, 10, 40, 16);
  Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => rect;
  client.words = ["Speling", "Wrod"];
  client.proofreadDocument.mockReset();
  client.proofreadDocument.mockImplementation(async (request: Request) => ({
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
            suggestions: [],
            rule: null,
          } as ProofreadingDiagnostic];
    }),
  }));
  client.cancelProofreading.mockReset();
  useDictionary.setState({ ignored: { paper: ["Oleafly"] }, global: ["mine"], suppressed: {}, revision: 0 });
  useSettingsStore.setState({ notesSpellcheck: true, dictionaryLocale: "en_GB" });
  useFilesStore.setState({ projectId: null, projectDictionaryLocale: null });
  useProofreadingStore.getState().clear("notes");
});

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("note proofreading requests", () => {
  it("checks a personal note for spelling with the app dictionary language and personal words", async () => {
    mount(new NoteProofreading({ id: "idea" }), "<p>Speling here.</p>");
    await settle();
    const [request] = requests();
    expect(request).toMatchObject({
      mode: "spelling",
      ignoredWords: ["mine"],
      preferences: { dictionaryLocale: "en_GB" },
      identity: { surface: "notes", projectId: null },
    });
    expect(request.identity.path).toMatch(/^notes\/\d+\/idea$/u);
  });

  it("checks a note in the open project with that project's language and ignored words", async () => {
    useFilesStore.setState({ projectId: "paper", projectDictionaryLocale: "de_DE" });
    mount(new NoteProofreading({ id: "key", home: { projectId: "paper", path: "Notes/a.md" } }), "<p>Speling.</p>");
    await settle();
    expect(requests()[0]).toMatchObject({
      ignoredWords: ["mine", "Oleafly"],
      preferences: { dictionaryLocale: "de_DE" },
      identity: { surface: "notes", projectId: "paper" },
    });
  });

  it("gives two editors of the same note their own lanes", async () => {
    mount(new NoteProofreading({ id: "idea" }), "<p>One.</p>");
    mount(new NoteProofreading({ id: "idea" }), "<p>Two.</p>");
    await settle();
    const [first, second] = requests().map((request) => request.identity.path);
    expect(first).not.toBe(second);
  });

  it("leaves tags out of the check and turns the WebView's own spell check off", async () => {
    client.words = ["Speling", "projectx"];
    const editor = mount(new NoteProofreading({ id: "idea" }), "<p>Speling #projectx here.</p>");
    await settle();
    expect(requests()[0].text).not.toContain("projectx");
    expect(findings(editor).map((node) => node.textContent)).toEqual(["Speling"]);
    expect(editor.view.dom.getAttribute("spellcheck")).toBe("false");
  });
});

describe("Check spelling in notes", () => {
  it("turns note proofreading on and off", async () => {
    useSettingsStore.setState({ notesSpellcheck: false });
    const proofreading = new NoteProofreading({ id: "idea" });
    const editor = mount(proofreading, "<p>Speling here.</p>");
    render(<NoteProofreadingPopover editor={editor} proofreading={proofreading} />);
    await settle();
    expect(client.proofreadDocument).not.toHaveBeenCalled();

    act(() => useSettingsStore.setState({ notesSpellcheck: true }));
    await settle(800);
    expect(findings(editor)).toHaveLength(1);

    open(editor);
    expect(dialogs()).toHaveLength(1);
    act(() => useSettingsStore.setState({ notesSpellcheck: false }));
    expect(findings(editor)).toEqual([]);
    expect(dialogs()).toEqual([]);
    await settle(800);
    expect(client.proofreadDocument).toHaveBeenCalledOnce();
  });
});

describe("the note suggestion popover", () => {
  it("shows the same popover as the Visual editor, one note at a time", async () => {
    const first = new NoteProofreading({ id: "a" });
    const second = new NoteProofreading({ id: "b" });
    const one = mount(first, "<p>Speling one.</p>");
    const two = mount(second, "<p>Wrod two.</p>");
    render(
      <>
        <NoteProofreadingPopover editor={one} proofreading={first} />
        <NoteProofreadingPopover editor={two} proofreading={second} />
      </>,
    );
    await settle();

    open(one);
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]).toHaveTextContent(notInDictionary("Speling"));
    expect(screen.getByText(en.visual.ignoreEverywhere)).toBeInTheDocument();
    expect(screen.queryByText(en.visual.ignoreInProject)).not.toBeInTheDocument();

    open(two);
    expect(dialogs()).toHaveLength(1);
    expect(dialogs()[0]).toHaveTextContent(notInDictionary("Wrod"));
  });

  it("closes and stops checking while the note is hidden, then catches up", async () => {
    const pane = document.createElement("div");
    document.body.append(pane);
    const proofreading = new NoteProofreading({ id: "idea" });
    const editor = mount(proofreading, "<p>Speling here.</p>", pane);
    render(<NoteProofreadingPopover editor={editor} proofreading={proofreading} />);
    await settle();
    open(editor);
    expect(dialogs()).toHaveLength(1);

    pane.setAttribute("inert", "");
    await settle();
    expect(dialogs()).toEqual([]);
    act(() => {
      editor.commands.insertContentAt(1, "Wrod ");
    });
    await settle(800);
    expect(client.proofreadDocument).toHaveBeenCalledOnce();

    pane.removeAttribute("inert");
    await settle();
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
    expect(findings(editor).map((node) => node.textContent)).toEqual(["Wrod", "Speling"]);
  });
});
