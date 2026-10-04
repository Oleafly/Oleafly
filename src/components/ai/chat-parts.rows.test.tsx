// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import { clearExpansionState } from "./activity/expansion-state";
import {
  AgentStatusPill,
  ExplorationGroup,
  InfoHint,
  MessageItem,
  ReasoningBlock,
  Shimmer,
  SubagentCard,
  explorationSummary,
  formatError,
  formatToolOutput,
} from "./chat-parts";

beforeAll(async () => {
  await import("@/components/ui/markdown-renderer");
});

afterEach(() => {
  clearExpansionState();
});

describe("user message chips", () => {
  it("marks the skill command and the file mentions inside a sent message", () => {
    const { container } = render(
      <MessageItem
        msg={{
          role: "user",
          content: "/proofread check @main.tex and @refs.bib",
          skillId: "proofread",
          mentions: ["main.tex", "refs.bib"],
        }}
      />,
    );

    const tokens = [...container.querySelectorAll("[data-token]")].map((node) => [
      node.getAttribute("data-token"),
      node.textContent,
    ]);
    expect(tokens).toEqual([
      ["skill", "/proofread"],
      ["text", " check "],
      ["mention", "@main.tex"],
      ["text", " and "],
      ["mention", "@refs.bib"],
    ]);
    expect(container.querySelector('[data-token="text"]')?.className).toBe("");
  });

  it("falls back to the plain bubble when the recorded mentions no longer appear", () => {
    const { container } = render(
      <MessageItem msg={{ role: "user", content: "Please check the intro", mentions: ["intro.tex"] }} />,
    );

    expect(container.querySelector("[data-token]")).toBeNull();
    expect(screen.getByText("Please check the intro")).toBeInTheDocument();
  });
});

describe("small chat surfaces", () => {
  it("renders the shimmer only when it has text", () => {
    const { container, rerender } = render(<Shimmer />);
    expect(container).toBeEmptyDOMElement();

    rerender(<Shimmer text="Thinking" />);
    expect(screen.getByText("Thinking")).toHaveClass("ai-shimmer");
  });

  it("keeps an info hint behind a labelled trigger until it is opened", () => {
    render(<InfoHint message="This chat started on an older commit." />);

    const trigger = screen.getByRole("button", { name: "This chat started on an older commit." });
    expect(screen.queryByText("This chat started on an older commit.")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByText("This chat started on an older commit.")).toBeInTheDocument();
  });
});

describe("AgentStatusPill file changes", () => {
  it("titles a changes-only panel and groups commits without an id together", () => {
    render(
      <AgentStatusPill
        todos={[]}
        turn={{
          chatId: "chat-1",
          turnId: "turn-1",
          headOid: null,
          changedFiles: {},
          committedFiles: [
            { path: "a.tex", additions: 1, deletions: 0, beforeContent: "", afterContent: "x" },
            { path: "b.tex", additions: 2, deletions: 1, beforeContent: "y", afterContent: "z" },
          ],
          commits: [],
        }}
      />,
    );

    fireEvent.focus(screen.getByTestId("agent-status-pill"));

    expect(screen.getByText(enAi.chat.plan.headingChanges)).toBeInTheDocument();
    const group = document.querySelector('[data-commit-id="committed"]');
    expect(group).toHaveTextContent(enAi.chat.fileChanges.committed.replace("{{commit}}", "committ"));
    expect(group?.querySelectorAll('[data-file-change-state="committed"]')).toHaveLength(2);
    expect(document.querySelector('[data-file-change-state="changed"]')).toBeNull();
  });
});

describe("ExplorationGroup without tool ids", () => {
  it("expands every badge even when the calls carry no ids", () => {
    const tools = [
      { name: "read_file", status: "done" as const },
      { name: "search_project", status: "done" as const },
    ];
    const { container } = render(<ExplorationGroup expansionKey="msg-1:exploration" tools={tools} />);

    const toggle = screen.getByRole("button", { name: explorationSummary(tools) });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(container.querySelector('[data-tool-name="read_file"]')).not.toBeNull();
    expect(container.querySelector('[data-tool-name="search_project"]')).not.toBeNull();
  });
});

describe("formatToolOutput and formatError edge cases", () => {
  it("pretty-prints records without content and names values JSON cannot encode", () => {
    expect(formatToolOutput({ files: 2 })).toBe('{\n  "files": 2\n}');
    expect(formatToolOutput(undefined)).toBe("undefined");
    expect(formatToolOutput(null)).toBe("null");
  });

  it("keeps a plain-text response body and the status in the raw detail", () => {
    const error = Object.assign(new Error("Bad gateway"), {
      statusCode: 502,
      responseBody: "<html>upstream timed out</html>",
    });

    expect(formatError(error, "OpenAI")).toBe(
      "⚠ OpenAI: Error Bad gateway (HTTP 502) → <html>upstream timed out</html>",
    );
  });

  it("uses a JSON body that carries no error message as the detail", () => {
    const error = Object.assign(new Error("Request failed"), {
      status: 500,
      responseBody: JSON.stringify({ detail: "boom" }),
    });

    expect(formatError(error)).toBe('⚠ Error Request failed (HTTP 500) → {"detail":"boom"}');
  });

  it("adds the HTTP status to a friendly hint when there is no body", () => {
    const error = Object.assign(new Error("Too many requests"), { statusCode: 429 });

    expect(formatError(error)).toMatch(/ \(HTTP 429\)$/u);
  });

  it("falls back to the value itself when an object has no name or message", () => {
    expect(formatError({ code: 7 })).toBe("⚠ [object Object]");
  });
});

describe("ReasoningBlock states", () => {
  it("hides a finished block with no text and labels a timeless block", () => {
    const { container, rerender } = render(<ReasoningBlock text="   " />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ReasoningBlock text="Checked the lemma." />);
    expect(screen.getByRole("button", { name: enAi.chat.reasoning.label })).toBeInTheDocument();
  });

  it("follows the newest text while an open block streams", () => {
    const { container, rerender } = render(<ReasoningBlock text="First thought." active />);
    fireEvent.click(screen.getByRole("button", { name: enAi.chat.reasoning.thinking }));
    const body = container.querySelector(".max-h-56") as HTMLElement;
    Object.defineProperty(body, "scrollHeight", { configurable: true, value: 640 });

    rerender(<ReasoningBlock text="First thought. Second thought." active />);

    expect(body.scrollTop).toBe(640);
  });
});

describe("SubagentCard states", () => {
  it("shows the provider logo and the failure body for a failed subagent with no answer", () => {
    const { container } = render(
      <SubagentCard entry={{ id: "s1", label: "Check citations", state: "error", providerId: "openai" }} />,
    );

    expect(screen.getByText(enAi.chat.subagent.failed)).toBeInTheDocument();
    expect(screen.getByText(enAi.chat.subagent.errorBody)).toBeInTheDocument();
    expect(container.querySelector('[data-subagent-state="error"] .lucide-bot')).toBeNull();
  });

  it("says it is working when a tool step has no name yet", () => {
    render(<SubagentCard entry={{ id: "s2", label: "Survey", state: "tool" }} />);

    expect(screen.getByText(enAi.chat.subagent.working)).toBeInTheDocument();
  });

  it("measures a finished answer once when ResizeObserver is unavailable", () => {
    const previous = globalThis.ResizeObserver;
    Reflect.deleteProperty(globalThis, "ResizeObserver");
    try {
      render(<SubagentCard entry={{ id: "s3", label: "Summarise", state: "done", detail: "Short answer." }} />);
    } finally {
      Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: previous });
    }

    expect(screen.getByTestId("subagent-output")).toHaveAttribute("data-expanded", "false");
    expect(screen.getByText("Short answer.")).toBeInTheDocument();
  });
});

describe("MessageItem rows", () => {
  it("collapses consecutive read-only calls into one explored row inside the folded steps", () => {
    const { container } = render(
      <MessageItem
        msg={{
          role: "assistant",
          content: "Here is what I found.",
          toolCalls: [
            { name: "read_file", status: "done" },
            { name: "list_files", status: "done" },
            { name: "search_project", status: "done" },
            { name: "edit_file", status: "done" },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("worked-steps-toggle"));

    const group = screen.getByTestId("exploration-group");
    expect(group).toHaveTextContent(
      explorationSummary([
        { name: "read_file", status: "done" },
        { name: "list_files", status: "done" },
        { name: "search_project", status: "done" },
      ]),
    );
    expect(container.querySelector('[data-tool-name="edit_file"]')).not.toBeNull();
    expect(container.querySelector('[data-tool-name="read_file"]')).toBeNull();
  });

  it("keeps a read-only call alone when reasoning was recorded between it and the next one", () => {
    const { container } = render(
      <MessageItem
        msg={{
          role: "assistant",
          content: "Done.",
          reasoningBlocks: [{ id: "r1", text: "Now search.", ms: 900, beforeTool: 1 }],
          toolCalls: [
            { id: "t1", name: "read_file", status: "done" },
            { id: "t2", name: "search_project", status: "done" },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("worked-steps-toggle"));

    expect(screen.queryByTestId("exploration-group")).toBeNull();
    expect(container.querySelector('[data-tool-name="read_file"]')).not.toBeNull();
    expect(container.querySelector('[data-tool-name="search_project"]')).not.toBeNull();
  });

  it("shows the legacy single reasoning field before the first tool", () => {
    const { container } = render(
      <MessageItem
        live
        msg={{
          role: "assistant",
          content: "",
          reasoning: "Old-format thinking.",
          toolCalls: [{ name: "edit_file", status: "running" }],
        }}
      />,
    );

    const block = container.querySelector("[data-reasoning-block]");
    expect(block).toHaveAttribute("data-reasoning-status", "running");
    const toolCard = container.querySelector('[data-tool-name="edit_file"]') as HTMLElement;
    expect(block?.compareDocumentPosition(toolCard)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("lists every attachment, including two files with the same name", () => {
    render(
      <MessageItem
        msg={{
          role: "user",
          content: "See attached",
          attachments: [
            { name: "figure.png", mediaType: "image/png", data: "a" },
            { name: "figure.png", mediaType: "image/png", data: "b" },
            { name: "notes.txt", mediaType: "text/plain", data: "c" },
          ],
        } as never}
      />,
    );

    expect(screen.getAllByText("figure.png")).toHaveLength(2);
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("drops a timestamp that is not a valid date", () => {
    const { container } = render(
      <MessageItem msg={{ role: "assistant", content: "Odd clock", createdAt: Number.NaN }} />,
    );

    expect(container.querySelector("time")).toBeNull();
    expect(screen.getByText("Odd clock")).toBeInTheDocument();
  });

  it("shows the delegated subagents after the steps without folding them", () => {
    render(
      <MessageItem
        msg={{
          role: "assistant",
          content: "Delegated.",
          toolCalls: [{ id: "t1", name: "edit_file", status: "done" }],
          subagents: [{ id: "s1", label: "Survey diffusion", state: "done", detail: "Found four papers." }],
        }}
      />,
    );

    expect(screen.queryByTestId("worked-steps-toggle")).toBeNull();
    expect(screen.getByTestId("subagent-card")).toHaveTextContent("Survey diffusion");
  });
});
