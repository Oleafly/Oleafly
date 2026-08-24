// @vitest-environment jsdom

import { fireEvent, getByRole, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentPlan, ReasoningBlock, ToolBadge } from "./chat-parts";

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
