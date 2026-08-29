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
});
