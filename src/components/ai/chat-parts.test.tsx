// @vitest-environment jsdom

import { fireEvent, getByRole, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AgentPlan,
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

  it("wraps expanded reasoning without horizontal scrolling and renders its markdown", () => {
    const { container } = render(<ReasoningBlock text="**Exploring Project Contents**" />);

    fireEvent.click(getByRole(container, "button"));

    const body = container.querySelector("div.max-h-56");
    expect(body).toHaveClass("overflow-x-hidden", "overflow-y-auto", "break-words");
    expect(body?.querySelector("strong")).toHaveTextContent("Exploring Project Contents");
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

  it("renders a live assistant message as a plain pre-wrap element, never markdown", () => {
    const { container } = render(
      <MessageItem msg={{ role: "assistant", content: streamedContent }} live />,
    );

    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
    const body = container.querySelector('[data-streaming-text="true"]');
    expect(body).not.toBeNull();
    expect(body).toHaveAttribute("dir", "auto");
    expect(body).toHaveClass("whitespace-pre-wrap", "[unicode-bidi:plaintext]");
    expect(body).toHaveTextContent("**bold**");
  });

  it("parses the completed assistant message as markdown once streaming ends", () => {
    const { container } = render(
      <MessageItem msg={{ role: "assistant", content: streamedContent }} />,
    );

    expect(container.querySelector('[data-streaming-text="true"]')).toBeNull();
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("h1")).toHaveTextContent("Findings");
  });
});
