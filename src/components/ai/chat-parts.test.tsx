// @vitest-environment jsdom

import { act, fireEvent, getByRole, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearExpansionState } from "./activity/expansion-state";
import { ResearchToolCard } from "./activity/ResearchToolCard";
import {
  AgentRunSummary,
  AgentStatusPill,
  ExecCard,
  MessageItem,
  ReasoningBlock,
  SubagentCard,
  ToolBadge,
} from "./chat-parts";

describe("SubagentCard", () => {
  it("shows a spinner and current tool while a subagent runs", () => {
    const { container, getByText } = render(
      <SubagentCard
        entry={{ id: "s1", label: "Survey diffusion", state: "tool", detail: "read_file" }}
      />,
    );
    const card = container.querySelector('[data-subagent-state="tool"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector(".animate-spin")).not.toBeNull();
    expect(getByText("Using read_file")).toBeInTheDocument();
  });

  it("shows the answer preview when a subagent is done", () => {
    const { container, getByText } = render(
      <SubagentCard
        entry={{ id: "s1", label: "Survey diffusion", state: "done", detail: "Found 3 papers." }}
      />,
    );
    expect(
      container.querySelector('[data-subagent-state="done"] .animate-spin'),
    ).toBeNull();
    expect(getByText("Found 3 papers.")).toBeInTheDocument();
  });

  it("opens the recorded delegated session through the supplied boundary", () => {
    const openSession = vi.fn();
    render(
      <SubagentCard
        entry={{
          id: "s1",
          label: "Survey diffusion",
          state: "done",
          sessionId: "acp-session",
          runtime: "acp",
        }}
        actions={{ openSession }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(openSession).toHaveBeenCalledWith({ threadId: "acp-session", runtime: "acp" });
  });
});

describe("ResearchToolCard", () => {
  beforeEach(clearExpansionState);

  it("renders papers and opens a typed source target", () => {
    const openSource = vi.fn();
    render(
      <ResearchToolCard
        expansionKey="chat:search"
        actions={{ openSource }}
        tc={{
          name: "literature_search",
          status: "done",
          output: JSON.stringify({
            results: [{
              id: "https://openalex.org/W1",
              title: "Useful paper",
              doi: "https://doi.org/10.1000/useful",
              publication_year: 2024,
              authorships: [{ author: { display_name: "A. Rivera" } }],
              primary_location: { landing_page_url: "https://example.org/useful" },
            }],
          }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Search literature/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open source: Useful paper" }));
    expect(openSource).toHaveBeenCalledWith({
      sourceId: "https://openalex.org/W1",
      url: "https://example.org/useful",
      doi: "10.1000/useful",
    });
  });

  it("bounds long output and keeps expansion after an unmount", () => {
    const output = JSON.stringify({ content: "x".repeat(8_000) });
    const first = render(
      <ResearchToolCard
        expansionKey="chat:read"
        tc={{ name: "read_file", status: "done", output }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read file/ }));
    expect(screen.getByText(/Show all 8,000 characters/)).toBeInTheDocument();
    first.unmount();

    render(
      <ResearchToolCard
        expansionKey="chat:read"
        tc={{ name: "read_file", status: "done", output }}
      />,
    );
    expect(screen.getByText(/Show all 8,000 characters/)).toBeInTheDocument();
  });

  it("does not call navigation for an unsafe source URL", () => {
    const openSource = vi.fn();
    render(
      <ResearchToolCard
        actions={{ openSource }}
        tc={{
          name: "alphaxiv_paper_content",
          status: "done",
          output: JSON.stringify({ url: "javascript:alert(1)", content: "text" }),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Read paper/ }));
    expect(screen.queryByRole("button", { name: "Open source" })).toBeNull();
    expect(openSource).not.toHaveBeenCalled();
  });

  it("does not offer manuscript navigation for an unscoped linked result", () => {
    const openArtifact = vi.fn();
    render(
      <ResearchToolCard
        actions={{ openArtifact }}
        tc={{
          name: "Read linked file",
          status: "done",
          output: JSON.stringify({ path: "notes.md", content: "linked notes" }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Read linked file/ }));
    expect(screen.queryByRole("button", { name: "Open file" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Inspect source" })).toBeNull();
    expect(openArtifact).not.toHaveBeenCalled();
  });

  it("previews a linked file through its root-scoped action", async () => {
    const openArtifact = vi.fn().mockResolvedValue({
      relativePath: "notes.md",
      content: "fresh linked content",
      truncated: false,
      isBinary: false,
    });
    render(
      <ResearchToolCard
        actions={{ openArtifact }}
        tc={{
          name: "read_research_root_file",
          status: "done",
          output: JSON.stringify({
            rootId: "references",
            relativePath: "notes.md",
            content: "saved linked content",
          }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Read linked file/ }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect source" }));

    expect(openArtifact).toHaveBeenCalledWith({
      scope: "linked",
      rootId: "references",
      relativePath: "notes.md",
    });
    expect(await screen.findByText("fresh linked content")).toBeInTheDocument();
  });
});

const PILL_TODOS = [
  { id: "compile", content: "Compile the document", status: "completed" as const },
  { id: "verify", content: "Verify the PDF", status: "in_progress" as const },
  { id: "publish", content: "Publish the result", status: "pending" as const },
  { id: "discard", content: "Discard old draft", status: "cancelled" as const },
];

const PILL_TURN = {
  chatId: "chat-1",
  turnId: "turn-1",
  headOid: "abcdef123456",
  changedFiles: {
    "src/current.ts": {
      path: "src/current.ts",
      additions: 2,
      deletions: 1,
      beforeContent: "old",
      afterContent: "new",
    },
  },
  committedFiles: [
    {
      path: "src/committed.ts",
      additions: 5,
      deletions: 2,
      beforeContent: "before",
      afterContent: "after",
      commitId: "abcdef123456",
    },
  ],
  commits: [{ id: "abcdef123456", files: ["src/committed.ts"] }],
};

const AWAITING = { status: "awaiting" as const, onApprove: () => {}, onRevise: () => {} };

function pillText() {
  return screen.getByTestId("agent-status-pill").textContent?.replace(/\s+/g, " ").trim();
}

describe("AgentStatusPill", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing without a plan, steps, or file changes", () => {
    const { container } = render(<AgentStatusPill todos={[]} turn={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ["plan only", { todos: [], turn: null, approval: AWAITING }, "PLAN"],
    ["steps only", { todos: PILL_TODOS, turn: null }, "STEP 2/3"],
    ["review only", { todos: [], turn: PILL_TURN }, "REVIEW +7 -3"],
    [
      "plan, steps, and review",
      { todos: PILL_TODOS, turn: PILL_TURN, approval: AWAITING },
      "PLAN · STEP 2/3 · REVIEW +7 -3",
    ],
  ])("shows the %s segments in order", (_label, props, text) => {
    render(<AgentStatusPill {...props} />);
    expect(pillText()).toBe(text);
  });

  it("keeps the added and removed counts coloured", () => {
    render(<AgentStatusPill todos={[]} turn={PILL_TURN} />);
    const review = screen
      .getByTestId("agent-status-pill")
      .querySelector('[data-pill-segment="review"]');
    expect(review?.querySelector(".text-emerald-600")).toHaveTextContent("+7");
    expect(review?.querySelector(".text-destructive")).toHaveTextContent("-3");
  });

  it("opens the checklist on hover without taking focus and closes when the pointer leaves", async () => {
    render(
      <>
        <textarea aria-label="Composer" />
        <AgentStatusPill todos={PILL_TODOS} turn={null} />
      </>,
    );
    const composer = screen.getByLabelText("Composer");
    act(() => composer.focus());
    const pill = screen.getByTestId("agent-status-pill");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Compile the document")).not.toBeInTheDocument();

    fireEvent.mouseEnter(pill);

    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("agent-todos")).toHaveAttribute("data-plan-status", "none");
    expect(screen.getByText("Compile the document")).toBeInTheDocument();
    expect(document.activeElement).toBe(composer);

    fireEvent.mouseLeave(pill);

    await waitFor(() => expect(screen.queryByTestId("agent-todos")).toBeNull());
    expect(pill).toHaveAttribute("aria-expanded", "false");
  });

  it("stays open while the pointer moves from the pill into the panel", () => {
    vi.useFakeTimers();
    render(<AgentStatusPill todos={PILL_TODOS} turn={null} />);
    const pill = screen.getByTestId("agent-status-pill");
    fireEvent.mouseEnter(pill);
    fireEvent.mouseLeave(pill);
    const panel = screen.getByTestId("agent-todos");
    fireEvent.mouseEnter(panel);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    fireEvent.mouseLeave(panel);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByTestId("agent-todos")).toBeNull();
  });

  it("opens on focus and closes with Escape", () => {
    render(<AgentStatusPill todos={PILL_TODOS} turn={null} />);
    const pill = screen.getByTestId("agent-status-pill");

    fireEvent.focus(pill);
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("agent-todos")).toBeNull();
    expect(pill).toHaveAttribute("aria-expanded", "false");
  });

  it("returns focus to the pill when Escape is pressed inside the panel", () => {
    render(<AgentStatusPill todos={PILL_TODOS} turn={null} approval={AWAITING} />);
    const pill = screen.getByTestId("agent-status-pill");
    const approve = screen.getByRole("button", { name: "Approve plan" });
    act(() => approve.focus());

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("agent-todos")).toBeNull();
    expect(document.activeElement).toBe(pill);
  });

  it("pins the panel open on click and closes it on the next click", () => {
    vi.useFakeTimers();
    render(<AgentStatusPill todos={PILL_TODOS} turn={null} />);
    const pill = screen.getByTestId("agent-status-pill");

    fireEvent.click(pill);
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    fireEvent.mouseLeave(pill);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    fireEvent.click(pill);
    expect(screen.queryByTestId("agent-todos")).toBeNull();
  });

  it("closes a pinned panel when the pointer goes down elsewhere", () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <AgentStatusPill todos={PILL_TODOS} turn={null} />
      </>,
    );
    fireEvent.click(screen.getByTestId("agent-status-pill"));
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByTestId("agent-todos")).toBeNull();
  });

  it("closes when focus leaves the pill and its panel", () => {
    render(
      <>
        <button type="button">Elsewhere</button>
        <AgentStatusPill todos={PILL_TODOS} turn={null} />
      </>,
    );
    const pill = screen.getByTestId("agent-status-pill");
    fireEvent.focus(pill);
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    fireEvent.blur(pill, { relatedTarget: screen.getByRole("button", { name: "Elsewhere" }) });

    expect(screen.queryByTestId("agent-todos")).toBeNull();
  });

  it("renders a distinct icon and text treatment for every status", () => {
    render(<AgentStatusPill todos={PILL_TODOS} turn={null} />);
    fireEvent.click(screen.getByTestId("agent-status-pill"));
    const panel = screen.getByTestId("agent-todos");

    const completed = panel.querySelector('[data-todo-status="completed"]');
    const active = panel.querySelector('[data-todo-status="in_progress"]');
    const pending = panel.querySelector('[data-todo-status="pending"]');
    const cancelled = panel.querySelector('[data-todo-status="cancelled"]');

    expect(completed?.querySelector('[data-todo-icon="completed"]')).not.toBeNull();
    expect(completed?.querySelector("span:last-child")).not.toHaveClass("line-through");
    expect(active?.querySelector('[data-todo-icon="in_progress"]')).toHaveClass("animate-spin");
    expect(pending?.querySelector('[data-todo-icon="pending"]')).not.toBeNull();
    expect(cancelled?.querySelector('[data-todo-icon="cancelled"]')).not.toBeNull();
    expect(cancelled?.querySelector("span:last-child")).toHaveClass(
      "line-through",
      "text-muted-foreground/60",
    );
  });

  it("shows no approval controls without an approval state", () => {
    render(<AgentStatusPill todos={PILL_TODOS} turn={null} />);
    const pill = screen.getByTestId("agent-status-pill");
    expect(pill).toHaveAttribute("data-plan-status", "none");
    fireEvent.click(pill);
    expect(screen.queryByTestId("agent-plan-status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revise" })).toBeNull();
  });

  it("offers Approve plan and Revise while awaiting and lists the changed files", () => {
    const onApprove = vi.fn();
    const onRevise = vi.fn();
    render(
      <AgentStatusPill
        todos={PILL_TODOS}
        turn={PILL_TURN}
        approval={{ status: "awaiting", onApprove, onRevise }}
      />,
    );
    const pill = screen.getByTestId("agent-status-pill");
    expect(pill).toHaveAttribute("data-plan-status", "awaiting");
    expect(pill.querySelector('[data-pill-segment="plan"]')).toHaveClass("text-violet-600");

    const panel = screen.getByTestId("agent-todos");
    expect(panel).toHaveAttribute("data-plan-status", "awaiting");
    expect(screen.getByTestId("agent-plan-status")).toHaveTextContent("Awaiting approval");
    expect(screen.getByText("Compile the document")).toBeInTheDocument();
    expect(panel.querySelector('[data-file-change-state="changed"]')).toHaveTextContent(
      "src/current.ts+2-1",
    );
    expect(panel.querySelector('[data-file-change-state="committed"]')).toHaveTextContent(
      "src/committed.ts+5-2",
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    fireEvent.click(pill);
    fireEvent.click(screen.getByRole("button", { name: "Revise" }));
    expect(onRevise).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("agent-todos")).toBeNull();
  });

  it("opens once when the status becomes awaiting, without taking focus, and stays open unhovered", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <>
        <textarea aria-label="Composer" />
        <AgentStatusPill todos={PILL_TODOS} turn={null} />
      </>,
    );
    const composer = screen.getByLabelText("Composer");
    act(() => composer.focus());
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    rerender(
      <>
        <textarea aria-label="Composer" />
        <AgentStatusPill todos={PILL_TODOS} turn={null} approval={AWAITING} />
      </>,
    );

    expect(screen.getByTestId("agent-todos")).toHaveAttribute("data-plan-status", "awaiting");
    expect(screen.getByRole("button", { name: "Approve plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revise" })).toBeInTheDocument();
    expect(document.activeElement).toBe(composer);

    const pill = screen.getByTestId("agent-status-pill");
    fireEvent.mouseEnter(pill);
    fireEvent.mouseLeave(pill);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();
  });

  it("does not reopen after the user closes it while the plan stays awaiting", () => {
    const { rerender } = render(
      <AgentStatusPill todos={PILL_TODOS} turn={null} approval={AWAITING} />,
    );
    const pill = screen.getByTestId("agent-status-pill");
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    fireEvent.click(pill);
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    rerender(<AgentStatusPill todos={PILL_TODOS} turn={null} approval={{ ...AWAITING }} />);
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    fireEvent.click(pill);
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    fireEvent.mouseEnter(pill);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("agent-todos")).toBeNull();
    rerender(<AgentStatusPill todos={PILL_TODOS} turn={PILL_TURN} approval={{ ...AWAITING }} />);
    expect(screen.queryByTestId("agent-todos")).toBeNull();
  });

  it("opens once on mount with a persisted awaiting status", () => {
    const { rerender } = render(
      <AgentStatusPill todos={PILL_TODOS} turn={null} approval={AWAITING} />,
    );
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    rerender(<AgentStatusPill todos={PILL_TODOS} turn={null} approval={{ ...AWAITING }} />);
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("agent-todos")).toBeNull();
    rerender(<AgentStatusPill todos={PILL_TODOS} turn={null} approval={{ ...AWAITING }} />);
    expect(screen.queryByTestId("agent-todos")).toBeNull();
  });

  it("does not open by itself for an approved plan", () => {
    const { rerender } = render(
      <AgentStatusPill
        todos={PILL_TODOS}
        turn={null}
        approval={{ status: "approved", onApprove: () => {}, onRevise: () => {} }}
      />,
    );
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    rerender(<AgentStatusPill todos={PILL_TODOS} turn={null} approval={AWAITING} />);
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    rerender(
      <AgentStatusPill
        todos={PILL_TODOS}
        turn={null}
        approval={{ status: "approved", onApprove: () => {}, onRevise: () => {} }}
      />,
    );
    expect(screen.queryByTestId("agent-todos")).toBeNull();
  });

  it("opens again when a revision lands while the plan is still awaiting", () => {
    const { rerender } = render(
      <AgentStatusPill todos={PILL_TODOS} turn={null} approval={AWAITING} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Revise" }));
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    rerender(<AgentStatusPill todos={PILL_TODOS} turn={null} approval={{ ...AWAITING, busy: true }} />);
    expect(screen.queryByTestId("agent-todos")).toBeNull();

    rerender(<AgentStatusPill todos={[PILL_TODOS[0]]} turn={null} approval={{ ...AWAITING }} />);
    expect(screen.getByTestId("agent-todos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve plan" })).not.toBeDisabled();
  });

  it("disables the approval buttons while a turn is busy", () => {
    render(
      <AgentStatusPill
        todos={PILL_TODOS}
        turn={null}
        approval={{ status: "awaiting", busy: true, onApprove: () => {}, onRevise: () => {} }}
      />,
    );
    fireEvent.click(screen.getByTestId("agent-status-pill"));
    expect(screen.getByRole("button", { name: "Approve plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revise" })).toBeDisabled();
  });

  it("shows Approved without buttons during execution", () => {
    render(
      <AgentStatusPill
        todos={PILL_TODOS}
        turn={null}
        approval={{ status: "approved", onApprove: () => {}, onRevise: () => {} }}
      />,
    );
    const pill = screen.getByTestId("agent-status-pill");
    expect(pill).toHaveAttribute("data-plan-status", "approved");
    expect(pill.querySelector('[data-pill-segment="plan"]')).toHaveClass("text-emerald-600");
    fireEvent.click(pill);
    expect(screen.getByTestId("agent-plan-status")).toHaveTextContent("Approved");
    expect(screen.queryByRole("button", { name: "Approve plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revise" })).toBeNull();
  });
});

describe("AgentRunSummary", () => {
  const finished = [
    { id: "inspect", content: "Inspect", status: "completed" as const },
    { id: "edit", content: "Edit", status: "completed" as const },
    { id: "skip", content: "Skip", status: "cancelled" as const },
  ];

  it("summarises a finished plan with its file rows and no undo control", () => {
    render(<AgentRunSummary todos={finished} turn={PILL_TURN} plan />);
    const summary = screen.getByTestId("agent-run-summary");

    expect(summary).toHaveAttribute("data-plan", "true");
    expect(summary.firstElementChild).toHaveTextContent(
      "Plan · 2/2 done · 2 files changed +7 -3",
    );
    expect(summary.querySelector('[data-file-change-state="changed"]')).toHaveTextContent(
      "src/current.ts+2-1",
    );
    expect(summary.querySelector('[data-file-change-state="committed"]')).toHaveTextContent(
      "src/committed.ts+5-2",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("drops the Plan segment for a normal run and counts a single file", () => {
    render(
      <AgentRunSummary todos={[]} turn={{ ...PILL_TURN, committedFiles: [], commits: [] }} />,
    );
    const summary = screen.getByTestId("agent-run-summary");

    expect(summary).toHaveAttribute("data-plan", "false");
    expect(summary.firstElementChild).toHaveTextContent("1 file changed +2 -1");
    expect(summary).not.toHaveTextContent("Plan");
    expect(summary).not.toHaveTextContent("done");
  });

  it("shows only the step count when no files changed", () => {
    render(<AgentRunSummary todos={finished} turn={null} />);
    expect(screen.getByTestId("agent-run-summary")).toHaveTextContent("2/2 done");
    expect(screen.getByTestId("agent-run-summary")).not.toHaveTextContent("changed");
  });

  it("renders nothing without todos or file changes", () => {
    const { container } = render(<AgentRunSummary todos={[]} turn={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("AI chat overflow surfaces", () => {
  it("wraps expanded tool output without horizontal scrolling", () => {
    const { container } = render(
      <ToolBadge
        tc={{
          name: "verify_citation",
          status: "done",
          output: JSON.stringify({ verified: true, bibtex: "A long citation result" }),
        }}
      />,
    );

    fireEvent.click(getByRole(container, "button"));

    expect(container.querySelector("pre")).toHaveClass(
      "overflow-x-hidden",
      "overflow-y-auto",
      "whitespace-pre-wrap",
      "break-words",
    );
  });

  it("wraps expanded reasoning as instant plain text, not heavy markdown", () => {
    const { container } = render(<ReasoningBlock text="**Exploring Project Contents**" />);

    fireEvent.click(getByRole(container, "button"));

    const body = container.querySelector("div.max-h-56");
    expect(body).toHaveClass("overflow-x-hidden", "overflow-y-auto", "break-words");
    // Reasoning is a raw thinking trace: rendered as plain text so a long,
    // math-dense dump opens instantly and never shows shattered/raw KaTeX.
    expect(body?.querySelector("strong")).toBeNull();
    expect(body).toHaveTextContent("**Exploring Project Contents**");
  });

  it("keeps active reasoning as plain text until streaming completes", () => {
    const { container } = render(
      <ReasoningBlock text="**Exploring Project Contents**" active />,
    );

    fireEvent.click(getByRole(container, "button"));

    const body = container.querySelector("div.max-h-56");
    expect(body?.querySelector("strong")).toBeNull();
    expect(body).toHaveTextContent("**Exploring Project Contents**");
  });
});

describe("ExecCard run_command contract", () => {
  it("renders the command, output, status, and exit code from the exec envelope", () => {
    const { container, getByText, queryByText } = render(
      <ExecCard
        tc={{
          name: "run_command",
          status: "done",
          output: JSON.stringify({
            exec: true,
            command: "pnpm test",
            output: "one test failed",
            status: "Failed with exit code 7",
            exit_code: 7,
          }),
        }}
      />,
    );

    const card = container.querySelector('[data-testid="exec-card"]');
    expect(card).toHaveAttribute("data-exec-status", "Failed with exit code 7");
    expect(getByText("$ pnpm test")).toBeInTheDocument();
    expect(getByText("Failed with exit code 7")).toBeInTheDocument();
    expect(card?.querySelector(".text-destructive")).not.toBeNull();
    expect(queryByText("one test failed")).not.toBeInTheDocument();

    fireEvent.click(getByRole(container, "button"));

    expect(getByText("one test failed")).toBeInTheDocument();
  });

  it("renders a declined command as a terminal declined state, not a spinner", () => {
    const { container, getByText } = render(
      <ExecCard
        tc={{
          name: "run_command",
          status: "done",
          output: JSON.stringify({
            declined: true,
            status: "declined",
            tool: "run_command",
            command: "rm -rf build",
          }),
        }}
      />,
    );
    const card = container.querySelector('[data-testid="exec-card"]');
    expect(card).toHaveAttribute("data-exec-status", "declined");
    expect(getByText("$ rm -rf build")).toBeInTheDocument();
    expect(getByText("Declined")).toBeInTheDocument();
    expect(card?.querySelector(".animate-spin")).toBeNull();
    expect(card?.querySelector(".text-destructive")).not.toBeNull();
  });

  it("renders a caught error as a terminal error state, not a spinner", () => {
    const { container, getByText } = render(
      <ExecCard
        tc={{
          name: "run_command",
          status: "done",
          output: JSON.stringify({ error: "Project changed before mutation." }),
        }}
      />,
    );
    const card = container.querySelector('[data-testid="exec-card"]');
    expect(card).toHaveAttribute("data-exec-status", "error");
    expect(getByText("Project changed before mutation.")).toBeInTheDocument();
    expect(card?.querySelector(".animate-spin")).toBeNull();
  });

  it("treats a timed-out command as a failure", () => {
    const { container, getByText } = render(
      <ExecCard
        tc={{
          name: "run_command",
          status: "done",
          output: JSON.stringify({
            exec: true,
            command: "sleep 999",
            output: "",
            status: "Timed out",
            exit_code: null,
            timed_out: true,
          }),
        }}
      />,
    );
    const card = container.querySelector('[data-testid="exec-card"]');
    expect(card).toHaveAttribute("data-exec-status", "Timed out");
    expect(getByText("Timed out")).toBeInTheDocument();
    expect(card?.querySelector(".animate-spin")).toBeNull();
    expect(card?.querySelector(".text-destructive")).not.toBeNull();
  });

  it("treats a stopped command (null exit) as a failure, not a green check", () => {
    const { container, getByText } = render(
      <ExecCard
        tc={{
          name: "run_command",
          status: "done",
          output: JSON.stringify({
            exec: true,
            command: "pnpm dev",
            output: "partial output",
            status: "Stopped",
            exit_code: null,
          }),
        }}
      />,
    );
    const card = container.querySelector('[data-testid="exec-card"]');
    expect(card).toHaveAttribute("data-exec-status", "Stopped");
    expect(getByText("Stopped")).toBeInTheDocument();
    expect(card?.querySelector(".text-destructive")).not.toBeNull();
    expect(card?.querySelector(".text-emerald-500")).toBeNull();
  });

  it("still spins while the call is running and its envelope is not yet parseable", () => {
    const { container } = render(
      <ExecCard tc={{ name: "run_command", status: "running", output: "" }} />,
    );
    const card = container.querySelector('[data-testid="exec-card"]');
    expect(card).toHaveAttribute("data-exec-status", "running");
    expect(card?.querySelector(".animate-spin")).not.toBeNull();
  });
});

describe("MessageItem step grouping", () => {
  const workedMessage = {
    role: "assistant" as const,
    content: "All done.",
    reasoningBlocks: [
      { id: "r1", text: "scan files", ms: 1400, beforeTool: 0 },
      { id: "r2", text: "verify", ms: 800, beforeTool: 1 },
    ],
    toolCalls: [{ id: "t1", name: "read_file", status: "done" as const }],
  };

  it("collapses finished reasoning and tool steps behind a worked-for header", () => {
    const { container, queryByText } = render(<MessageItem msg={workedMessage} />);

    const toggle = getByRole(container, "button", { name: /Worked for 2s/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector('[data-tool-name="read_file"]')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector('[data-tool-name="read_file"]'),
    ).not.toBeNull();
    expect(queryByText("All done.")).toBeInTheDocument();
  });

  it("keeps steps expanded and ungrouped while the message streams", () => {
    const { container } = render(<MessageItem msg={workedMessage} live />);

    expect(
      container.querySelector('[data-tool-name="read_file"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="worked-steps-toggle"]'),
    ).toBeNull();
  });

  it("keeps a realistic research run in recorded order", () => {
    const { container } = render(
      <MessageItem
        msg={{
          id: "research-turn",
          role: "assistant",
          content: "The sources and compile result are ready.",
          reasoningBlocks: [
            { id: "r1", text: "Find primary sources", ms: 900, beforeTool: 0 },
            { id: "r2", text: "Check the selected record", ms: 500, beforeTool: 1 },
          ],
          toolCalls: [
            {
              id: "search",
              name: "literature_search",
              status: "done",
              output: JSON.stringify({ results: [{ title: "Primary study", id: "https://openalex.org/W1" }] }),
            },
            {
              id: "verify",
              name: "verify_citation",
              status: "done",
              output: JSON.stringify({ verified: true, source: "crossref-doi", doi: "10.1000/study" }),
            },
            {
              id: "compile",
              name: "compile",
              status: "done",
              output: JSON.stringify({ success: true, errors: [], has_pdf: true }),
            },
          ],
        }}
      />,
    );

    const ordered = Array.from(
      container.querySelectorAll("[data-reasoning-block], [data-tool-name]"),
    ).map((element) => element.hasAttribute("data-reasoning-block")
      ? "reasoning"
      : element.getAttribute("data-tool-name"));
    expect(ordered).toEqual([
      "reasoning",
      "literature_search",
      "reasoning",
      "verify_citation",
      "compile",
    ]);
    expect(container.querySelector('[data-testid="worked-steps-toggle"]')).toBeNull();
    expect(container).toHaveTextContent("Verified by the citation service");
    expect(container).toHaveTextContent("Compiled successfully");
  });

  it("does not render reasoning when none was recorded", () => {
    const { container } = render(
      <MessageItem msg={{ role: "assistant", content: "A direct answer." }} />,
    );
    expect(container.querySelector("[data-reasoning-block]")).toBeNull();
  });
});

describe("MessageItem streaming render", () => {
  const streamedContent = "# Findings\n\n**bold** and `code`";

  it("renders rich markdown while an assistant message streams", async () => {
    const { container } = render(
      <MessageItem msg={{ role: "assistant", content: streamedContent }} live />,
    );

    await waitFor(() => expect(container.querySelector("strong")).toHaveTextContent("bold"));
    expect(container.querySelector("h1")).toHaveTextContent("Findings");
    expect(container.querySelector("code")).toHaveTextContent("code");
    expect(container.querySelector('[data-streaming-markdown="true"]')).not.toBeNull();
  });

  it("parses the completed assistant message as markdown once streaming ends", async () => {
    const { container } = render(
      <MessageItem msg={{ role: "assistant", content: streamedContent }} />,
    );

    expect(container.querySelector('[data-streaming-markdown="true"]')).toBeNull();
    await waitFor(() => expect(container.querySelector("strong")).toHaveTextContent("bold"));
    expect(container.querySelector("h1")).toHaveTextContent("Findings");
  });

  it("parses a completed user message as markdown", async () => {
    const { container } = render(
      <MessageItem msg={{ role: "user", content: "A **careful** question" }} />,
    );

    await waitFor(() =>
      expect(container.querySelector("strong")).toHaveTextContent("careful")
    );
  });

  it("labels a user message that was steered into a running turn", () => {
    const { getByTestId } = render(
      <MessageItem msg={{ role: "user", content: "Change direction", steered: true }} />,
    );
    expect(getByTestId("steered-message-label")).toHaveTextContent("Steered");

    const plain = render(<MessageItem msg={{ role: "user", content: "Change direction" }} />);
    expect(
      plain.container.querySelector('[data-testid="steered-message-label"]'),
    ).toBeNull();
  });

  it("keeps user message links and inline code readable on the primary bubble", async () => {
    const { container } = render(
      <MessageItem
        msg={{ role: "user", content: "Open [the guide](https://example.com) and run `pnpm test`." }}
      />,
    );

    await waitFor(() => expect(container.querySelector("a")).toHaveTextContent("the guide"));
    expect(container.querySelector("a")).toHaveClass("text-white");
    expect(container.querySelector("code")).toHaveClass(
      "border-white/20",
      "bg-white/10",
      "text-white",
    );
  });

  it("renders closed math while the assistant message streams", async () => {
    const content = "The result is $x^2$.";
    const { container } = render(
      <MessageItem msg={{ role: "assistant", content }} live />,
    );

    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
  });

  it.each([
    ["inline math", "The result is $x^2"],
    ["display math", "The result is\n\n$$\n\\frac{1}{2}"],
    ["code fence", "Before\n\n```typescript\nconst value = 1;"],
    ["Mermaid fence", "Before\n\n```mermaid\nflowchart TD\n  A --> B"],
  ])("keeps an unfinished %s tail as safe raw text", async (_label, content) => {
    const { container } = render(
      <MessageItem msg={{ role: "assistant", content }} live />,
    );

    const separator = content.lastIndexOf("\n\n");
    const rawTail = content.slice(separator < 0 ? 0 : separator + 2);
    await waitFor(() =>
      expect(container.querySelector('[data-streaming-raw="true"]')?.textContent).toBe(rawTail)
    );
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector("pre code")).toBeNull();
    expect(container.querySelector('[data-mermaid-diagram="true"]')).toBeNull();
  });
});

describe("MessageItem footer", () => {
  it.each(["user", "assistant"] as const)(
    "renders the %s message time and copy button in the same footer below the bubble",
    (role) => {
      const createdAt = new Date(2026, 0, 15, 17, 41).getTime();
      const { container, getByRole } = render(
        <MessageItem msg={{ role, content: "Timestamped message", createdAt }} />,
      );

      const time = container.querySelector("time");
      const copyButton = getByRole("button", { name: "Copy message" });
      const footer = time?.parentElement;

      expect(time).toHaveTextContent("5:41 PM");
      expect(copyButton.parentElement).toBe(footer);
      expect(footer?.previousElementSibling).toHaveTextContent("Timestamped message");
    },
  );

  it("renders a stored message without a timestamp when createdAt is missing", () => {
    const { container, getByRole } = render(
      <MessageItem msg={{ role: "assistant", content: "Legacy message" }} />,
    );

    expect(getByRole("button", { name: "Copy message" })).toBeInTheDocument();
    expect(container.querySelector("time")).toBeNull();
    expect(container).not.toHaveTextContent("Invalid Date");
  });
});
