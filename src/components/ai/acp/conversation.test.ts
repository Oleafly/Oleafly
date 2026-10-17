import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { AcpEvent, AcpSession } from "@/lib/acp";
import { createAcpConversation } from "./conversation";
import { projectAcpEvents } from "./projection";

type Source = { events: Record<string, AcpEvent[]>; sessions: Record<string, AcpSession> };

function event(sequence: number, kind: string, data: Record<string, unknown>, sessionId = "s1"): AcpEvent {
  return { sequence, kind, data, sessionId, projectId: "paper", agentId: "fixture", modelId: null, taskId: null, turnId: "turn", timestamp: sequence };
}
const chunk = (sequence: number, text: string) => event(sequence, "agent_message_chunk", { content: { type: "text", text } });
const toolUpdate = (sequence: number, output: string, status = "in_progress") =>
  event(sequence, "tool_call_update", {
    toolCallId: "build",
    status,
    content: [{ type: "content", content: { type: "text", text: output } }],
  });

function session(status: AcpSession["status"], id = "s1"): AcpSession {
  return {
    id, projectId: "paper", projectPath: "/paper", agentId: "fixture", agentVersion: null, nativeSessionId: null,
    parentSessionId: null, taskId: null, title: "", status, createdAt: 1, updatedAt: 1, turnId: null,
    capabilities: { loadSession: false, resume: false, image: false, audio: false, embeddedContext: false, additionalDirectories: false, mcpHttp: false },
    controls: { models: [], modelId: null, modelConfigId: null }, authMethods: [], error: null, lastSequence: 0,
  };
}

function source(events: AcpEvent[], status: AcpSession["status"] = "running") {
  return createStore<Source>(() => ({ events: { s1: events }, sessions: { s1: session(status) } }));
}

function append(store: ReturnType<typeof source>, ...incoming: AcpEvent[]) {
  store.setState((state) => ({ events: { ...state.events, s1: [...(state.events.s1 ?? []), ...incoming] } }));
}

const opening = [
  event(1, "user_message", { text: "Rebuild the paper" }),
  chunk(2, "Starting"),
];

describe("ACP conversation", () => {
  it("shows the conversation it was opened on before it starts following the store", () => {
    const store = source(opening);
    const conversation = createAcpConversation("s1", store);

    expect(conversation.getMessages()).toEqual(projectAcpEvents(opening, true));
    expect(conversation.live.get()).toBeNull();
  });

  it("streams agent text into the live message without touching the committed rows", () => {
    const store = source(opening);
    const conversation = createAcpConversation("s1", store);
    const listener = vi.fn();
    conversation.subscribe(listener);
    conversation.connect();
    const committed = conversation.getMessages();

    append(store, chunk(3, " the build"));
    append(store, chunk(4, " now."));

    expect(conversation.getMessages()).toBe(committed);
    expect(listener).not.toHaveBeenCalled();
    expect(conversation.live.get()).toMatchObject({
      base: committed[1].msg,
      message: { content: "Starting the build now." },
    });
  });

  it("streams tool output into the live message while the tool row keeps its place", () => {
    const store = source([...opening, event(3, "tool_call", { toolCallId: "build", title: "Run latexmk", status: "pending" })]);
    const conversation = createAcpConversation("s1", store);
    const listener = vi.fn();
    conversation.subscribe(listener);
    conversation.connect();
    const committed = conversation.getMessages();

    append(store, toolUpdate(4, "pass 1"));
    append(store, toolUpdate(5, "pass 1\npass 2"));

    expect(conversation.getMessages()).toBe(committed);
    expect(listener).not.toHaveBeenCalled();
    expect(conversation.live.get()?.base).toBe(committed[2].msg);
    expect(conversation.live.get()?.message.toolCalls?.[0]).toMatchObject({ status: "running", output: "pass 1\npass 2" });
  });

  it("commits a new row and clears the live message", () => {
    const store = source(opening);
    const conversation = createAcpConversation("s1", store);
    const listener = vi.fn();
    conversation.subscribe(listener);
    conversation.connect();
    append(store, chunk(3, " the build"));

    append(store, event(4, "tool_call", { toolCallId: "build", title: "Run latexmk", status: "pending" }));

    expect(listener).toHaveBeenCalledOnce();
    expect(conversation.live.get()).toBeNull();
    expect(conversation.getMessages().map((entry) => entry.msg.content)).toEqual(["Rebuild the paper", "Starting the build", ""]);
    expect(conversation.getMessages().at(-1)?.live).toBe(true);
  });

  it("commits when the turn stops running so the newest row stops showing as live", () => {
    const store = source(opening);
    const conversation = createAcpConversation("s1", store);
    const listener = vi.fn();
    conversation.subscribe(listener);
    conversation.connect();
    append(store, chunk(3, " done"));

    store.setState((state) => ({
      events: { s1: [...state.events.s1, event(4, "turn_complete", { stopReason: "end_turn" })] },
      sessions: { s1: { ...state.sessions.s1, status: "ready" } },
    }));

    expect(listener).toHaveBeenCalledOnce();
    expect(conversation.live.get()).toBeNull();
    expect(conversation.getMessages().at(-1)).toMatchObject({ live: false, msg: { content: "Starting done" } });
  });

  it("marks the newest row live while a prompt is being sent", () => {
    const store = source(opening, "ready");
    const conversation = createAcpConversation("s1", store);
    conversation.connect();
    const listener = vi.fn();
    conversation.subscribe(listener);
    expect(conversation.getMessages().at(-1)?.live).toBe(false);

    conversation.setSending(true);
    conversation.setSending(true);

    expect(listener).toHaveBeenCalledOnce();
    expect(conversation.getMessages().at(-1)?.live).toBe(true);
  });

  it("ignores other conversations and catches up on events from before it connected", () => {
    const store = source(opening);
    const conversation = createAcpConversation("s1", store);
    const listener = vi.fn();
    conversation.subscribe(listener);
    append(store, event(3, "tool_call", { toolCallId: "build", title: "Run latexmk", status: "pending" }));

    const disconnect = conversation.connect();
    expect(listener).toHaveBeenCalledOnce();
    expect(conversation.getMessages()).toHaveLength(3);

    store.setState((state) => ({ events: { ...state.events, s2: [chunk(1, "Elsewhere")] }, sessions: { ...state.sessions, s2: session("running", "s2") } }));
    expect(listener).toHaveBeenCalledOnce();

    disconnect();
    append(store, event(4, "tool_call", { toolCallId: "read", title: "Read", status: "pending" }));
    expect(listener).toHaveBeenCalledOnce();
    expect(conversation.getMessages()).toHaveLength(3);
  });

  it("shows nothing without a conversation", () => {
    const conversation = createAcpConversation(null, source(opening));
    conversation.connect();

    expect(conversation.getMessages()).toEqual([]);
  });
});
