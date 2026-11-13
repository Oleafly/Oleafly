import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpSession } from "@/lib/acp";

const mocks = vi.hoisted(() => ({
  acpDisconnect: vi.fn(),
  acpStart: vi.fn(),
  acpSnapshot: vi.fn(),
  acpEvents: vi.fn(),
  acpSessions: vi.fn(),
  acpSteer: vi.fn(),
  acpPrompt: vi.fn(),
}));

vi.mock("@/lib/acp", async (original) => ({
  ...(await original<typeof import("@/lib/acp")>()),
  ...mocks,
}));
vi.mock("@/lib/external-file-changes", () => ({
  refreshOpenFilesFromDisk: vi.fn(),
  flushOpenFilesToDisk: vi.fn(async () => {}),
}));
vi.mock("@/components/ai/acp/acp-attachments", () => ({
  toPromptInput: vi.fn(async (draft: { text: string }) => ({ text: draft.text, images: [], files: [], selections: [], skillId: null })),
  promptErrorMessage: vi.fn(() => null),
}));

import { draftAttachmentRefs, useComposerDrafts } from "./composer-drafts";
import { acpComposerId, acpSlot, acpSlotProject, useAcpSessionsStore } from "./acp-sessions";

const SLOT = acpSlot("paper", "note-note-1");

function session(id: string, status: AcpSession["status"] = "ready"): AcpSession {
  return {
    id,
    projectId: "paper",
    projectPath: "/paper",
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
    lastSequence: 0,
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
      steering: true,
    },
    controls: { modelId: null, modelConfigId: null, models: [] },
  } as AcpSession;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.acpEvents.mockResolvedValue({ events: [], hasMore: false });
  useAcpSessionsStore.setState({
    sessions: {},
    activeByProject: {},
    events: {},
    queues: {},
    sending: {},
    composers: {},
    errors: {},
    sessionErrors: {},
    starting: {},
  });
  useComposerDrafts.setState({ drafts: {} });
});

describe("ACP slots", () => {
  it("names a slot after its project and an owner, and reads the project back", () => {
    expect(SLOT).toBe("paper#note-note-1");
    expect(acpSlot("paper")).toBe("paper");
    expect(acpSlotProject(SLOT)).toBe("paper");
    expect(acpSlotProject("paper")).toBe("paper");
  });

  it("starts a note session in the project folder without replacing the workspace's session", async () => {
    useAcpSessionsStore.setState({ sessions: { work: session("work") }, activeByProject: { paper: "work" } });
    mocks.acpStart.mockResolvedValue({ session: session("note-session"), permissions: [] });
    await useAcpSessionsStore.getState().start(SLOT, "agent");
    expect(mocks.acpStart).toHaveBeenCalledWith("paper", "agent");
    expect(mocks.acpDisconnect).not.toHaveBeenCalled();
    expect(mocks.acpEvents).toHaveBeenCalledWith("paper", "note-session", 0);
    expect(useAcpSessionsStore.getState().activeByProject).toEqual({ paper: "work", [SLOT]: "note-session" });
    expect(useAcpSessionsStore.getState().starting[SLOT]).toBe(false);
  });

  it("opens, loads, pages and resyncs a slot through its project", async () => {
    mocks.acpSnapshot.mockResolvedValue({ session: session("s"), permissions: [] });
    mocks.acpSessions.mockResolvedValue([session("s")]);
    await useAcpSessionsStore.getState().open(SLOT, "s");
    await useAcpSessionsStore.getState().loadProject(SLOT);
    await useAcpSessionsStore.getState().resync(SLOT, "s");
    useAcpSessionsStore.setState({ events: { s: [{ sessionId: "s", projectId: "paper", agentId: "a", modelId: null, taskId: null, turnId: null, sequence: 400, timestamp: 1, kind: "x", data: {} }] } });
    await useAcpSessionsStore.getState().loadEarlier(SLOT, "s");
    expect(mocks.acpSnapshot).toHaveBeenCalledWith("paper", "s");
    expect(mocks.acpSessions).toHaveBeenCalledWith("paper");
    expect(mocks.acpEvents).toHaveBeenLastCalledWith("paper", "s", 99, 300);
    expect(useAcpSessionsStore.getState().activeByProject[SLOT]).toBe("s");
  });

  it("clears the error of every slot showing a session once a prompt lands", async () => {
    useAcpSessionsStore.setState({
      sessions: { s: session("s") },
      activeByProject: { [SLOT]: "s", paper: "other" },
      errors: { [SLOT]: "Failed", paper: "Kept" },
    });
    mocks.acpPrompt.mockResolvedValue({ session: session("s"), permissions: [] });
    const sent = await useAcpSessionsStore
      .getState()
      .sendPrompt(SLOT, "s", { text: "Hi", attachments: [], mentions: [], selections: [], skill: null });
    expect(sent).toBe(true);
    expect(mocks.acpPrompt).toHaveBeenCalledWith("paper", "s", expect.objectContaining({ text: "Hi" }));
    expect(useAcpSessionsStore.getState().errors).toEqual({ [SLOT]: null, paper: "Kept" });
  });

  it("forgets a session in whichever slot shows it", () => {
    useAcpSessionsStore.setState({
      sessions: { s: session("s") },
      activeByProject: { [SLOT]: "s", paper: "other" },
    });
    useAcpSessionsStore.getState().forgetSession("paper", "s");
    expect(useAcpSessionsStore.getState().activeByProject).toEqual({ [SLOT]: null, paper: "other" });
  });

  it("steers through the project", async () => {
    useAcpSessionsStore.setState({
      sessions: { s: session("s", "running") },
      queues: { s: [{ id: "q", text: "Also check run 3", attachments: [], mentions: [], selections: [], skill: null }] },
    });
    mocks.acpSteer.mockResolvedValue("injected");
    await useAcpSessionsStore.getState().steerQueued(SLOT, "s", "q");
    expect(mocks.acpSteer).toHaveBeenCalledWith("paper", "s", "Also check run 3");
  });

  it("releases only the slot's idle session when a note closes", async () => {
    useAcpSessionsStore.setState({
      sessions: { s: session("s"), busy: session("busy", "running"), work: session("work") },
      activeByProject: { [SLOT]: "s", "paper#note-note-2": "busy", paper: "work" },
    });
    mocks.acpDisconnect.mockResolvedValue(undefined);
    await useAcpSessionsStore.getState().releaseSlot(SLOT);
    await useAcpSessionsStore.getState().releaseSlot("paper#note-note-2");
    await useAcpSessionsStore.getState().releaseSlot("nobody");
    expect(mocks.acpDisconnect).toHaveBeenCalledTimes(1);
    expect(mocks.acpDisconnect).toHaveBeenCalledWith("paper", "s");
  });

  it("keeps a slot draft's attachments when its project collects garbage", () => {
    useComposerDrafts.getState().addAttachments(acpComposerId(SLOT, "agent"), [
      { id: "a", name: "plot.png", mime: "image/png", size: 1, status: "ready", kind: "image", scope: "paper", sha256: "sha-slot" },
    ]);
    useComposerDrafts.getState().addAttachments("paperx:acp:agent", [
      { id: "b", name: "x.png", mime: "image/png", size: 1, status: "ready", kind: "image", scope: "paperx", sha256: "sha-other" },
    ]);
    const refs = draftAttachmentRefs("paper");
    expect(refs).toContain("sha-slot");
    expect(refs).not.toContain("sha-other");
  });
});
