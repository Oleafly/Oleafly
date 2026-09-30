// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TurnChange, TurnChanges, TurnFilePreview, TurnRevertResult } from "@/lib/agent-turns";

vi.mock("@/lib/agent-turns", async (original) => ({
  ...(await original<typeof import("@/lib/agent-turns")>()),
  agentTurnStatus: vi.fn(),
  agentTurnPreview: vi.fn(),
  agentTurnRevert: vi.fn(),
  agentTurnRedo: vi.fn(),
}));
vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: ({ path, oldText, newText, ariaLabel }: { path: string; oldText: string; newText: string; ariaLabel?: string }) => (
    <section data-testid="inline-diff" data-path={path} aria-label={ariaLabel}>{`${oldText} -> ${newText}`}</section>
  ),
}));

import { agentTurnPreview, agentTurnRedo, agentTurnRevert, agentTurnStatus } from "@/lib/agent-turns";
import type { ProjectStateChanged } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { beginChatRun, endChatRun } from "@/components/ai/chat-run-registry";
import { deferred, initTestI18n, session } from "@/components/ai/acp/tests/ui-fixtures";
import { useTurnReviewStore } from "./turn-review-store";
import { TurnChangesCard } from "./TurnChangesCard";

beforeAll(async () => {
  await initTestI18n();
});

const PROJECT_STATE = { projectId: "paper" } as unknown as ProjectStateChanged;
const mutation = vi.fn();

function file(index: number, path: string, overrides: Partial<TurnChange> = {}): TurnChange {
  return {
    index, path, change: "modified", beforeSize: 10, afterSize: 12, added: 2, removed: 1,
    alsoEditedHere: false, build: false, ...overrides,
  };
}

function changes(overrides: Partial<TurnChanges> = {}): TurnChanges {
  return {
    snapshotId: "snap-1",
    files: [file(0, "main.tex", { added: 3, removed: 1 }), file(1, "refs.bib", { change: "added", added: 2, removed: 0 })],
    moreFiles: 0,
    skipped: [],
    overlapped: false,
    unavailable: null,
    ...overrides,
  };
}

function preview(index: number, path: string, overrides: Partial<TurnFilePreview> = {}): TurnFilePreview {
  return { index, path, change: "modified", before: "old text", after: "new text", binary: false, tooLarge: false, state: "applied", ...overrides };
}

function result(reverted: number[], skipped: TurnRevertResult["skipped"] = []): TurnRevertResult {
  return { reverted, skipped, projectState: PROJECT_STATE };
}

beforeEach(() => {
  vi.resetAllMocks();
  useTurnReviewStore.getState().reset();
  useAcpSessionsStore.setState({ sessions: {} });
  vi.mocked(agentTurnStatus).mockResolvedValue({ expired: false, files: [] });
  mutation.mockImplementation(async (_projectId: string, action: (generation: number) => Promise<unknown>) => action(7));
  useFilesStore.setState({ runExternalProjectMutation: mutation as never });
});
afterEach(() => cleanup());

function card() {
  return screen.getByTestId("turn-changes");
}

async function expand() {
  const review = within(card()).getByRole("button", { name: "Review" });
  fireEvent.click(review);
  await waitFor(() => expect(review).toHaveAttribute("aria-expanded", "true"));
}

describe("TurnChangesCard", () => {
  it("renders nothing when the turn changed no files", () => {
    const { container } = render(<TurnChangesCard projectId="paper" changes={changes({ files: [] })} />);
    expect(container).toBeEmptyDOMElement();
    expect(agentTurnStatus).not.toHaveBeenCalled();
  });

  it("shows one line with the count, line totals, Review and Undo all", async () => {
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    expect(card()).toHaveAttribute("data-tour", "ai-turn-changes");
    expect(card()).toHaveTextContent("Changed 2 files");
    expect(card()).toHaveTextContent("+5");
    expect(card()).toHaveTextContent("-1");
    const review = within(card()).getByRole("button", { name: "Review" });
    expect(review).toHaveAttribute("aria-expanded", "false");
    expect(review).toHaveAttribute("aria-controls");
    expect(within(card()).getByRole("button", { name: "Undo all" })).toBeEnabled();
    expect(within(card()).queryByText("main.tex")).toBeNull();
    await waitFor(() => expect(agentTurnStatus).toHaveBeenCalledWith("paper", "snap-1"));
  });

  it("re-reads file states from disk each time Review opens", async () => {
    vi.mocked(agentTurnStatus)
      .mockResolvedValueOnce({ expired: false, files: [] })
      .mockResolvedValue({ expired: false, files: [{ index: 0, state: "edited" }] });
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    await waitFor(() => expect(agentTurnStatus).toHaveBeenCalledTimes(1));
    await expand();
    await waitFor(() => expect(within(card()).getAllByRole("listitem")[0]).toHaveTextContent("Changed after this turn"));
    expect(agentTurnStatus).toHaveBeenCalledTimes(2);
  });

  it("lists the files, loads one diff at a time, and shows loading and errors", async () => {
    const first = deferred<TurnFilePreview>();
    vi.mocked(agentTurnPreview).mockImplementation(async (_project, _snapshot, index) =>
      index === 0 ? first.promise : Promise.reject(new Error("blob missing")),
    );
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    await expand();
    const rows = within(card()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("main.tex");
    expect(rows[0]).toHaveTextContent("Modified");
    expect(rows[1]).toHaveTextContent("Added");

    const mainToggle = within(rows[0]).getByRole("button", { name: "main.tex" });
    fireEvent.click(mainToggle);
    expect(mainToggle).toHaveAttribute("aria-expanded", "true");
    expect(await within(card()).findByText("Loading the change…")).toBeInTheDocument();
    await act(async () => first.resolve(preview(0, "main.tex")));
    const diff = await within(card()).findByTestId("inline-diff");
    expect(diff).toHaveTextContent("old text -> new text");
    expect(diff).toHaveAttribute("aria-label", "Change to main.tex");
    expect(agentTurnPreview).toHaveBeenCalledWith("paper", "snap-1", 0);

    fireEvent.click(within(rows[1]).getByRole("button", { name: "refs.bib" }));
    expect(mainToggle).toHaveAttribute("aria-expanded", "false");
    expect(await within(card()).findByRole("alert")).toHaveTextContent("Couldn't load this change.");
    expect(within(card()).queryByTestId("inline-diff")).toBeNull();
  });

  it("undoes one file through the project transaction and offers Redo in place", async () => {
    vi.mocked(agentTurnRevert).mockResolvedValue(result([0]));
    vi.mocked(agentTurnRedo).mockResolvedValue(result([0]));
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    await expand();
    const undo = within(card()).getByRole("button", { name: "Undo main.tex" });
    undo.focus();
    fireEvent.click(undo);
    await waitFor(() => expect(agentTurnRevert).toHaveBeenCalledWith("paper", "snap-1", [0], 7));
    expect(mutation).toHaveBeenCalledWith("paper", expect.any(Function));
    const redo = await within(card()).findByRole("button", { name: "Redo main.tex" });
    expect(redo).toBe(undo);
    expect(document.activeElement).toBe(redo);
    expect(within(card()).getAllByRole("listitem")[0]).toHaveTextContent("Undone");
    expect(within(card()).getByRole("status")).toHaveTextContent("Undid 1 file.");

    fireEvent.click(redo);
    await waitFor(() => expect(agentTurnRedo).toHaveBeenCalledWith("paper", "snap-1", [0], 7));
    await waitFor(() => expect(within(card()).getByRole("status")).toHaveTextContent("Redid 1 file."));
    expect(within(card()).getByRole("button", { name: "Undo main.tex" })).toBe(undo);
  });

  it("marks the pending action busy without moving focus", async () => {
    const pending = deferred<TurnRevertResult>();
    vi.mocked(agentTurnRevert).mockReturnValue(pending.promise);
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    await expand();
    const undo = within(card()).getByRole("button", { name: "Undo main.tex" });
    undo.focus();
    fireEvent.click(undo);
    await waitFor(() => expect(undo).toHaveAttribute("aria-busy", "true"));
    expect(document.activeElement).toBe(undo);
    expect(within(card()).getByRole("button", { name: "Undo all" })).toBeDisabled();
    fireEvent.click(undo);
    await act(async () => pending.resolve(result([0])));
    expect(agentTurnRevert).toHaveBeenCalledTimes(1);
  });

  it("undoes everything with one call, then reports a partly undone turn", async () => {
    vi.mocked(agentTurnRevert).mockResolvedValue(result([0], [{ index: 1, reason: "edited" }]));
    vi.mocked(agentTurnStatus)
      .mockResolvedValueOnce({ expired: false, files: [] })
      .mockResolvedValue({ expired: false, files: [{ index: 0, state: "undone" }, { index: 1, state: "edited" }] });
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    fireEvent.click(within(card()).getByRole("button", { name: "Undo all" }));
    await waitFor(() => expect(agentTurnRevert).toHaveBeenCalledWith("paper", "snap-1", null, 7));
    await waitFor(() =>
      expect(within(card()).getByRole("status")).toHaveTextContent(
        "Undid 1 file. Some files changed after this turn, so they were left as they are.",
      ),
    );
    await expand();
    const rows = within(card()).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Undone");
    expect(rows[1]).toHaveTextContent("Changed after this turn");
    expect(within(rows[1]).queryByRole("button", { name: /Undo|Redo/ })).toBeNull();
    expect(within(card()).getByRole("button", { name: "Redo all" })).toBeInTheDocument();
  });

  it("shows the card error copy when the undo fails", async () => {
    mutation.mockRejectedValue(new Error("The task could not be applied."));
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    fireEvent.click(within(card()).getByRole("button", { name: "Undo all" }));
    expect(await within(card()).findByRole("alert")).toHaveTextContent(
      "Couldn't undo the changes. Save your work and try again.",
    );
    expect(card()).not.toHaveTextContent("task");
  });

  it("says Undo is gone once the copy expired", async () => {
    vi.mocked(agentTurnStatus).mockResolvedValue({ expired: true, files: [] });
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    expect(await within(card()).findByText("Undo is no longer available for this turn.")).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: "Undo all" })).toBeNull();
    await expand();
    expect(within(card()).queryByRole("button", { name: /^Undo / })).toBeNull();
    expect(within(card()).getByText("main.tex")).toBeInTheDocument();
  });

  it("hides Undo all when another turn overlapped", async () => {
    render(<TurnChangesCard projectId="paper" changes={changes({ overlapped: true })} />);
    expect(within(card()).queryByRole("button", { name: "Undo all" })).toBeNull();
    expect(card()).toHaveTextContent("Another agent changed files at the same time. Undo files one by one.");
    await expand();
    expect(within(card()).getByRole("button", { name: "Undo main.tex" })).toBeEnabled();
  });

  it("flags files the user also edited and leaves them out of Undo all", async () => {
    const turn = changes({ files: [file(0, "main.tex", { alsoEditedHere: true })] });
    render(<TurnChangesCard projectId="paper" changes={turn} />);
    expect(within(card()).queryByRole("button", { name: "Undo all" })).toBeNull();
    await expand();
    expect(card()).toHaveTextContent("You also edited this file during the turn");
    expect(within(card()).getByRole("button", { name: "Undo main.tex" })).toBeEnabled();
  });

  it("groups build files without Undo and does not count them", async () => {
    const turn = changes({
      files: [file(0, "main.tex"), file(1, "main.aux", { build: true }), file(2, "main.pdf", { build: true, added: null, removed: null })],
    });
    render(<TurnChangesCard projectId="paper" changes={turn} />);
    expect(card()).toHaveTextContent("Changed 1 file");
    await expand();
    expect(within(card()).getAllByRole("listitem")).toHaveLength(1);
    const group = within(card()).getByRole("button", { name: "Build files updated" });
    expect(group).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(group);
    expect(card()).toHaveTextContent("main.aux");
    expect(within(card()).queryByRole("button", { name: "Undo main.aux" })).toBeNull();
  });

  it("names a turn that only rebuilt output files", () => {
    render(<TurnChangesCard projectId="paper" changes={changes({ files: [file(0, "main.log", { build: true })] })} />);
    expect(card()).toHaveTextContent("Build files updated");
    expect(within(card()).queryByRole("button", { name: "Undo all" })).toBeNull();
  });

  it("keeps Undo disabled while any turn in the project is running", async () => {
    useAcpSessionsStore.setState({ sessions: { live: session("live", { projectId: "paper", status: "running" }) } });
    const { rerender } = render(<TurnChangesCard projectId="paper" changes={changes()} />);
    const undoAll = within(card()).getByRole("button", { name: "Undo all" });
    expect(undoAll).toBeDisabled();
    expect(undoAll).toHaveAttribute("title", "Undo is available when the agent finishes.");
    act(() => useAcpSessionsStore.setState({ sessions: { task: session("task", { projectId: "paper", status: "running", taskId: "task-1" }) } }));
    rerender(<TurnChangesCard projectId="paper" changes={changes()} />);
    expect(undoAll).toBeEnabled();
    const run = beginChatRun(new AbortController(), "paper");
    await waitFor(() => expect(undoAll).toBeDisabled());
    act(() => endChatRun(run));
    await waitFor(() => expect(undoAll).toBeEnabled());
  });

  it("shows committed files without Undo and leaves them out of Undo all", async () => {
    vi.mocked(agentTurnRevert).mockResolvedValue(result([1]));
    render(<TurnChangesCard projectId="paper" changes={{ ...changes(), committed: { "main.tex": "abc1234def" } }} />);
    fireEvent.click(within(card()).getByRole("button", { name: "Undo all" }));
    await waitFor(() => expect(agentTurnRevert).toHaveBeenCalledWith("paper", "snap-1", [1], 7));
    await expand();
    const rows = within(card()).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Committed in abc1234");
    expect(within(rows[0]).queryByRole("button", { name: /Undo|Redo/ })).toBeNull();
  });

  it("shows the unavailable line only where the host asks for it", () => {
    const turn = changes({ files: [], snapshotId: null, unavailable: "too_large" });
    const { rerender, container } = render(<TurnChangesCard projectId="paper" changes={turn} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<TurnChangesCard projectId="paper" changes={turn} showUnavailable />);
    expect(container).toHaveTextContent("Undo isn't available for this turn: the project is too large to copy.");
  });

  it("keeps its state when the row scrolls away and comes back", async () => {
    vi.mocked(agentTurnRevert).mockResolvedValue(result([0]));
    const first = render(<TurnChangesCard projectId="paper" changes={changes()} />);
    await expand();
    fireEvent.click(within(card()).getByRole("button", { name: "Undo main.tex" }));
    await within(card()).findByRole("button", { name: "Redo main.tex" });
    first.unmount();
    render(<TurnChangesCard projectId="paper" changes={changes()} />);
    expect(within(card()).getByRole("button", { name: "Review" })).toHaveAttribute("aria-expanded", "true");
    expect(within(card()).getByRole("button", { name: "Redo main.tex" })).toBeInTheDocument();
  });

  it("reaches the files beyond the list with Undo all and then Redo all", async () => {
    // Index 2 and 3 are the unlisted files (moreFiles = 2).
    vi.mocked(agentTurnRevert).mockResolvedValue(result([0, 1, 2, 3]));
    vi.mocked(agentTurnRedo).mockResolvedValue(result([0, 1, 2, 3]));
    vi.mocked(agentTurnStatus)
      .mockResolvedValueOnce({ expired: false, files: [] })
      .mockResolvedValueOnce({ expired: false, files: [{ index: 0, state: "undone" }, { index: 1, state: "undone" }] })
      .mockResolvedValue({ expired: false, files: [{ index: 0, state: "applied" }, { index: 1, state: "applied" }] });
    render(<TurnChangesCard projectId="paper" changes={changes({ moreFiles: 2 })} />);
    fireEvent.click(within(card()).getByRole("button", { name: "Undo all" }));
    await waitFor(() => expect(agentTurnRevert).toHaveBeenCalledWith("paper", "snap-1", null, 7));
    const redoAll = await within(card()).findByRole("button", { name: "Redo all" });
    fireEvent.click(redoAll);
    await waitFor(() => expect(agentTurnRedo).toHaveBeenCalledWith("paper", "snap-1", null, 7));
    expect(await within(card()).findByRole("button", { name: "Undo all" })).toBeInTheDocument();
  });

  it("keeps Redo all while only unlisted files are undone", async () => {
    vi.mocked(agentTurnRevert).mockResolvedValue(result([2, 3], [{ index: 0, reason: "edited" }, { index: 1, reason: "edited" }]));
    vi.mocked(agentTurnStatus)
      .mockResolvedValueOnce({ expired: false, files: [] })
      .mockResolvedValue({ expired: false, files: [{ index: 0, state: "edited" }, { index: 1, state: "edited" }] });
    render(<TurnChangesCard projectId="paper" changes={changes({ moreFiles: 2 })} />);
    fireEvent.click(within(card()).getByRole("button", { name: "Undo all" }));
    await waitFor(() => expect(agentTurnRevert).toHaveBeenCalledWith("paper", "snap-1", null, 7));
    expect(await within(card()).findByRole("button", { name: "Redo all" })).toBeInTheDocument();
  });

  it("still undoes the unlisted files after one listed file was undone", async () => {
    vi.mocked(agentTurnRevert).mockResolvedValueOnce(result([0])).mockResolvedValue(result([0, 1, 2]));
    render(<TurnChangesCard projectId="paper" changes={changes({ moreFiles: 1 })} />);
    await expand();
    fireEvent.click(within(card()).getByRole("button", { name: "Undo main.tex" }));
    await within(card()).findByRole("button", { name: "Redo main.tex" });
    fireEvent.click(within(card()).getByRole("button", { name: "Undo all" }));
    await waitFor(() => expect(agentTurnRevert).toHaveBeenCalledTimes(2));
    expect(agentTurnRevert).toHaveBeenLastCalledWith("paper", "snap-1", null, 7);
  });

  it("lists only the uncommitted files for Undo all when unlisted files exist", async () => {
    vi.mocked(agentTurnRevert).mockResolvedValue(result([1]));
    render(
      <TurnChangesCard
        projectId="paper"
        changes={{ ...changes({ moreFiles: 3 }), committed: { "main.tex": "abc1234def" } }}
      />,
    );
    fireEvent.click(within(card()).getByRole("button", { name: "Undo all" }));
    await waitFor(() => expect(agentTurnRevert).toHaveBeenCalledWith("paper", "snap-1", [1], 7));
  });

  it("never sends null while a committed file exists, even an unlisted one", async () => {
    vi.mocked(agentTurnRevert).mockResolvedValue(result([0, 1]));
    render(
      <TurnChangesCard
        projectId="paper"
        changes={{ ...changes({ moreFiles: 3 }), committed: { "chapters/late.tex": "abc1234def" } }}
      />,
    );
    fireEvent.click(within(card()).getByRole("button", { name: "Undo all" }));
    await waitFor(() => expect(agentTurnRevert).toHaveBeenCalledWith("paper", "snap-1", [0, 1], 7));
  });

  it("mentions files beyond the list and files that could not be copied", async () => {
    render(
      <TurnChangesCard
        projectId="paper"
        changes={changes({ moreFiles: 4, skipped: [{ path: "data/huge.csv", reason: "too_large" }] })}
      />,
    );
    expect(card()).toHaveTextContent("Changed 6 files");
    await expand();
    expect(card()).toHaveTextContent("4 more files aren't listed");
    expect(card()).toHaveTextContent("1 file couldn't be copied before the turn, so Undo can't put it back.");
  });
});
