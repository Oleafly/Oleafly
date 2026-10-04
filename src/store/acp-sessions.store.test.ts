import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpEvent, AcpSession } from "@/lib/acp";

const mocks = vi.hoisted(() => ({
  acpDisconnect: vi.fn(),
  acpStart: vi.fn(),
  acpSnapshot: vi.fn(),
  acpEvents: vi.fn(),
  onAcpEvent: vi.fn(),
  onAcpResync: vi.fn(),
  refreshOpenFilesFromDisk: vi.fn(),
}));

vi.mock("@/lib/acp", async (original) => ({
  ...(await original<typeof import("@/lib/acp")>()),
  acpDisconnect: mocks.acpDisconnect,
  acpStart: mocks.acpStart,
  acpSnapshot: mocks.acpSnapshot,
  acpEvents: mocks.acpEvents,
  onAcpEvent: mocks.onAcpEvent,
  onAcpResync: mocks.onAcpResync,
}));
vi.mock("@/lib/external-file-changes", () => ({
  refreshOpenFilesFromDisk: mocks.refreshOpenFilesFromDisk,
}));

import { attachAcpListeners, EMPTY_COMPOSER, useAcpSessionsStore } from "./acp-sessions";

function session(id: string, status: AcpSession["status"] = "ready", lastSequence = 0): AcpSession {
  return {
    id,
    projectId: "p",
    projectPath: "/project",
    agentId: "agent",
    agentVersion: null,
    nativeSessionId: id,
    parentSessionId: null,
    taskId: null,
    title: id,
    status,
    createdAt: 1,
    updatedAt: 1,
    turnId: null,
    lastSequence,
    error: null,
    authMethods: [],
    capabilities: {
      loadSession: true,
      resume: false,
      image: false,
      audio: false,
      embeddedContext: false,
      additionalDirectories: false,
      mcpHttp: true,
    },
    controls: { modelId: null, modelConfigId: null, models: [] },
  };
}

function event(sequence: number, kind = "agent_message_chunk", data: Record<string, unknown> = {}, sessionId = "s"): AcpEvent {
  return { sessionId, projectId: "p", agentId: "agent", modelId: null, taskId: null, turnId: "turn", sequence, timestamp: sequence, kind, data };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  useAcpSessionsStore.setState({
    catalog: [],
    sessions: {},
    activeByProject: {},
    events: {},
    permissions: {},
    composers: {},
    errors: {},
    starting: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ACP session actions", () => {
  it("records an error per project and skips an unchanged one", () => {
    useAcpSessionsStore.getState().setError("p", "Sign in first");
    const before = useAcpSessionsStore.getState();
    useAcpSessionsStore.getState().setError("p", "Sign in first");

    expect(useAcpSessionsStore.getState()).toBe(before);
    expect(before.errors).toEqual({ p: "Sign in first" });
  });

  it("disconnects an idle conversation before starting a new agent", async () => {
    useAcpSessionsStore.setState({ sessions: { old: session("old", "ready") }, activeByProject: { p: "old" } });
    mocks.acpDisconnect.mockResolvedValue(undefined);
    mocks.acpStart.mockImplementation(async () => {
      expect(useAcpSessionsStore.getState().starting.p).toBe(true);
      return { session: session("fresh"), permissions: [] };
    });

    await useAcpSessionsStore.getState().start("p", "agent");

    expect(mocks.acpDisconnect).toHaveBeenCalledWith("p", "old");
    expect(useAcpSessionsStore.getState()).toMatchObject({
      activeByProject: { p: "fresh" },
      starting: { p: false },
    });
    expect(useAcpSessionsStore.getState().sessions.fresh.status).toBe("ready");
  });

  it("leaves a running conversation connected when another agent starts", async () => {
    useAcpSessionsStore.setState({ sessions: { busy: session("busy", "running") }, activeByProject: { p: "busy" } });
    mocks.acpStart.mockResolvedValue({ session: session("fresh"), permissions: [] });

    await useAcpSessionsStore.getState().start("p", "agent");

    expect(mocks.acpDisconnect).not.toHaveBeenCalled();
  });

  it("clears the starting flag when a start fails", async () => {
    mocks.acpStart.mockRejectedValue(new Error("agent not installed"));

    await expect(useAcpSessionsStore.getState().start("p", "agent")).rejects.toThrow("agent not installed");

    expect(useAcpSessionsStore.getState().starting.p).toBe(false);
  });

  it("opens a conversation with its latest 300 events", async () => {
    mocks.acpSnapshot.mockResolvedValue({ session: session("s", "ready", 450), permissions: [] });
    mocks.acpEvents.mockResolvedValue({ events: [event(151), event(152)], hasMore: true });

    await useAcpSessionsStore.getState().open("p", "s");

    expect(mocks.acpEvents).toHaveBeenCalledWith("p", "s", 150);
    expect(useAcpSessionsStore.getState().activeByProject.p).toBe("s");
    expect(useAcpSessionsStore.getState().events.s.map((e) => e.sequence)).toEqual([151, 152]);
  });

  it("loads earlier events before the first one shown", async () => {
    useAcpSessionsStore.setState({ events: { s: [event(400), event(401)] } });
    mocks.acpEvents.mockResolvedValue({ events: [event(99), event(399), event(400)], hasMore: false });

    await useAcpSessionsStore.getState().loadEarlier("p", "s");

    expect(mocks.acpEvents).toHaveBeenCalledWith("p", "s", 99, 300);
    expect(useAcpSessionsStore.getState().events.s.map((e) => e.sequence)).toEqual([99, 399, 400, 401]);
  });

  it("has nothing earlier to load at the start of a conversation", async () => {
    useAcpSessionsStore.setState({ events: { s: [event(1)] } });

    await useAcpSessionsStore.getState().loadEarlier("p", "s");
    await useAcpSessionsStore.getState().loadEarlier("p", "empty");

    expect(mocks.acpEvents).not.toHaveBeenCalled();
  });

  it("catches up page by page after the last event it has", async () => {
    useAcpSessionsStore.setState({ sessions: { s: session("s", "running", 2) }, events: { s: [event(2)] } });
    mocks.acpSnapshot.mockResolvedValue({ session: session("s", "running", 2), permissions: [] });
    mocks.acpEvents
      .mockResolvedValueOnce({ events: [event(3), event(4)], hasMore: true })
      .mockResolvedValueOnce({ events: [], hasMore: true })
      .mockResolvedValueOnce({ events: [event(5, "turn_complete")], hasMore: false });

    await useAcpSessionsStore.getState().resync("p", "s");

    expect(mocks.acpEvents.mock.calls.map((call) => call[2])).toEqual([2, 4, 4]);
    expect(useAcpSessionsStore.getState().events.s.map((e) => e.sequence)).toEqual([2, 3, 4, 5]);
    expect(useAcpSessionsStore.getState().sessions.s.status).toBe("ready");
  });

  it("starts a resync from the recent window when no events are loaded", async () => {
    mocks.acpSnapshot.mockResolvedValue({ session: session("s", "ready", 500), permissions: [] });
    mocks.acpEvents.mockResolvedValue({ events: [], hasMore: false });

    await useAcpSessionsStore.getState().resync("p", "s");

    expect(mocks.acpEvents).toHaveBeenCalledWith("p", "s", 200);
  });

  it("keeps a composer's other fields when one is patched", () => {
    useAcpSessionsStore.getState().setComposer("p", { draft: "hello" });
    useAcpSessionsStore.getState().setComposer("p", { agentId: "agent" });

    expect(useAcpSessionsStore.getState().composers.p).toEqual({ ...EMPTY_COMPOSER, draft: "hello", agentId: "agent" });
  });
});

describe("ACP event ingestion", () => {
  beforeEach(() => {
    useAcpSessionsStore.setState({ sessions: { s: session("s", "ready", 0) } });
  });

  it("tracks the session status from user messages, status changes and turn ends", () => {
    useAcpSessionsStore.getState().ingest([event(1, "user_message")]);
    expect(useAcpSessionsStore.getState().sessions.s.status).toBe("running");

    useAcpSessionsStore.getState().ingest([event(2, "status", { status: "cancelling" })]);
    expect(useAcpSessionsStore.getState().sessions.s.status).toBe("cancelling");

    useAcpSessionsStore.getState().ingest([event(3, "status", { status: 7 })]);
    expect(useAcpSessionsStore.getState().sessions.s.status).toBe("cancelling");

    useAcpSessionsStore.getState().ingest([event(4, "turn_complete")]);
    expect(useAcpSessionsStore.getState().sessions.s).toMatchObject({ status: "ready", lastSequence: 4, turnId: "turn" });
  });

  it("adds a permission request once and removes it when resolved", () => {
    const permission = { id: "perm", sessionId: "s", turnId: "turn", title: "Edit", toolCallId: null, options: [], expiresAt: Date.now() + 60_000 };

    useAcpSessionsStore.getState().ingest([event(1, "permission", permission), event(2, "permission", permission)]);
    expect(useAcpSessionsStore.getState().permissions.s).toHaveLength(1);

    useAcpSessionsStore.getState().ingest([event(3, "permission_resolved", { id: "perm" })]);
    expect(useAcpSessionsStore.getState().permissions.s).toEqual([]);

    useAcpSessionsStore.getState().ingest([event(4, "permission_resolved", { id: "gone" }, "other")]);
    expect(useAcpSessionsStore.getState().permissions.other).toEqual([]);
  });

  it("keeps pending permissions while the agent is still working", () => {
    const permission = { id: "perm", sessionId: "s", turnId: "turn", title: "Edit", toolCallId: null, options: [], expiresAt: Date.now() + 60_000 };
    useAcpSessionsStore.getState().ingest([event(1, "permission", permission)]);

    useAcpSessionsStore.getState().ingest([event(2, "status", { status: "running" })]);

    expect(useAcpSessionsStore.getState().permissions.s).toHaveLength(1);
  });
});

describe("ACP live listeners", () => {
  it("batches live events, refreshes snapshots and reloads files a finished turn changed", async () => {
    vi.useFakeTimers();
    let deliver: (value: AcpEvent) => void = () => {};
    const stopEvent = vi.fn();
    const stopResync = vi.fn();
    mocks.onAcpEvent.mockImplementation(async (handler) => {
      deliver = handler;
      return stopEvent;
    });
    mocks.onAcpResync.mockResolvedValue(stopResync);
    mocks.acpSnapshot.mockResolvedValue({ session: session("s", "ready", 3), permissions: [] });
    useAcpSessionsStore.setState({ sessions: { s: session("s", "running", 0) } });

    const detach = await attachAcpListeners();
    const detachSecond = await attachAcpListeners();
    expect(mocks.onAcpEvent).toHaveBeenCalledTimes(1);

    deliver(event(1));
    deliver(event(2, "tool_call_update", { status: "completed" }));
    deliver(event(3, "turn_complete"));
    expect(useAcpSessionsStore.getState().events.s).toBeUndefined();

    await vi.advanceTimersByTimeAsync(32);

    expect(useAcpSessionsStore.getState().events.s.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(mocks.acpSnapshot).toHaveBeenCalledWith("p", "s");
    expect(mocks.refreshOpenFilesFromDisk).toHaveBeenCalledTimes(1);
    expect(mocks.refreshOpenFilesFromDisk).toHaveBeenCalledWith("p");

    detach();
    expect(stopEvent).not.toHaveBeenCalled();
    detachSecond();
    expect(stopEvent).toHaveBeenCalledTimes(1);
    expect(stopResync).toHaveBeenCalledTimes(1);
  });

  it("drops queued events when the last listener detaches", async () => {
    vi.useFakeTimers();
    let deliver: (value: AcpEvent) => void = () => {};
    mocks.onAcpEvent.mockImplementation(async (handler) => {
      deliver = handler;
      return () => {};
    });
    mocks.onAcpResync.mockResolvedValue(() => {});

    const detach = await attachAcpListeners();
    deliver(event(1));
    detach();
    await vi.advanceTimersByTimeAsync(32);

    expect(useAcpSessionsStore.getState().events.s).toBeUndefined();
  });

  it("resyncs every open conversation when the backend asks", async () => {
    let resync: () => void = () => {};
    mocks.onAcpEvent.mockResolvedValue(() => {});
    mocks.onAcpResync.mockImplementation(async (handler) => {
      resync = handler;
      return () => {};
    });
    mocks.acpSnapshot.mockResolvedValue({ session: session("s", "ready", 0), permissions: [] });
    mocks.acpEvents.mockResolvedValue({ events: [], hasMore: false });
    useAcpSessionsStore.setState({ activeByProject: { p: "s", q: null } });

    const detach = await attachAcpListeners();
    resync();
    await vi.waitFor(() => expect(mocks.acpEvents).toHaveBeenCalled());

    expect(mocks.acpSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.acpSnapshot).toHaveBeenCalledWith("p", "s");
    detach();
  });

  it("lets a later attach retry after the listeners failed to register", async () => {
    mocks.onAcpEvent.mockRejectedValueOnce(new Error("no event bus"));

    await expect(attachAcpListeners()).rejects.toThrow("no event bus");

    mocks.onAcpEvent.mockResolvedValue(() => {});
    mocks.onAcpResync.mockResolvedValue(() => {});
    const detach = await attachAcpListeners();
    expect(mocks.onAcpEvent).toHaveBeenCalledTimes(2);
    detach();
  });
});
