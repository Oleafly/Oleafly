// @vitest-environment jsdom

import { fireEvent, getByRole, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentPlan,
  AgentRunSummary,
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
});

describe("AgentPlan", () => {
  const todos = [
    { id: "compile", content: "Compile the document", status: "completed" as const },
    { id: "verify", content: "Verify the PDF", status: "in_progress" as const },
    { id: "publish", content: "Publish the result", status: "pending" as const },
    { id: "discard", content: "Discard old draft", status: "cancelled" as const },
  ];

  it("starts collapsed and toggles its checklist like an accordion", () => {
    const { container, queryByText } = render(<AgentPlan todos={todos} />);
    const trigger = getByRole(container, "button", { name: "Plan" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(queryByText("Compile the document")).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(queryByText("Compile the document")).toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(queryByText("Compile the document")).not.toBeInTheDocument();
  });

  it("renders a distinct icon and text treatment for every status", () => {
    const { container } = render(<AgentPlan todos={todos} />);
    fireEvent.click(getByRole(container, "button", { name: "Plan" }));

    const completed = container.querySelector('[data-todo-status="completed"]');
    const active = container.querySelector('[data-todo-status="in_progress"]');
    const pending = container.querySelector('[data-todo-status="pending"]');
    const cancelled = container.querySelector('[data-todo-status="cancelled"]');

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
});

describe("AgentRunSummary", () => {
  const todos = [
    { id: "inspect", content: "Inspect", status: "completed" as const },
    { id: "edit", content: "Edit", status: "in_progress" as const },
    { id: "verify", content: "Verify", status: "pending" as const },
  ];
  const turn = {
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

  it("shows todo progress and aggregate file totals", () => {
    render(<AgentRunSummary todos={todos} turn={turn} />);

    expect(screen.getByTestId("agent-run-pill")).toHaveTextContent(
      "Step 2 / 3 · 2 files changed +7 -3",
    );
  });

  it("shows changed and committed files on hover", async () => {
    render(<AgentRunSummary todos={todos} turn={turn} />);
    const pill = screen.getByTestId("agent-run-pill");

    fireEvent.mouseEnter(pill.parentElement ?? pill);

    await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Changed");
    expect(tooltip).toHaveTextContent("src/current.ts");
    expect(tooltip).toHaveTextContent("Committed abcdef1");
    expect(tooltip).toHaveTextContent("src/committed.ts");
    expect(tooltip.querySelector('[data-file-change-state="changed"]')).toHaveTextContent(
      "src/current.ts+2-1",
    );
    expect(tooltip.querySelector('[data-file-change-state="committed"]')).toHaveTextContent(
      "src/committed.ts+5-2",
    );
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

  it("wraps expanded reasoning without horizontal scrolling and renders its markdown", async () => {
    const { container } = render(<ReasoningBlock text="**Exploring Project Contents**" />);

    fireEvent.click(getByRole(container, "button"));

    const body = container.querySelector("div.max-h-56");
    expect(body).toHaveClass("overflow-x-hidden", "overflow-y-auto", "break-words");
    await waitFor(() =>
      expect(body?.querySelector("strong")).toHaveTextContent("Exploring Project Contents")
    );
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
