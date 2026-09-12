// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import type { VisualProofreadingIssue } from "./proofreading";

const proofreading = vi.hoisted(() => ({
  listener: null as null | ((issue: VisualProofreadingIssue | null) => void),
  group: null as null | {
    current: VisualProofreadingIssue;
    index: number;
    count: number;
    previous: VisualProofreadingIssue | null;
    next: VisualProofreadingIssue | null;
  },
  apply: vi.fn(() => true),
  ignore: vi.fn(() => true),
  refresh: vi.fn(),
  current: vi.fn(() => true),
}));

vi.mock("./proofreading", async () => {
  const { Extension } = await import("@tiptap/core");
  return {
    VisualProofreading: Extension.create({ name: "visualProofreadingTestStub" }),
    refreshVisualProofreading: proofreading.refresh,
    setVisualProofreadingIssueListener: (
      listener: null | ((issue: VisualProofreadingIssue | null) => void),
    ) => {
      proofreading.listener = listener;
    },
    isVisualProofreadingIssueCurrent: proofreading.current,
    visualProofreadingIssueGroup: () => proofreading.group,
    applyVisualProofreadingSuggestion: proofreading.apply,
    ignoreVisualProofreadingIssue: proofreading.ignore,
  };
});

import { WysiwygEditor } from "./WysiwygEditor";

const visual = en.visual;

const LATEX = `\\documentclass{article}
\\begin{document}
\\section{Intro}
Hello.
\\end{document}
`;

function issueWith(overrides: Partial<VisualProofreadingIssue> = {}): VisualProofreadingIssue {
  return {
    id: "issue-1",
    path: "main.tex",
    projectId: "project",
    documentVersion: 1,
    revision: 1,
    requestGeneration: 1,
    from: 1,
    to: 2,
    message: "Consider a shorter word.",
    kind: "Spelling",
    source: "hunspell",
    word: "Hello",
    rule: null,
    suggestions: [],
    ...overrides,
  } as VisualProofreadingIssue;
}

async function settleFrames() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

function show(issue: VisualProofreadingIssue) {
  render(<WysiwygEditor wysiwyg={true} />);
  act(() => proofreading.listener?.(issue));
  return screen.getByRole("dialog", { name: visual.proofreadingPanel });
}

describe("WysiwygEditor proofreading popover", () => {
  beforeEach(() => {
    const rect = new DOMRect(10, 10, 40, 16);
    Range.prototype.getClientRects = () =>
      [rect] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect;
    vi.clearAllMocks();
    proofreading.listener = null;
    proofreading.group = null;
    proofreading.apply.mockReturnValue(true);
    proofreading.ignore.mockReturnValue(true);
    proofreading.current.mockReturnValue(true);
    useFilesStore.setState({
      projectId: null,
      activePath: "main.tex",
      files: { "main.tex": { content: LATEX, dirty: false } },
    } as unknown as ReturnType<typeof useFilesStore.getState>);
  });

  it("names every suggestion shape and both ignore scopes", () => {
    const panel = show(
      issueWith({
        suggestions: [
          { kind: 1, text: "" },
          { kind: 2, text: "and" },
          { kind: 2, text: "" },
          { kind: 0, text: "Hello" },
          { kind: 0, text: "" },
        ],
      }),
    );

    expect(panel).toHaveTextContent(visual.spelling);
    expect(panel).toHaveTextContent("Consider a shorter word.");
    expect(screen.getByText(visual.suggestionRemove)).toBeInTheDocument();
    expect(
      screen.getByText(visual.suggestionInsertText.replace("{{text}}", "and")),
    ).toBeInTheDocument();
    expect(screen.getByText(visual.suggestionInsert)).toBeInTheDocument();
    expect(
      screen.getByText(visual.suggestionReplaceText.replace("{{text}}", "Hello")),
    ).toBeInTheDocument();
    expect(screen.getByText(visual.suggestionReplace)).toBeInTheDocument();
    expect(screen.getByText(visual.suggestedFixes)).toBeInTheDocument();
    expect(screen.getByText(visual.ignoreInProject)).toBeInTheDocument();
    expect(screen.getByText(visual.ignoreEverywhere)).toBeInTheDocument();
    expect(screen.getByText(visual.keyboardHint)).toBeInTheDocument();
    expect(screen.getByLabelText(visual.closeProofreading)).toBeInTheDocument();
  });

  it("labels a grammar finding and hides the project scope outside a project", () => {
    const panel = show(issueWith({ source: "harper", projectId: null }));

    expect(panel).toHaveTextContent(visual.grammarAndStyle);
    expect(screen.queryByText(visual.ignoreInProject)).not.toBeInTheDocument();
    expect(screen.queryByText(visual.suggestedFixes)).not.toBeInTheDocument();
    expect(screen.getByText(visual.ignoreEverywhere)).toBeInTheDocument();
  });

  it("applies a suggestion and closes the panel", () => {
    show(issueWith({ suggestions: [{ kind: 0, text: "Hallo" }] }));

    fireEvent.click(screen.getByText(visual.suggestionReplaceText.replace("{{text}}", "Hallo")));

    expect(proofreading.apply).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the panel open when the suggestion cannot be applied", () => {
    proofreading.apply.mockReturnValue(false);
    show(issueWith({ suggestions: [{ kind: 1, text: "" }] }));

    fireEvent.click(screen.getByText(visual.suggestionRemove));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignores a finding in the project and everywhere", () => {
    show(issueWith());
    fireEvent.click(screen.getByText(visual.ignoreInProject));
    expect(proofreading.ignore).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "issue-1" }),
      "project",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => proofreading.listener?.(issueWith()));
    fireEvent.click(screen.getByText(visual.ignoreEverywhere));
    expect(proofreading.ignore).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "issue-1" }),
      "global",
    );
  });

  it("steps between the findings of one raw block", () => {
    const previous = issueWith({ id: "issue-0" });
    const next = issueWith({ id: "issue-2" });
    const current = issueWith();
    proofreading.group = { current, index: 1, count: 3, previous, next };

    show(current);

    expect(
      screen.getByText(
        visual.findingPosition.replace("{{index}}", "2").replace("{{count}}", "3"),
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(visual.nextFinding));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(visual.previousFinding));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables the step buttons at the ends of a raw block", () => {
    const current = issueWith();
    proofreading.group = { current, index: 0, count: 2, previous: null, next: null };

    show(current);

    expect(screen.getByLabelText(visual.previousFinding)).toBeDisabled();
    expect(screen.getByLabelText(visual.nextFinding)).toBeDisabled();
  });

  it("closes from the close button and from Escape", async () => {
    const panel = show(issueWith());

    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    act(() => proofreading.listener?.(issueWith()));
    fireEvent.click(screen.getByLabelText(visual.closeProofreading));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await settleFrames();
  });

  it("moves the action focus with the arrow, Home and End keys", () => {
    const panel = show(
      issueWith({
        suggestions: [
          { kind: 0, text: "one" },
          { kind: 0, text: "two" },
        ],
      }),
    );
    const actions = Array.from(panel.querySelectorAll("button"));

    fireEvent.keyDown(panel, { key: "Home" });
    expect(document.activeElement).toBe(actions[0]);

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(actions[1]);

    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(document.activeElement).toBe(actions[0]);

    fireEvent.keyDown(panel, { key: "End" });
    expect(document.activeElement).toBe(actions[actions.length - 1]);

    fireEvent.keyDown(panel, { key: "a" });
    expect(document.activeElement).toBe(actions[actions.length - 1]);
  });

  it("drops the panel when the finding no longer matches the document", () => {
    proofreading.current.mockReturnValue(false);

    render(<WysiwygEditor wysiwyg={true} />);
    act(() => proofreading.listener?.(issueWith()));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
