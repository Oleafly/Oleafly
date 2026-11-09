// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  apply: vi.fn(() => true),
  ignore: vi.fn(() => true),
  current: vi.fn(() => true),
  group: vi.fn((): unknown => null),
  suggest: vi.fn(async (): Promise<{ text: string; kind: 0 | 1 | 2 }[]> => []),
}));

vi.mock("@/lib/proofreading/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proofreading/client")>()),
  suggestSpelling: mocks.suggest,
}));
vi.mock("@/lib/proofreading/effective-locale", () => ({ currentDictionaryLocale: () => "en-US" }));
vi.mock("./proofreading", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./proofreading")>()),
  applyVisualProofreadingSuggestion: mocks.apply,
  ignoreVisualProofreadingIssue: mocks.ignore,
  isVisualProofreadingIssueCurrent: mocks.current,
  visualProofreadingIssueGroup: mocks.group,
}));

import type { VisualProofreadingIssue } from "./proofreading";
import { ProofreadingPopover } from "./ProofreadingPopover";

const visual = en.visual;
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) => String(values[name] ?? ""));

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function issue(extra: Partial<VisualProofreadingIssue> = {}): VisualProofreadingIssue {
  return {
    id: "issue-1",
    from: 10,
    to: 15,
    message: "Use a comma here.",
    kind: "Punctuation",
    source: "harper",
    word: "teh",
    suggestions: [{ text: "the", kind: 0 }],
    rule: null,
    path: "main.tex",
    projectId: "paper",
    documentVersion: 1,
    revision: 1,
    requestGeneration: 1,
    ...extra,
  };
}

function fakeEditor(options: { editable?: boolean; at?: (pos: number) => Box } = {}) {
  const at = options.at ?? ((pos: number) => ({ left: pos * 10, right: pos * 10, top: 200, bottom: 216 }));
  const focus = vi.fn();
  const editor = { isEditable: options.editable ?? true, view: { coordsAtPos: vi.fn(at), focus } } as unknown as Editor;
  return { editor, focus };
}

function open(found: VisualProofreadingIssue = issue(), options: Parameters<typeof fakeEditor>[0] & { locale?: string } = {}) {
  const { editor, focus } = fakeEditor(options);
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const view = render(
    <ProofreadingPopover editor={editor} issue={found} locale={options.locale} onClose={onClose} onNavigate={onNavigate} />,
  );
  return { ...view, editor, focus, onClose, onNavigate, panel: screen.getByRole("dialog", { name: visual.proofreadingPanel }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apply.mockReturnValue(true);
  mocks.ignore.mockReturnValue(true);
  mocks.current.mockReturnValue(true);
  mocks.group.mockReturnValue(null);
  mocks.suggest.mockResolvedValue([]);
});

describe("the proofreading popover", () => {
  it("names a grammar finding and offers its fix and both ignore choices", () => {
    const { panel } = open();
    expect(panel).toHaveTextContent(visual.grammarAndStyle);
    expect(panel).toHaveTextContent("Use a comma here.");
    expect(within(panel).getByRole("group", { name: visual.suggestedFixes })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: fill(visual.suggestionReplaceText, { text: "the" }) })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: visual.ignoreInProject })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: visual.ignoreEverywhere })).toBeInTheDocument();
  });

  it("names a spelling finding by its word", () => {
    const { panel } = open(issue({ source: "hunspell", message: "" }));
    expect(panel).toHaveTextContent(visual.spelling);
    expect(panel).toHaveTextContent(fill(en.package.spellcheck.notInDictionary, { word: "teh" }));
  });

  it("labels each kind of fix, drops repeats and offers at most eight", () => {
    const suggestions: VisualProofreadingIssue["suggestions"] = [
      { text: "", kind: 1 },
      { text: ",", kind: 2 },
      { text: "", kind: 2 },
      { text: "", kind: 0 },
      { text: "the", kind: 0 },
      { text: "the", kind: 0 },
      ...["tea", "ten", "tee", "toe", "tie"].map((text) => ({ text, kind: 0 as const })),
    ];
    const { panel } = open(issue({ suggestions }));
    const fixes = within(within(panel).getByRole("group", { name: visual.suggestedFixes })).getAllByRole("button");
    expect(fixes.map((fix) => fix.textContent)).toEqual([
      visual.suggestionRemove,
      fill(visual.suggestionInsertText, { text: "," }),
      visual.suggestionInsert,
      visual.suggestionReplace,
      fill(visual.suggestionReplaceText, { text: "the" }),
      fill(visual.suggestionReplaceText, { text: "tea" }),
      fill(visual.suggestionReplaceText, { text: "ten" }),
      fill(visual.suggestionReplaceText, { text: "tee" }),
    ]);
  });

  it("applies a fix and closes, but stays open when the fix no longer fits the text", () => {
    const found = issue();
    const { panel, editor, onClose } = open(found);
    const fix = within(panel).getByRole("button", { name: fill(visual.suggestionReplaceText, { text: "the" }) });
    mocks.apply.mockReturnValueOnce(false);
    fireEvent.click(fix);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(fix);
    expect(mocks.apply).toHaveBeenLastCalledWith(editor, found, { text: "the", kind: 0 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores in the project or everywhere and closes", () => {
    const found = issue();
    const { panel, editor, onClose } = open(found);
    fireEvent.click(within(panel).getByRole("button", { name: visual.ignoreInProject }));
    expect(mocks.ignore).toHaveBeenLastCalledWith(editor, found, "project");
    mocks.ignore.mockReturnValueOnce(false);
    fireEvent.click(within(panel).getByRole("button", { name: visual.ignoreEverywhere }));
    expect(mocks.ignore).toHaveBeenLastCalledWith(editor, found, "global");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers only Ignore everywhere outside a project, and no fixes in a read-only editor", () => {
    const { panel } = open(issue({ projectId: null }), { editable: false });
    expect(within(panel).queryByRole("group", { name: visual.suggestedFixes })).toBeNull();
    expect(within(panel).queryByRole("button", { name: visual.ignoreInProject })).toBeNull();
    expect(within(panel).getByRole("button", { name: visual.ignoreEverywhere })).toBeInTheDocument();
  });

  it("looks up spelling fixes that were left for later in the note's language", async () => {
    let deliver: (found: { text: string; kind: 0 }[]) => void = () => {};
    mocks.suggest.mockImplementationOnce(() => new Promise((resolve) => (deliver = resolve)));
    const { panel } = open(issue({ source: "hunspell", suggestions: [], suggestionsDeferred: true }), { locale: "en-GB" });
    expect(mocks.suggest).toHaveBeenCalledWith("teh", "en-GB");
    expect(panel).toHaveTextContent(visual.findingSuggestions);
    await act(async () => deliver([{ text: "the", kind: 0 }]));
    expect(panel).not.toHaveTextContent(visual.findingSuggestions);
    expect(within(panel).getByRole("button", { name: fill(visual.suggestionReplaceText, { text: "the" }) })).toBeInTheDocument();
  });

  it("uses the dictionary language when none is given, and never looks up fixes it cannot apply", () => {
    open(issue({ id: "a", source: "hunspell", suggestions: [], suggestionsDeferred: true })).unmount();
    expect(mocks.suggest).toHaveBeenCalledWith("teh", "en-US");
    mocks.suggest.mockClear();
    open(issue({ id: "b", source: "hunspell", suggestions: [], suggestionsDeferred: true }), { editable: false });
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it("steps through the other findings in the same block", () => {
    const previous = issue({ id: "issue-0" });
    const next = issue({ id: "issue-2" });
    mocks.group.mockReturnValue({ current: issue(), index: 1, count: 3, previous, next });
    const { panel, onNavigate, rerender, editor, onClose } = open();
    expect(panel).toHaveTextContent(fill(visual.findingPosition, { index: 2, count: 3 }));
    fireEvent.click(within(panel).getByRole("button", { name: visual.previousFinding }));
    expect(onNavigate).toHaveBeenLastCalledWith(previous);
    fireEvent.click(within(panel).getByRole("button", { name: visual.nextFinding }));
    expect(onNavigate).toHaveBeenLastCalledWith(next);
    mocks.group.mockReturnValue({ current: issue(), index: 2, count: 3, previous, next: null });
    rerender(<ProofreadingPopover editor={editor} issue={issue()} onClose={onClose} onNavigate={onNavigate} />);
    expect(within(panel).getByRole("button", { name: visual.nextFinding })).toBeDisabled();
  });

  it("hides the finding count when the block has only one", () => {
    mocks.group.mockReturnValue({ current: issue(), index: 0, count: 1, previous: null, next: null });
    const { panel } = open();
    expect(within(panel).queryByRole("button", { name: visual.nextFinding })).toBeNull();
  });

  it("focuses the first fix, or the first ignore choice when there is no fix", async () => {
    const first = open();
    await waitFor(() =>
      expect(within(first.panel).getByRole("button", { name: fill(visual.suggestionReplaceText, { text: "the" }) })).toHaveFocus(),
    );
    first.unmount();
    const second = open(issue({ suggestions: [] }));
    await waitFor(() => expect(within(second.panel).getByRole("button", { name: visual.ignoreInProject })).toHaveFocus());
  });

  it("moves between its actions with the arrow keys, Home and End, wrapping at the ends", async () => {
    const { panel } = open();
    const buttons = within(panel).getAllByRole("button");
    await waitFor(() => expect(buttons[1]).toHaveFocus());
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(buttons[2]).toHaveFocus();
    fireEvent.keyDown(panel, { key: "End" });
    expect(buttons.at(-1)).toHaveFocus();
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(buttons.at(-1)).toHaveFocus();
    fireEvent.keyDown(panel, { key: "Home" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(panel, { key: "a" });
    expect(buttons[0]).toHaveFocus();
  });

  it("closes with Escape or the close button and hands focus back to the editor", async () => {
    const { panel, onClose, focus } = open();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(focus).toHaveBeenCalledOnce());
    fireEvent.click(within(panel).getByRole("button", { name: visual.closeProofreading }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on a click outside, but not on a click on another finding", () => {
    const { onClose } = open();
    const finding = document.createElement("span");
    finding.dataset.proofreadingIssue = "issue-2";
    document.body.append(finding);
    fireEvent.pointerDown(finding);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
    finding.remove();
  });

  it("sits under the word, kept inside the window", () => {
    const { panel } = open();
    expect(panel).toHaveStyle({ left: "8px", top: "224px" });
  });

  it("moves above the word when there is no room below it", () => {
    const { panel } = open(issue(), { at: (pos) => ({ left: 400 + pos, right: 400 + pos, top: 700, bottom: 716 }) });
    expect(panel).toHaveStyle({ left: `${412.5 - 160}px`, top: `${700 - 240 - 8}px` });
  });

  it("closes when the word scrolls out of view or the finding is gone", () => {
    let top = 200;
    const scrolled = open(issue(), { at: (pos) => ({ left: pos, right: pos, top, bottom: top + 16 }) });
    expect(scrolled.onClose).not.toHaveBeenCalled();
    top = -400;
    fireEvent.scroll(document);
    expect(scrolled.onClose).toHaveBeenCalledOnce();
    scrolled.unmount();
    mocks.current.mockReturnValue(false);
    expect(open().onClose).toHaveBeenCalled();
  });
});
