// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
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
import { destroyKbEditors, kbEditor } from "./tests/kb-editor-fixtures";

function mount(proofreading: NoteProofreading, markdown: string, host: HTMLElement = document.body): Editor {
  const editor = kbEditor(markdown, undefined, [proofreading.extension]);
  host.append(editor.view.dom.parentElement as HTMLElement);
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
  useSettingsStore.setState({
    notesSpellcheck: true,
    harper: false,
    dictionaryLocale: "en_GB",
    grammarDialect: "american",
    showRegionalism: true,
    showWordChoice: true,
  });
  useFilesStore.setState({ projectId: null, projectDictionaryLocale: null });
  useProofreadingStore.getState().clear("notes");
});

afterEach(() => {
  cleanup();
  destroyKbEditors();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("note proofreading requests", () => {
  it("checks a personal note for spelling with the app dictionary language and personal words", async () => {
    mount(new NoteProofreading({ id: "idea" }), "Speling here.");
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
    mount(new NoteProofreading({ id: "key", home: { projectId: "paper", path: "Notes/a.md" } }), "Speling.");
    await settle();
    expect(requests()[0]).toMatchObject({
      ignoredWords: ["mine", "Oleafly"],
      preferences: { dictionaryLocale: "de_DE" },
      identity: { surface: "notes", projectId: "paper" },
    });
  });

  it("gives two editors of the same note their own lanes", async () => {
    mount(new NoteProofreading({ id: "idea" }), "One.");
    mount(new NoteProofreading({ id: "idea" }), "Two.");
    await settle();
    const [first, second] = requests().map((request) => request.identity.path);
    expect(first).not.toBe(second);
  });

  it("leaves tags out of the check and turns the WebView's own spell check off", async () => {
    client.words = ["Speling", "projectx"];
    const editor = mount(new NoteProofreading({ id: "idea" }), "Speling #projectx here.");
    await settle();
    expect(requests()[0].text).not.toContain("projectx");
    expect(findings(editor).map((node) => node.textContent)).toEqual(["Speling"]);
    expect(editor.view.dom.getAttribute("spellcheck")).toBe("false");
  });
});

describe("matching the Visual editor's settings", () => {
  it.each([
    [true, true, "combined"],
    [false, true, "grammar"],
    [true, false, "spelling"],
  ] as const)("checks a note with spelling %s and grammar %s as %s", async (notesSpellcheck, harper, mode) => {
    useSettingsStore.setState({ notesSpellcheck, harper });
    mount(new NoteProofreading({ id: "idea" }), "Speling here.");
    await settle();
    expect(requests()[0].mode).toBe(mode);
  });

  it("checks nothing when spelling in notes and grammar are both off", async () => {
    useSettingsStore.setState({ notesSpellcheck: false, harper: false });
    mount(new NoteProofreading({ id: "idea" }), "Speling here.");
    await settle(800);
    expect(client.proofreadDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["the dictionary language", () => useSettingsStore.setState({ dictionaryLocale: "de_DE" })],
    ["Grammar & style", () => useSettingsStore.setState({ harper: true })],
    ["the grammar dialect", () => useSettingsStore.setState({ grammarDialect: "british" })],
    ["regional wording", () => useSettingsStore.setState({ showRegionalism: false })],
    ["word choice", () => useSettingsStore.setState({ showWordChoice: false })],
    ["the personal word list", () => useDictionary.setState({ global: ["mine", "Speling"] })],
    ["a project's word list", () => useDictionary.setState({ ignored: { paper: ["Oleafly", "Speling"] } })],
  ])("checks the note again when %s changes", async (_name, change) => {
    const proofreading = new NoteProofreading({ id: "idea" });
    const editor = mount(proofreading, "Speling here.");
    render(<NoteProofreadingPopover editor={editor} proofreading={proofreading} />);
    await settle();
    expect(client.proofreadDocument).toHaveBeenCalledOnce();
    act(() => change());
    await settle(800);
    expect(client.proofreadDocument).toHaveBeenCalledTimes(2);
  });

  it("asks with the new dictionary language after it changes", async () => {
    const proofreading = new NoteProofreading({ id: "idea" });
    const editor = mount(proofreading, "Speling here.");
    render(<NoteProofreadingPopover editor={editor} proofreading={proofreading} />);
    await settle();
    act(() => useSettingsStore.setState({ dictionaryLocale: "de_DE" }));
    await settle(800);
    expect(requests().at(-1)?.preferences.dictionaryLocale).toBe("de_DE");
  });

  it("leaves unrelated settings alone", async () => {
    const proofreading = new NoteProofreading({ id: "idea" });
    const editor = mount(proofreading, "Speling here.");
    render(<NoteProofreadingPopover editor={editor} proofreading={proofreading} />);
    await settle();
    act(() => useSettingsStore.setState({ notesShowWordCount: false }));
    await settle(800);
    expect(client.proofreadDocument).toHaveBeenCalledOnce();
  });
});

describe("Check spelling in notes", () => {
  it("turns note proofreading on and off", async () => {
    useSettingsStore.setState({ notesSpellcheck: false });
    const proofreading = new NoteProofreading({ id: "idea" });
    const editor = mount(proofreading, "Speling here.");
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
    const one = mount(first, "Speling one.");
    const two = mount(second, "Wrod two.");
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
    const editor = mount(proofreading, "Speling here.", pane);
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
