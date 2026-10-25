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
  // The project the window shows.
  files: { projectId: "p" as string | null, tree: [] as { path: string; name: string; is_dir: boolean }[] },
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
  useFilesStore: { getState: () => mocks.files },
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
    events: {}, permissions: {}, elicitations: {}, composers: {}, queues: {}, watched: {}, sending: {}, earlierLoaded: {}, errors: {}, sessionErrors: {}, starting: {},
  });
}

beforeEach(async () => {
  await initTestI18n();
  vi.resetAllMocks();
  mocks.flushOpenFilesToDisk.mockResolvedValue(undefined);
  mocks.toPromptInput.mockImplementation(async (value: AcpPromptDraft) => input(value.text));
  mocks.acpEvents.mockResolvedValue({ events: [], hasMore: false });
  mocks.files = { projectId: "p", tree: [{ path: "main.tex", name: "main.tex", is_dir: false }] };
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
    expect(useAcpSessionsStore.getState().sessionErrors.s).toBe("The agent closed the connection.");
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
    expect(useAcpSessionsStore.getState().sessionErrors.s).toBe("Steering is not available now.");
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
    expect(useAcpSessionsStore.getState().sessionErrors.s).toBe("Attach up to 10 files to one message.");
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
    expect(useAcpSessionsStore.getState().sessionErrors.s).toBe("The agent crashed.");
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

describe("long conversations", () => {
  it("keeps the plan text a usage event does not carry", () => {
    useAcpSessionsStore.getState().ingest([
      event(1, "usage", { session: { contextUsed: 1, planMarkdown: "Plan: Max", planMarkdownAt: 10 } }),
      event(2, "usage", { session: { contextUsed: 2 } }),
    ]);
    expect(useAcpSessionsStore.getState().sessions.s.usage).toMatchObject({
      contextUsed: 2, planMarkdown: "Plan: Max", planMarkdownAt: 10,
    });
    useAcpSessionsStore.getState().ingest([event(3, "usage", { session: { contextUsed: 3, planMarkdown: "Plan: Pro", planMarkdownAt: 20 } })]);
    expect(useAcpSessionsStore.getState().sessions.s.usage).toMatchObject({ planMarkdown: "Plan: Pro", planMarkdownAt: 20 });
  });

  it("cuts the head of a live transcript in steps, not on every batch", () => {
    const store = useAcpSessionsStore.getState();
    store.ingest(Array.from({ length: MAX_VISIBLE_EVENTS }, (_, index) => event(index + 1)));
    const first = useAcpSessionsStore.getState().events.s[0];
    for (let index = 0; index < 100; index++) store.ingest([event(MAX_VISIBLE_EVENTS + index + 1)]);
    const live = useAcpSessionsStore.getState().events.s;
    // The projector starts over whenever the first event changes.
    expect(live[0]).toBe(first);
    expect(live).toHaveLength(MAX_VISIBLE_EVENTS + 100);
    store.ingest(Array.from({ length: 200 }, (_, index) => event(MAX_VISIBLE_EVENTS + 101 + index)));
    const cut = useAcpSessionsStore.getState().events.s;
    expect(cut).toHaveLength(MAX_VISIBLE_EVENTS);
    expect(cut.at(-1)?.sequence).toBe(MAX_VISIBLE_EVENTS + 300);
  });

  it("does not trim away earlier events the reader loaded", async () => {
    reset([session("s", { lastSequence: 4000 })]);
    const store = useAcpSessionsStore.getState();
    store.ingest(Array.from({ length: MAX_VISIBLE_EVENTS }, (_, index) => event(2001 + index)));
    mocks.acpEvents.mockResolvedValueOnce({ events: Array.from({ length: 300 }, (_, index) => event(1701 + index)), hasMore: true });
    await store.loadEarlier("p", "s");
    expect(useAcpSessionsStore.getState().events.s[0].sequence).toBe(1701);
    store.ingest(Array.from({ length: 400 }, (_, index) => event(4001 + index)));
    const after = useAcpSessionsStore.getState().events.s;
    expect(after[0].sequence).toBe(1701);
    expect(after.at(-1)?.sequence).toBe(4400);
  });

  it("forgets what loading earlier events did when the conversation leaves memory", async () => {
    reset([session("s", { lastSequence: 4000 }), session("other")]);
    const store = useAcpSessionsStore.getState();
    store.ingest(Array.from({ length: 10 }, (_, index) => event(2001 + index)));
    mocks.acpEvents.mockResolvedValueOnce({ events: [event(1999), event(2000)], hasMore: true });
    await store.loadEarlier("p", "s");
    expect(useAcpSessionsStore.getState().earlierLoaded.s).toBe(2);
    store.setActive("p", "other");
    expect(useAcpSessionsStore.getState().earlierLoaded.s).toBeUndefined();
  });
});

describe("a message that failed to send", () => {
  async function failFirst() {
    mocks.acpPrompt.mockRejectedValueOnce(new Error("The agent closed the connection."));
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s")));
    const store = useAcpSessionsStore.getState();
    const first = store.enqueue("s", draft("first"));
    store.enqueue("s", draft("second"));
    await store.dispatchQueued("p", "s");
    return first;
  }

  it("goes out again on request and lets the ones behind it follow", async () => {
    const first = await failFirst();
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "running", lastSequence: 1 })));
    await useAcpSessionsStore.getState().retryQueued("p", "s", first);
    expect(mocks.acpPrompt).toHaveBeenLastCalledWith("p", "s", input("first"));
    expect(useAcpSessionsStore.getState().errors.p).toBeNull();
    expect(useAcpSessionsStore.getState().queues.s.map((item) => item.text)).toEqual(["second"]);
  });

  it("stays queued when the conversation cannot take it yet", async () => {
    const first = await failFirst();
    reset([session("s", { status: "running" })]);
    useAcpSessionsStore.setState({ queues: { s: [{ ...draft("first"), id: first, failed: true }] } });
    await useAcpSessionsStore.getState().retryQueued("p", "s", first);
    expect(mocks.acpPrompt).toHaveBeenCalledTimes(1);
    expect(useAcpSessionsStore.getState().queues.s[0]).toMatchObject({ id: first, failed: false });
  });

  it("sends a steered message as a turn of its own when the turn already ended", async () => {
    reset([session("s", { status: "running", capabilities: { ...session("s").capabilities, steering: true } })]);
    mocks.acpSteer.mockResolvedValue("promptRequired");
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s", { status: "ready" })));
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "running", lastSequence: 1 })));
    const store = useAcpSessionsStore.getState();
    const id = store.enqueue("s", draft("Also check the figures"));
    await store.steerQueued("p", "s", id);
    expect(mocks.acpPrompt).toHaveBeenCalledWith("p", "s", input("Also check the figures"));
    expect(useAcpSessionsStore.getState().queues.s).toEqual([]);
  });
});

describe("conversations that are left or deleted", () => {
  it("marks the queue of a signed-out conversation as not sent when another one opens", () => {
    reset([session("s", { status: "auth_required" }), session("other")]);
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("waiting"));
    store.setActive("p", "other");
    expect(useAcpSessionsStore.getState().queues.s[0]).toMatchObject({ text: "waiting", failed: true });
  });

  it("leaves the queue of a conversation that is still working", () => {
    reset([session("s", { status: "running" }), session("other")]);
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("waiting"));
    store.setActive("p", "other");
    expect(useAcpSessionsStore.getState().queues.s[0].failed).toBeUndefined();
  });

  it("drops everything it holds for a deleted conversation", async () => {
    const { useComposerDrafts } = await import("./composer-drafts");
    const { acpComposerId } = await import("./acp-sessions");
    reset([session("s"), session("other")]);
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("waiting"));
    store.ingest([event(1, "permission", { id: "perm", expiresAt: Date.now() + 60_000 })]);
    useAcpSessionsStore.setState({ sending: { s: 1 }, watched: { s: 1 } });
    useComposerDrafts.getState().setText(acpComposerId("p", "agent", "s"), "half written");
    store.forgetSession("p", "s");
    const state = useAcpSessionsStore.getState();
    expect(state.sessions.s).toBeUndefined();
    expect(state.events.s).toBeUndefined();
    expect(state.queues.s).toBeUndefined();
    expect(state.permissions.s).toBeUndefined();
    expect(state.sending.s).toBeUndefined();
    expect(state.watched.s).toBeUndefined();
    expect(state.activeByProject.p).toBeNull();
    expect(state.sessions.other).toBeDefined();
    expect(useComposerDrafts.getState().drafts[acpComposerId("p", "agent", "s")]).toBeUndefined();
  });

  it("keeps queued files out of an attachment collection", async () => {
    const { draftAttachmentRefs } = await import("./composer-drafts");
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("with file", {
      attachments: [{
        id: "a", name: "a.pdf", mime: "application/pdf", size: 1, status: "ready", kind: "pdf", scope: "p",
        sha256: "queued-file", pageImages: [{ sha256: "queued-page", mime: "image/png" }],
      }],
    }));
    expect(draftAttachmentRefs("p").sort()).toEqual(["queued-file", "queued-page"]);
  });
});

describe("registering the listeners", () => {
  it("lets go of the ones already registered when a later one fails", async () => {
    const stopEvent = vi.fn();
    mocks.onAcpEvent.mockResolvedValueOnce(stopEvent);
    mocks.onAcpResync.mockRejectedValueOnce(new Error("no event bus"));
    await expect(attachAcpListeners()).rejects.toThrow("no event bus");
    expect(stopEvent).toHaveBeenCalledOnce();

    const stopAgain = vi.fn();
    mocks.onAcpEvent.mockResolvedValueOnce(stopAgain);
    mocks.onAcpResync.mockResolvedValueOnce(() => {});
    mocks.onAcpSession.mockResolvedValueOnce(() => {});
    mocks.onAcpBufferRequest.mockResolvedValueOnce(() => {});
    const detach = await attachAcpListeners();
    expect(mocks.onAcpEvent).toHaveBeenCalledTimes(2);
    detach();
    expect(stopAgain).toHaveBeenCalledOnce();
  });

  it("lets go of every earlier one when the last one fails", async () => {
    const stops = [vi.fn(), vi.fn(), vi.fn()];
    mocks.onAcpEvent.mockResolvedValueOnce(stops[0]);
    mocks.onAcpResync.mockResolvedValueOnce(stops[1]);
    mocks.onAcpSession.mockResolvedValueOnce(stops[2]);
    mocks.onAcpBufferRequest.mockRejectedValueOnce(new Error("no buffer bridge"));
    await expect(attachAcpListeners()).rejects.toThrow("no buffer bridge");
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
  });
});

describe("queued messages that would otherwise wait for nothing", () => {
  it("sends a queued message when the one before it never reached the agent", async () => {
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s")));
    mocks.toPromptInput.mockRejectedValueOnce(new AcpPromptError("tooLarge"));
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "ready", lastSequence: 2 })));
    const store = useAcpSessionsStore.getState();
    const first = store.sendPrompt("p", "s", draft("with a large image"));
    store.enqueue("s", draft("follow-up"));
    await expect(first).resolves.toBe(false);
    await vi.waitFor(() => expect(mocks.acpPrompt).toHaveBeenCalledWith("p", "s", input("follow-up")));
    await vi.waitFor(() => expect(useAcpSessionsStore.getState().queues.s).toEqual([]));
  });

  it("sends the next queued message when the turn ended before the prompt call returned", async () => {
    // The turn_complete batch was applied while the first message was still on its way.
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "ready", lastSequence: 3 })));
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("first"));
    store.enqueue("s", draft("second"));
    await store.dispatchQueued("p", "s");
    await vi.waitFor(() => expect(mocks.acpPrompt).toHaveBeenCalledTimes(2));
    expect(mocks.acpPrompt).toHaveBeenLastCalledWith("p", "s", input("second"));
    await vi.waitFor(() => expect(useAcpSessionsStore.getState().queues.s).toEqual([]));
  });

  it("counts a message the agent got as sent when its turn fails in a hidden conversation", async () => {
    reset([session("s"), session("other")], "other");
    mocks.acpPrompt.mockRejectedValue({ delivered: true, message: "The agent stopped answering." });
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s", { status: "ready", lastSequence: 4 })));
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("now write the conclusion"));
    await store.dispatchQueued("p", "s");
    const state = useAcpSessionsStore.getState();
    // Not offered again: sending it twice would give the agent the same message twice.
    expect(state.queues.s).toEqual([]);
    expect(state.sessionErrors.s).toBe("The agent stopped answering.");
    // The conversation on show does not get the other one's error.
    expect(state.errors.p).toBeUndefined();
  });

  it("marks a message the backend did not deliver as not sent", async () => {
    mocks.acpPrompt.mockRejectedValue("The agent is not connected.");
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s")));
    const store = useAcpSessionsStore.getState();
    store.enqueue("s", draft("hello"));
    await store.dispatchQueued("p", "s");
    expect(useAcpSessionsStore.getState().queues.s[0]).toMatchObject({ text: "hello", failed: true });
    expect(useAcpSessionsStore.getState().sessionErrors.s).toBe("The agent is not connected.");
  });

  it("sends a queued message with the mentions read when it was queued while another project is open", async () => {
    mocks.files = { projectId: "elsewhere", tree: [{ path: "notes.tex", name: "notes.tex", is_dir: false }] };
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "running", lastSequence: 1 })));
    const store = useAcpSessionsStore.getState();
    const queued = draft("@chapters/results.tex tighten this", { mentions: ["chapters/results.tex"] });
    store.enqueue("s", queued);
    await store.dispatchQueued("p", "s");
    expect(mocks.toPromptInput).toHaveBeenCalledWith(queued, expect.objectContaining({ id: "s" }), null);
  });

  it("does not send a steered message again when the turn ends during the steer", async () => {
    reset([session("s", { status: "running", capabilities: { ...session("s").capabilities, steering: true } })]);
    let answer: (value: "injected" | "promptRequired") => void = () => {};
    mocks.acpSteer.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const store = useAcpSessionsStore.getState();
    const id = store.enqueue("s", draft("Also check the figures"));
    const steering = store.steerQueued("p", "s", id);
    // The turn ends while the agent decides.
    useAcpSessionsStore.setState((state) => ({ sessions: { ...state.sessions, s: { ...state.sessions.s, status: "ready" } } }));
    await store.dispatchQueued("p", "s");
    expect(mocks.acpPrompt).not.toHaveBeenCalled();
    answer("injected");
    await steering;
    expect(mocks.acpPrompt).not.toHaveBeenCalled();
    expect(useAcpSessionsStore.getState().queues.s).toEqual([]);
  });

  it("lets a message go as a turn of its own after steering it failed", async () => {
    reset([session("s", { status: "running", capabilities: { ...session("s").capabilities, steering: true } })]);
    mocks.acpSteer.mockRejectedValueOnce("Steering is not available now.");
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "running", lastSequence: 1 })));
    const store = useAcpSessionsStore.getState();
    const id = store.enqueue("s", draft("Also check the figures"));
    await store.steerQueued("p", "s", id);
    // Not left marked as on its way, which would hold it back for good.
    expect(useAcpSessionsStore.getState().queues.s[0]).toMatchObject({ id, sending: false });
    useAcpSessionsStore.setState((state) => ({ sessions: { ...state.sessions, s: { ...state.sessions.s, status: "ready" } } }));
    await store.dispatchQueued("p", "s");
    expect(mocks.acpPrompt).toHaveBeenCalledWith("p", "s", input("Also check the figures"));
  });
});

describe("listening while nothing shows the agents", () => {
  function listen() {
    const emitted: { event: (value: AcpEvent) => void; summary: (value: unknown) => void } = {
      event: () => {},
      summary: () => {},
    };
    const stopEvent = vi.fn();
    mocks.onAcpEvent.mockImplementation(async (listener: (value: AcpEvent) => void) => { emitted.event = listener; return stopEvent; });
    mocks.onAcpResync.mockResolvedValue(() => {});
    mocks.onAcpSession.mockImplementation(async (listener: (value: unknown) => void) => { emitted.summary = listener; return () => {}; });
    mocks.onAcpBufferRequest.mockResolvedValue(() => {});
    return { emitted, stopEvent };
  }

  it("keeps listening after the assistant closes until the queued messages have gone", async () => {
    vi.useFakeTimers();
    reset([session("s", { status: "running" })]);
    const { emitted, stopEvent } = listen();
    mocks.acpSnapshot.mockResolvedValue(snapshot(session("s", { status: "ready", lastSequence: 1 })));
    mocks.acpPrompt.mockResolvedValue(snapshot(session("s", { status: "ready", lastSequence: 3 })));
    const detach = await attachAcpListeners();
    useAcpSessionsStore.getState().enqueue("s", draft("now write the conclusion"));
    detach();
    expect(stopEvent).not.toHaveBeenCalled();
    emitted.event(event(1, "turn_complete", { stopReason: "end_turn" }));
    await vi.advanceTimersByTimeAsync(40);
    await vi.waitFor(() => expect(mocks.acpPrompt).toHaveBeenCalledWith("p", "s", input("now write the conclusion")));
    await vi.waitFor(() => expect(stopEvent).toHaveBeenCalledOnce());
  });

  it("applies the events still waiting when the listeners stop", async () => {
    vi.useFakeTimers();
    const { emitted } = listen();
    const detach = await attachAcpListeners();
    emitted.event(event(1, "session_info", { title: "Results section" }));
    detach();
    expect(useAcpSessionsStore.getState().sessions.s.title).toBe("Results section");
  });

  it("applies an event waiting in the batch before the summary sent with it", async () => {
    vi.useFakeTimers();
    reset([session("s", { lastSequence: 1 })]);
    const { emitted } = listen();
    const detach = await attachAcpListeners();
    emitted.event(event(2, "controls", { controls: { modeId: "default" } }));
    emitted.summary({ projectId: "p", sessionId: "s", agentId: "agent", title: "s", status: "ready", updatedAt: 5, lastSequence: 2 });
    const value = useAcpSessionsStore.getState().sessions.s;
    // Only the event carries the mode the agent switched to.
    expect(value.controls.modeId).toBe("default");
    expect(value.lastSequence).toBe(2);
    detach();
  });
});

describe("leaving a project", () => {
  it("disconnects the project's idle conversations and leaves busy, delegated and queued ones", async () => {
    reset([
      session("idle"),
      session("signin", { status: "auth_required" }),
      session("busy", { status: "running" }),
      session("task", { taskId: "t1" }),
      session("child", { parentSessionId: "busy" }),
      session("queued"),
      session("elsewhere", { projectId: "q" }),
    ]);
    useAcpSessionsStore.getState().enqueue("queued", draft("waiting"));
    mocks.acpDisconnect.mockResolvedValueOnce(undefined).mockRejectedValueOnce("This conversation belongs to another window.");
    await useAcpSessionsStore.getState().releaseProject("p");
    expect(mocks.acpDisconnect.mock.calls.map(([project, id]) => `${project}/${id}`).sort()).toEqual(["p/idle", "p/signin"]);
  });
});
