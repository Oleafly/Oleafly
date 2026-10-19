import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpEvent, AcpSession, AcpSnapshot } from "@/lib/acp";

const mocks = vi.hoisted(() => ({
  acpPrompt: vi.fn(),
  acpSteer: vi.fn(),
  acpStart: vi.fn(),
  acpSnapshot: vi.fn(),
  acpEvents: vi.fn(),
  acpDisconnect: vi.fn(),
  acpBufferReply: vi.fn(),
  onAcpEvent: vi.fn(),
  onAcpResync: vi.fn(),
  onAcpSession: vi.fn(),
  onAcpBufferRequest: vi.fn(),
  flushOpenFilesToDisk: vi.fn(),
  refreshOpenFilesFromDisk: vi.fn(),
  toPromptInput: vi.fn(),
  bufferContent: vi.fn(),
}));

vi.mock("@/lib/acp", async (original) => ({
  ...(await original<typeof import("@/lib/acp")>()),
  acpPrompt: mocks.acpPrompt,
  acpSteer: mocks.acpSteer,
  acpStart: mocks.acpStart,
  acpSnapshot: mocks.acpSnapshot,
  acpEvents: mocks.acpEvents,
  acpDisconnect: mocks.acpDisconnect,
  acpBufferReply: mocks.acpBufferReply,
  onAcpEvent: mocks.onAcpEvent,
  onAcpResync: mocks.onAcpResync,
  onAcpSession: mocks.onAcpSession,
  onAcpBufferRequest: mocks.onAcpBufferRequest,
}));
vi.mock("@/lib/external-file-changes", () => ({
  flushOpenFilesToDisk: mocks.flushOpenFilesToDisk,
  refreshOpenFilesFromDisk: mocks.refreshOpenFilesFromDisk,
}));
vi.mock("@/components/ai/acp/acp-attachments", async (original) => ({
  ...(await original<typeof import("@/components/ai/acp/acp-attachments")>()),
  toPromptInput: mocks.toPromptInput,
}));
vi.mock("@/components/ai/acp/acp-buffers", () => ({ bufferContent: mocks.bufferContent }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ tree: [{ path: "main.tex", name: "main.tex", is_dir: false }] }) },
}));

import { AcpPromptError } from "@/components/ai/acp/acp-attachments";
import { initTestI18n } from "@/components/ai/acp/tests/ui-fixtures";
import { SaveFlushError } from "@/store/save-flush-error";
import { attachAcpListeners, MAX_VISIBLE_EVENTS, type AcpPromptDraft, useAcpSessionsStore } from "./acp-sessions";

function session(id: string, overrides: Partial<AcpSession> = {}): AcpSession {
  return {
    id, projectId: "p", projectPath: "/project", agentId: "agent", agentVersion: null, nativeSessionId: id,
    parentSessionId: null, taskId: null, title: id, status: "ready", createdAt: 1, updatedAt: 1, turnId: null,
    lastSequence: 0, error: null, authMethods: [],
    capabilities: { loadSession: true, resume: false, image: false, audio: false, embeddedContext: false, additionalDirectories: false, mcpHttp: true },
    controls: { modelId: null, modelConfigId: null, models: [] },
    ...overrides,
  };
}

function event(sequence: number, kind = "agent_message_chunk", data: Record<string, unknown> = {}, sessionId = "s"): AcpEvent {
  return { sequence, kind, data, sessionId, projectId: "p", agentId: "agent", modelId: null, taskId: null, turnId: "turn", timestamp: 1000 + sequence };
}

function draft(text: string, overrides: Partial<AcpPromptDraft> = {}): AcpPromptDraft {
  return { text, attachments: [], mentions: [], selections: [], skill: null, ...overrides };
}

const snapshot = (value: AcpSession): AcpSnapshot => ({ session: value, permissions: [] });
const input = (text: string) => ({ text, images: [], files: [], selections: [], skillId: null });

function reset(sessions: AcpSession[], active: string | null = "s") {
  useAcpSessionsStore.setState({
    catalog: [], sessions: Object.fromEntries(sessions.map((value) => [value.id, value])), activeByProject: { p: active },
    events: {}, permissions: {}, elicitations: {}, composers: {}, queues: {}, watched: {}, sending: {}, errors: {}, starting: {},
  });
}

beforeEach(async () => {
  await initTestI18n();
  vi.resetAllMocks();
  mocks.flushOpenFilesToDisk.mockResolvedValue(undefined);
  mocks.toPromptInput.mockImplementation(async (value: AcpPromptDraft) => input(value.text));
  mocks.acpEvents.mockResolvedValue({ events: [], hasMore: false });
  reset([session("s")]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("what the store keeps in memory", () => {
  it("keeps events only for the conversation shown in this window", () => {
    reset([session("s1"), session("s2")], "s1");
    useAcpSessionsStore.getState().ingest([event(1, "agent_message_chunk", {}, "s1"), event(1, "agent_message_chunk", {}, "s2")]);
    const state = useAcpSessionsStore.getState();
    expect(state.events.s1).toHaveLength(1);
    expect(state.events.s2).toBeUndefined();
    expect(state.sessions.s2.lastSequence).toBe(1);
  });

  it("drops the hidden conversation's events when another opens", () => {
    reset([session("s1"), session("s2")], "s1");
    const store = useAcpSessionsStore.getState();
    store.ingest([event(1, "agent_message_chunk", {}, "s1")]);
    store.setActive("p", "s2");
    expect(useAcpSessionsStore.getState().events.s1).toBeUndefined();
    store.setActive("p", "s2");
    store.setActive("p", null);
    expect(useAcpSessionsStore.getState().activeByProject.p).toBeNull();
  });

  it("keeps a watched conversation's events until the last watcher leaves", () => {
    reset([session("s1"), session("s2")], "s1");
    const store = useAcpSessionsStore.getState();
    const first = store.watch("s2");
    const second = store.watch("s2");
    store.ingest([event(1, "agent_message_chunk", {}, "s2")]);
    expect(useAcpSessionsStore.getState().events.s2).toHaveLength(1);
    first();
    first();
    expect(useAcpSessionsStore.getState().watched.s2).toBe(1);
    expect(useAcpSessionsStore.getState().events.s2).toHaveLength(1);
    second();
    expect(useAcpSessionsStore.getState().watched.s2).toBeUndefined();
    expect(useAcpSessionsStore.getState().events.s2).toBeUndefined();
  });

  it("keeps a watched conversation's events when the window switches away from it", () => {
    reset([session("s1"), session("s2")], "s1");
    const store = useAcpSessionsStore.getState();
    const release = store.watch("s1");
    store.ingest([event(1, "agent_message_chunk", {}, "s1")]);
    store.setActive("p", "s2");
    expect(useAcpSessionsStore.getState().events.s1).toHaveLength(1);
    store.setActive("p", "s1");
    release();
    expect(useAcpSessionsStore.getState().events.s1).toHaveLength(1);
  });

  it("keeps at most 2000 events for a visible conversation", () => {
    useAcpSessionsStore.getState().ingest(Array.from({ length: 2500 }, (_, index) => event(index + 1)));
    const events = useAcpSessionsStore.getState().events.s;
    expect(events).toHaveLength(MAX_VISIBLE_EVENTS);
    expect(events[0].sequence).toBe(501);
  });

  it("applies permissions and agent requests of hidden sessions", () => {
    reset([session("s"), session("child", { parentSessionId: "s" })]);
    const permission = { id: "perm", sessionId: "child", turnId: "turn", title: "Edit", toolCallId: null, options: [], expiresAt: Date.now() + 60_000 };
    const elicitation = { id: "ask", mode: "form", message: "Name?", url: null, fields: [], sessionId: "child", toolCallId: null, expiresAt: Date.now() + 60_000 };
    useAcpSessionsStore.getState().ingest([
      event(1, "permission", permission, "child"),
      event(2, "elicitation", elicitation, "child"),
      event(3, "elicitation", elicitation, "child"),
      event(4, "elicitation", { ...elicitation, id: "late", expiresAt: Date.now() - 1 }, "child"),
    ]);
    let state = useAcpSessionsStore.getState();
    expect(state.permissions.child.map((value) => value.id)).toEqual(["perm"]);
    expect(state.elicitations.child.map((value) => value.id)).toEqual(["ask"]);
    expect(state.events.child).toBeUndefined();
    useAcpSessionsStore.getState().ingest([event(5, "elicitation_resolved", { id: "ask" }, "child")]);
    expect(useAcpSessionsStore.getState().elicitations.child).toEqual([]);
    useAcpSessionsStore.getState().ingest([event(6, "elicitation", { ...elicitation, id: "again" }, "child"), event(7, "status", { status: "disconnected" }, "child")]);
    state = useAcpSessionsStore.getState();
    expect(state.elicitations.child).toEqual([]);
  });

  it("updates usage, title, commands and controls from their events", () => {
    const usage = { contextUsed: 10, contextSize: 100 };
    const commands = [{ name: "plan", description: "Plan", hint: null }];
    const controls = { modelId: "opus", models: [{ modelId: "opus", name: "Opus" }] };
    useAcpSessionsStore.getState().ingest([
      event(1, "usage", { session: usage }),
      event(2, "available_commands", { commands }),
      event(3, "session_info", { title: "Fix the introduction" }),
      event(4, "controls", { controls }),
      event(5, "turn_commit", { turnId: "turn", commit: "abc1234", paths: ["main.tex"] }),
      event(6, "usage", { session: "not an object" }),
      event(7, "controls", { controls: [] }),
      event(8, "available_commands", { commands: "none" }),
    ]);
    const value = useAcpSessionsStore.getState().sessions.s;
    expect(value.usage).toEqual(usage);
    expect(value.availableCommands).toEqual(commands);
    expect(value.title).toBe("Fix the introduction");
    expect(value.controls).toMatchObject({ modelId: "opus", modelConfigId: null, models: [{ modelId: "opus", name: "Opus" }] });
    expect(value.commits).toEqual([{ turnId: "turn", commit: "abc1234", paths: ["main.tex"], message: "", createdAt: 1005 }]);
    expect(value.lastSequence).toBe(8);
    expect(mocks.acpSnapshot).not.toHaveBeenCalled();
  });

  it("keeps a title the user chose", () => {
    reset([session("s", { title: "My title", titleLocked: true })]);
    useAcpSessionsStore.getState().ingest([event(1, "session_info", { title: "Agent title" }), event(2, "turn_commit", {})]);
    const value = useAcpSessionsStore.getState().sessions.s;
    expect(value.title).toBe("My title");
    expect(value.commits).toEqual([{ turnId: "", commit: "", paths: [], message: "", createdAt: 1002 }]);
  });

  it("ignores events of unknown or older sequences for the session fields", () => {
    reset([session("s", { lastSequence: 5, title: "Kept" })]);
    useAcpSessionsStore.getState().ingest([event(3, "session_info", { title: "Old" }), event(1, "session_info", { title: "x" }, "unknown")]);
    expect(useAcpSessionsStore.getState().sessions.s.title).toBe("Kept");
    expect(useAcpSessionsStore.getState().sessions.unknown).toBeUndefined();
  });
});

describe("the send queue", () => {
  it("queues messages and removes one", () => {
    const store = useAcpSessionsStore.getState();
    const first = store.enqueue("s", draft("one"));
    const second = store.enqueue("s", draft("two"));
    expect(first).not.toBe(second);
    store.removeQueued("s", first);
    expect(useAcpSessionsStore.getState().queues.s.map((item) => item.text)).toEqual(["two"]);
    const before = useAcpSessionsStore.getState();
    store.removeQueued("s", "missing");
    expect(useAcpSessionsStore.getState()).toBe(before);
  });

  it("sends the first queued message when the turn completes", async () => {
    vi.useFakeTimers();
    reset([session("s", { status: "running" })]);
    let emit: (value: AcpEvent) => void = () => {};
    mocks.onAcpEvent.mockImplementation(async (listener: (value: AcpEvent) => void) => { emit = listener; return () => {}; });
    mocks.onAcpResync.mockResolvedValue(() => {});
    mocks.onAcpSession.mockResolvedValue(() => {});
    mocks.onAcpBufferRequest.mockResolvedValue(() => {});
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s", { status: "ready" })));
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "running", lastSequence: 1 })));
    const detach = await attachAcpListeners();
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("first"));
    store.enqueue("s", draft("second"));
    emit(event(1, "turn_complete", { stopReason: "end_turn" }));
    await vi.advanceTimersByTimeAsync(40);
    await vi.waitFor(() => expect(mocks.acpPrompt).toHaveBeenCalledTimes(1));
    expect(mocks.acpPrompt).toHaveBeenCalledWith("p", "s", input("first"));
    await vi.waitFor(() => expect(useAcpSessionsStore.getState().queues.s.map((item) => item.text)).toEqual(["second"]));
    expect(mocks.flushOpenFilesToDisk).toHaveBeenCalledWith("p", "save before agent prompt");
    detach();
  });

  it("marks a queued message that failed and stops sending", async () => {
    mocks.acpPrompt.mockRejectedValue(new Error("The agent closed the connection."));
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s")));
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("first"));
    store.enqueue("s", draft("second"));
    await store.dispatchQueued("p", "s");
    const queue = useAcpSessionsStore.getState().queues.s;
    expect(queue[0]).toMatchObject({ text: "first", sending: false, failed: true });
    expect(queue).toHaveLength(2);
    expect(useAcpSessionsStore.getState().errors.p).toBe("The agent closed the connection.");
    await store.dispatchQueued("p", "s");
    expect(mocks.acpPrompt).toHaveBeenCalledTimes(1);
  });

  it("waits to send until the conversation is ready", async () => {
    reset([session("s", { status: "connecting" })]);
    const store = useAcpSessionsStore.getState();
    await store.dispatchQueued("p", "s");
    store.enqueue("s", draft("first"));
    await store.dispatchQueued("p", "s");
    expect(mocks.acpPrompt).not.toHaveBeenCalled();
    expect(useAcpSessionsStore.getState().queues.s[0].sending).toBeUndefined();
  });

  it("removes a steered message the agent took in", async () => {
    reset([session("s", { status: "running", capabilities: { ...session("s").capabilities, steering: true } })]);
    mocks.acpSteer.mockResolvedValue("injected");
    const store = useAcpSessionsStore.getState();
    const id = store.enqueue("s", draft("Also check the figures"));
    await store.steerQueued("p", "s", id);
    expect(mocks.acpSteer).toHaveBeenCalledWith("p", "s", "Also check the figures");
    expect(useAcpSessionsStore.getState().queues.s).toEqual([]);
  });

  it("keeps a steered message queued when the agent needs a new turn", async () => {
    reset([session("s", { status: "running", capabilities: { ...session("s").capabilities, steering: true } })]);
    mocks.acpSteer.mockResolvedValue("promptRequired");
    const store = useAcpSessionsStore.getState();
    const id = store.enqueue("s", draft("Also check the figures"));
    await store.steerQueued("p", "s", id);
    expect(useAcpSessionsStore.getState().queues.s.map((item) => item.id)).toEqual([id]);
  });

  it("steers only plain text while a turn runs on an agent that can take it", async () => {
    const steering = { ...session("s").capabilities, steering: true };
    reset([session("s", { status: "running", capabilities: steering })]);
    const store = useAcpSessionsStore.getState();
    const withFile = store.enqueue("s", draft("see file", { attachments: [{ id: "a", name: "a.pdf", mime: "application/pdf", size: 1, status: "ready", kind: "pdf", scope: "p", sha256: "x" }] }));
    const withQuote = store.enqueue("s", draft("see quote", { selections: [{ id: "q", path: null, text: "t", label: "1-1" }] }));
    const withSkill = store.enqueue("s", draft("use skill", { skill: { id: "k", name: "K" } }));
    for (const id of [withFile, withQuote, withSkill, "missing"]) await store.steerQueued("p", "s", id);
    reset([session("s", { status: "ready", capabilities: steering })]);
    const plain = useAcpSessionsStore.getState().enqueue("s", draft("plain"));
    await useAcpSessionsStore.getState().steerQueued("p", "s", plain);
    reset([session("s", { status: "running" })]);
    const noSteering = useAcpSessionsStore.getState().enqueue("s", draft("plain"));
    await useAcpSessionsStore.getState().steerQueued("p", "s", noSteering);
    expect(mocks.acpSteer).not.toHaveBeenCalled();
  });

  it("reports a steering failure", async () => {
    reset([session("s", { status: "running", capabilities: { ...session("s").capabilities, steering: true } })]);
    mocks.acpSteer.mockRejectedValue("Steering is not available now.");
    const store = useAcpSessionsStore.getState();
    const id = store.enqueue("s", draft("more"));
    await store.steerQueued("p", "s", id);
    expect(useAcpSessionsStore.getState().errors.p).toBe("Steering is not available now.");
    expect(useAcpSessionsStore.getState().queues.s).toHaveLength(1);
  });

  it("starts a conversation and sends the message once it is ready", async () => {
    reset([], null);
    mocks.acpStart.mockResolvedValue(snapshot(session("new", { status: "ready" })));
    mocks.acpPrompt.mockResolvedValue(snapshot(session("new", { status: "running", lastSequence: 1 })));
    await useAcpSessionsStore.getState().startWithPrompt("p", "agent", draft("Hello"));
    expect(mocks.acpStart).toHaveBeenCalledWith("p", "agent");
    expect(mocks.acpPrompt).toHaveBeenCalledWith("p", "new", input("Hello"));
    expect(useAcpSessionsStore.getState().queues.new).toEqual([]);
  });

  it("keeps the first message queued while a new conversation connects", async () => {
    reset([], null);
    mocks.acpStart.mockResolvedValue(snapshot(session("new", { status: "connecting" })));
    await useAcpSessionsStore.getState().startWithPrompt("p", "agent", draft("Hello"));
    expect(mocks.acpPrompt).not.toHaveBeenCalled();
    expect(useAcpSessionsStore.getState().queues.new.map((item) => item.text)).toEqual(["Hello"]);
  });
});

describe("sending a prompt", () => {
  it("sends the prepared input and clears the project's error", async () => {
    useAcpSessionsStore.getState().setError("p", "old error");
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "running", lastSequence: 3 })));
    await expect(useAcpSessionsStore.getState().sendPrompt("p", "s", draft("Hi"))).resolves.toBe(true);
    expect(mocks.toPromptInput).toHaveBeenCalledWith(draft("Hi"), expect.objectContaining({ id: "s" }), [{ path: "main.tex", name: "main.tex", is_dir: false }]);
    const state = useAcpSessionsStore.getState();
    expect(state.errors.p).toBeNull();
    expect(state.sessions.s.status).toBe("running");
    expect(state.sending.s).toBeUndefined();
  });

  it("does not send when open files could not be saved", async () => {
    mocks.flushOpenFilesToDisk.mockRejectedValue(new SaveFlushError([{ path: "main.tex", reason: "The disk is full." }]));
    await expect(useAcpSessionsStore.getState().sendPrompt("p", "s", draft("Hi"))).resolves.toBe(false);
    expect(mocks.acpPrompt).not.toHaveBeenCalled();
    expect(useAcpSessionsStore.getState().errors.p).toBeUndefined();
  });

  it("passes on any other failure to save first", async () => {
    mocks.flushOpenFilesToDisk.mockRejectedValue(new Error("unexpected"));
    await expect(useAcpSessionsStore.getState().sendPrompt("p", "s", draft("Hi"))).rejects.toThrow("unexpected");
  });

  it("refuses a conversation it does not know", async () => {
    await expect(useAcpSessionsStore.getState().sendPrompt("p", "missing", draft("Hi"))).resolves.toBe(false);
    expect(mocks.acpPrompt).not.toHaveBeenCalled();
  });

  it("explains a message the composer could not prepare", async () => {
    mocks.toPromptInput.mockRejectedValue(new AcpPromptError("tooMany"));
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s")));
    await expect(useAcpSessionsStore.getState().sendPrompt("p", "s", draft("Hi"))).resolves.toBe(false);
    expect(useAcpSessionsStore.getState().errors.p).toBe("Attach up to 10 files to one message.");
  });

  it("says nothing more when the agent asks to sign in", async () => {
    mocks.acpPrompt.mockRejectedValue(new Error("Authentication required"));
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s", { status: "auth_required", lastSequence: 1 })));
    await expect(useAcpSessionsStore.getState().sendPrompt("p", "s", draft("Hi"))).resolves.toBe(false);
    expect(useAcpSessionsStore.getState().errors.p).toBeUndefined();
  });

  it("counts a failed turn as sent when the agent already received the message", async () => {
    mocks.acpPrompt.mockRejectedValue(new Error("The agent crashed."));
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s", { status: "failed", lastSequence: 2 })));
    mocks.acpEvents.mockResolvedValueOnce({ events: [event(1, "user_message", { content: [] }), event(2, "status", { status: "failed" })], hasMore: false });
    await expect(useAcpSessionsStore.getState().sendPrompt("p", "s", draft("Hi"))).resolves.toBe(true);
    expect(useAcpSessionsStore.getState().errors.p).toBe("The agent crashed.");
  });
});

describe("other windows and buffers", () => {
  it("applies a newer summary from another window and ignores an older one", () => {
    reset([session("s", { lastSequence: 5, title: "Old" }), session("locked", { lastSequence: 1, title: "Mine", titleLocked: true })]);
    const store = useAcpSessionsStore.getState();
    store.applySummary({ projectId: "p", sessionId: "s", agentId: "agent", title: "New", status: "running", updatedAt: 99, lastSequence: 7 });
    expect(useAcpSessionsStore.getState().sessions.s).toMatchObject({ title: "New", status: "running", updatedAt: 99, lastSequence: 7 });
    const before = useAcpSessionsStore.getState();
    store.applySummary({ projectId: "p", sessionId: "s", agentId: "agent", title: "Older", status: "ready", updatedAt: 50, lastSequence: 6 });
    store.applySummary({ projectId: "p", sessionId: "unknown", agentId: "agent", title: "x", status: "ready", updatedAt: 1, lastSequence: 9 });
    expect(useAcpSessionsStore.getState()).toBe(before);
    store.applySummary({ projectId: "p", sessionId: "locked", agentId: "agent", title: "Agent's", status: "ready", updatedAt: 2, lastSequence: 2 });
    expect(useAcpSessionsStore.getState().sessions.locked.title).toBe("Mine");
  });

  it("listens for summaries and answers buffer requests with the open editor text", async () => {
    let summary: (value: unknown) => void = () => {};
    let buffer: (value: unknown) => void = () => {};
    mocks.onAcpEvent.mockResolvedValue(() => {});
    mocks.onAcpResync.mockResolvedValue(() => {});
    mocks.onAcpSession.mockImplementation(async (listener: (value: unknown) => void) => { summary = listener; return () => {}; });
    mocks.onAcpBufferRequest.mockImplementation(async (listener: (value: unknown) => void) => { buffer = listener; return () => {}; });
    mocks.bufferContent.mockReturnValue("\\section{Intro}");
    mocks.acpBufferReply.mockResolvedValue(undefined);
    reset([session("s", { lastSequence: 1 })]);
    const detach = await attachAcpListeners();
    summary({ projectId: "p", sessionId: "s", agentId: "agent", title: "From the other window", status: "ready", updatedAt: 5, lastSequence: 2 });
    expect(useAcpSessionsStore.getState().sessions.s.title).toBe("From the other window");
    buffer({ requestId: "r1", projectId: "p", path: "main.tex" });
    await vi.waitFor(() => expect(mocks.acpBufferReply).toHaveBeenCalledWith("r1", "\\section{Intro}"));
    expect(mocks.bufferContent).toHaveBeenCalledWith("p", "main.tex");
    detach();
  });

  it("answers a buffer request with nothing when reading the editor fails", async () => {
    let buffer: (value: unknown) => void = () => {};
    mocks.onAcpEvent.mockResolvedValue(() => {});
    mocks.onAcpResync.mockResolvedValue(() => {});
    mocks.onAcpSession.mockResolvedValue(() => {});
    mocks.onAcpBufferRequest.mockImplementation(async (listener: (value: unknown) => void) => { buffer = listener; return () => {}; });
    mocks.bufferContent.mockImplementation(() => { throw new Error("no editor"); });
    mocks.acpBufferReply.mockRejectedValueOnce(new Error("gone")).mockResolvedValue(undefined);
    const detach = await attachAcpListeners();
    buffer({ requestId: "r2", projectId: "p", path: "main.tex" });
    await vi.waitFor(() => expect(mocks.acpBufferReply).toHaveBeenCalledWith("r2", null));
    detach();
  });
});
