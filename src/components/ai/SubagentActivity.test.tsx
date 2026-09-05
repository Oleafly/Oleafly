// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubagentActivity } from "./SubagentActivity";
import { useAgentTurnsStore } from "@/store/agent-turns";
import type { AgentEvent } from "@oleafly/ai-core";

const TRANSCRIPT = [
  {
    turnId: "agent-1",
    clientTurnId: null,
    status: "completed",
    usage: { input: 1, output: 1 },
    error: null,
    stoppedAtCap: false,
    items: [
      { id: "i1", item: { type: "agentMessage", text: "Found 3 papers." }, completed: true },
    ],
  },
];

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  read: vi.fn(),
  acpEvents: vi.fn(),
}));

vi.mock("@/lib/agent-backend", () => ({
  agentSubagentsStop: (id: string) => {
    mocks.stop(id);
    return Promise.resolve(1);
  },
  agentThreadRead: (id: string) => {
    mocks.read(id);
    return Promise.resolve(TRANSCRIPT);
  },
}));

vi.mock("@/lib/acp", () => ({
  acpEvents: (...args: unknown[]) => mocks.acpEvents(...args),
}));

function seedChat(chatId: string, events: AgentEvent[]) {
  const store = useAgentTurnsStore.getState();
  store.beginTurn(chatId, "thread-1", "c1", "delegate please");
  for (const event of events) store.applyEvent(chatId, event);
}

describe("SubagentActivity", () => {
  beforeEach(() => {
    cleanup();
    useAgentTurnsStore.getState().reset();
    mocks.stop.mockClear();
    mocks.read.mockClear();
    mocks.acpEvents.mockReset();
  });

  it("renders nothing until a turn records subagent activity", () => {
    const { container } = render(
      <SubagentActivity chatId="chat-1" streaming={false} activeRunId={() => null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a chip per agent with its latest status and avatar", () => {
    seedChat("chat-1", [
      { kind: "subagentUpdate", id: "agent-1", label: "survey", state: "started", detail: null },
      { kind: "subagentUpdate", id: "agent-1", label: "survey", state: "tool", detail: "read_file" },
      { kind: "subagentUpdate", id: "agent-2", label: "verify", state: "done", detail: "checked" },
    ]);
    render(<SubagentActivity chatId="chat-1" streaming={true} activeRunId={() => null} />);

    const chip1 = screen.getByTestId("subagent-chip-agent-1");
    expect(chip1).toHaveAttribute("data-subagent-status", "active");
    const chip2 = screen.getByTestId("subagent-chip-agent-2");
    expect(chip2).toHaveAttribute("data-subagent-status", "completed");
    expect(screen.getByText("working")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
    expect(screen.getByText("Subagents working")).toBeTruthy();
  });

  it("stop-all targets the active run and hides when nothing runs", async () => {
    seedChat("chat-1", [
      { kind: "subagentUpdate", id: "agent-1", label: "survey", state: "started", detail: null },
    ]);
    render(
      <SubagentActivity chatId="chat-1" streaming={true} activeRunId={() => "run-9"} />,
    );
    fireEvent.click(screen.getByTestId("subagent-stop-all"));
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith("run-9"));
  });

  it("expands a chip into the agent's transcript from its rollout thread", async () => {
    seedChat("chat-1", [
      { kind: "subagentUpdate", id: "agent-1", label: "survey", state: "done", detail: "3 papers" },
    ]);
    render(<SubagentActivity chatId="chat-1" streaming={false} activeRunId={() => null} />);
    fireEvent.click(screen.getByTestId("subagent-chip-agent-1"));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith("thread-agent-1"));
    await waitFor(() => expect(screen.getByText(/Found 3 papers/)).toBeTruthy());
  });

  it("aggregates activity across multiple turns of the chat", () => {
    seedChat("chat-1", [
      { kind: "subagentUpdate", id: "agent-1", label: "survey", state: "done", detail: null },
    ]);
    const store = useAgentTurnsStore.getState();
    store.beginTurn("chat-1", "thread-1", "c2", "one more");
    store.applyEvent("chat-1", {
      kind: "subagentUpdate",
      id: "agent-2",
      label: "verify",
      state: "started",
      detail: null,
    });
    render(<SubagentActivity chatId="chat-1" streaming={true} activeRunId={() => null} />);
    expect(screen.getByTestId("subagent-chip-agent-1")).toBeTruthy();
    expect(screen.getByTestId("subagent-chip-agent-2")).toBeTruthy();
  });

  it("loads an ACP child transcript from its recorded project and session", async () => {
    const openSession = vi.fn();
    mocks.acpEvents.mockResolvedValue({
      hasMore: false,
      events: [
        {
          sessionId: "acp-session",
          projectId: "project-1",
          agentId: "codex",
          modelId: "research-model",
          taskId: null,
          turnId: "turn-1",
          sequence: 1,
          timestamp: 1,
          kind: "agent_message_chunk",
          data: { content: { type: "text", text: "I found the reported result." } },
        },
        {
          sessionId: "acp-session",
          projectId: "project-1",
          agentId: "codex",
          modelId: "research-model",
          taskId: null,
          turnId: "turn-1",
          sequence: 2,
          timestamp: 2,
          kind: "tool_call",
          data: { toolCallId: "read-1", title: "Read source", status: "in_progress" },
        },
        {
          sessionId: "acp-session",
          projectId: "project-1",
          agentId: "codex",
          modelId: "research-model",
          taskId: null,
          turnId: "turn-1",
          sequence: 3,
          timestamp: 3,
          kind: "tool_call_update",
          data: {
            toolCallId: "read-1",
            title: "Read source",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "Page 4 excerpt" } }],
          },
        },
      ],
    });
    seedChat("chat-1", [{
      kind: "subagentUpdate",
      id: "agent-1",
      label: "survey",
      state: "done",
      detail: "finished",
      runtime: "acp",
      sessionId: "acp-session",
      providerId: "acp",
      modelId: "research-model",
      agentId: "codex",
    }]);

    render(
      <SubagentActivity
        chatId="chat-1"
        projectId="project-1"
        streaming={false}
        activeRunId={() => null}
        onOpenSession={openSession}
      />,
    );
    fireEvent.click(screen.getByTestId("subagent-chip-agent-1"));

    await waitFor(() => expect(mocks.acpEvents).toHaveBeenCalledWith(
      "project-1",
      "acp-session",
      0,
      300,
    ));
    await waitFor(() => expect(screen.getByText("I found the reported result.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Worked through 1 step/ }));
    expect(document.querySelector('[data-tool-name="Read source"]')).not.toBeNull();
    expect(screen.getByText("codex · acp · research-model")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(openSession).toHaveBeenCalledWith("acp-session", "acp");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("uses a recorded built-in session instead of constructing one", async () => {
    seedChat("chat-1", [{
      kind: "subagentUpdate",
      id: "agent-1",
      label: "survey",
      state: "done",
      detail: "finished",
      runtime: "built-in",
      sessionId: "thread-recorded",
      providerId: null,
      modelId: null,
      agentId: null,
    }]);
    render(<SubagentActivity chatId="chat-1" streaming={false} activeRunId={() => null} />);
    fireEvent.click(screen.getByTestId("subagent-chip-agent-1"));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith("thread-recorded"));
  });
});
