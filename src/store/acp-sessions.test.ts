import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
const { dom, originalGlobals } = await vi.hoisted(async () => {
  vi.resetModules();
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
  const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node, MutationObserver: dom.window.MutationObserver, FileReader: dom.window.FileReader, getComputedStyle: dom.window.getComputedStyle.bind(dom.window) };
  for (const [key, value] of Object.entries(globals)) {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  Object.defineProperties(dom.window.HTMLElement.prototype, { attachEvent: { configurable: true, value: () => {} }, detachEvent: { configurable: true, value: () => {} } });
  return { dom, originalGlobals };
});
vi.mock("@/lib/acp", () => ({ acpCatalog: vi.fn(), acpEvents: vi.fn(), acpSessions: vi.fn(), acpSnapshot: vi.fn(), onAcpEvent: vi.fn(), onAcpResync: vi.fn(), acpDisconnect: vi.fn(), acpSetModel: vi.fn(), acpPrompt: vi.fn(), acpError: (error: unknown) => String(error) }));
vi.mock("@/components/ai/MessageList", () => ({ MessageList: () => null }));
vi.mock("@/components/settings/ai/AcpAgentsTab", () => ({ AcpAgentsTab: () => null }));
vi.mock("@/components/ai/use-research-chat-actions", () => ({ useResearchChatActions: () => ({}) }));
import { mergeAcpEvents, useAcpSessionsStore } from "./acp-sessions";
import { acpCatalog, acpDisconnect, acpEvents, acpPrompt, acpSessions, acpSetModel, acpSnapshot, onAcpEvent, onAcpResync, type AcpEvent, type AcpSession } from "@/lib/acp";
import { AcpWorkspaceAssistant } from "@/components/ai/acp/AcpWorkspaceAssistant";
const event = (sequence: number, kind = "agent_message_chunk", data = {}): AcpEvent => ({ sessionId: "s", projectId: "p", agentId: "a", modelId: null, taskId: null, turnId: "turn", sequence, timestamp: sequence, kind, data });

describe("ACP session event recovery", () => {
  beforeEach(() => useAcpSessionsStore.setState({ sessions: {}, events: {}, permissions: {}, activeByProject: {} }));
  it("deduplicates replay and sorts out-of-order event delivery", () => {
    const first = event(1);
    const merged = mergeAcpEvents([first, event(3)], [event(2), event(1)]);
    expect(merged.map((value) => value.sequence)).toEqual([1, 2, 3]);
    expect(merged[0]).toBe(first);
  });
  it("rejects a stale snapshot after newer native output", () => {
    useAcpSessionsStore.setState({ sessions: { s: { id: "s", lastSequence: 20, status: "running" } as AcpSession } });
    useAcpSessionsStore.getState().setSnapshot({ session: { id: "s", lastSequence: 10, status: "ready" } as AcpSession, permissions: [] });
    expect(useAcpSessionsStore.getState().sessions.s.status).toBe("running");
  });
  it("does not resurrect expired permission UI during catchup", () => {
    useAcpSessionsStore.getState().ingest([event(1, "permission", { id: "expired", expiresAt: Date.now() - 1 })]);
    expect(useAcpSessionsStore.getState().permissions.s ?? []).toEqual([]);
  });
  it("clears pending permissions on disconnection", () => {
    useAcpSessionsStore.getState().ingest([event(1, "permission", { id: "permission", expiresAt: Date.now() + 10000 }), event(2, "status", { status: "disconnected" })]);
    expect(useAcpSessionsStore.getState().permissions.s).toEqual([]);
  });
});


function typeMessage(input: HTMLTextAreaElement, value: string) {
  fireEvent.focusIn(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "a" });
}

function savedSession(id: string, status: AcpSession["status"] = "ready"): AcpSession {
  return {
    id, projectId: "p", projectPath: "/project", agentId: "fixture", agentVersion: null,
    nativeSessionId: id, parentSessionId: null, taskId: null, title: id, status,
    createdAt: 1, updatedAt: 1, turnId: null, lastSequence: 0, error: null, authMethods: [],
    capabilities: { loadSession: true, resume: false, image: false, audio: false, embeddedContext: false, additionalDirectories: false, mcpHttp: true },
    controls: { modelId: "first-model", modelConfigId: null, models: [{ modelId: "first-model", name: "First model" }, { modelId: "second-model", name: "Second model" }] },
  };
}

describe("ACP controlled conversation selectors", () => {
  afterEach(cleanup);
  afterAll(() => {
    cleanup();
    dom.window.close();
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    const first = savedSession("first");
    const second = savedSession("second", "disconnected");
    useAcpSessionsStore.setState({ catalog: [], sessions: { first, second }, events: {}, permissions: {}, activeByProject: { p: "first" } });
    vi.mocked(acpCatalog).mockResolvedValue([]);
    vi.mocked(acpSessions).mockResolvedValue([first, second]);
    vi.mocked(acpSnapshot).mockImplementation(async (_project, id) => ({ session: id === "first" ? first : second, permissions: [] }));
    vi.mocked(acpEvents).mockResolvedValue({ events: [], hasMore: false });
    vi.mocked(onAcpEvent).mockResolvedValue(() => {});
    vi.mocked(onAcpResync).mockResolvedValue(() => {});
  });

  it("opens the chosen saved conversation after its controlled select resets during disconnect", async () => {
    let finishDisconnect: (() => void) | undefined;
    vi.mocked(acpDisconnect).mockImplementation(() => new Promise<void>((resolve) => { finishDisconnect = resolve; }));
    const ui = render(createElement(AcpWorkspaceAssistant, { projectId: "p" }));
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("p", "first", 0));
    vi.mocked(acpSnapshot).mockClear();
    const select = ui.getByLabelText("Saved conversations") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "second" } });
    expect(acpDisconnect).toHaveBeenCalledWith("p", "first");
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("first");
    expect(acpSnapshot).not.toHaveBeenCalled();
    await act(async () => { finishDisconnect?.(); });
    await waitFor(() => expect(acpSnapshot).toHaveBeenCalledWith("p", "second"));
    expect(useAcpSessionsStore.getState().activeByProject.p).toBe("second");
    expect(select.value).toBe("second");
  });

  it("keeps the chosen model while its update is pending", async () => {
    let finishModel: (() => void) | undefined;
    vi.mocked(acpSetModel).mockImplementation((_project, _id, modelId) => new Promise((resolve) => {
      finishModel = () => { const session = savedSession("first"); session.controls.modelId = modelId; resolve({ session, permissions: [] }); };
    }));
    const ui = render(createElement(AcpWorkspaceAssistant, { projectId: "p" }));
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("p", "first", 0));
    const select = ui.getByLabelText("Agent model") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "second-model" } });
    expect(acpSetModel).toHaveBeenCalledWith("p", "first", "second-model");
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("first-model");
    await act(async () => { finishModel?.(); });
    await waitFor(() => expect(select.value).toBe("second-model"));
  });

  it("keeps unsent text and images when native validation rejects the prompt", async () => {
    const session = savedSession("first");
    session.capabilities.image = true;
    vi.mocked(acpSessions).mockResolvedValue([session]);
    vi.mocked(acpSnapshot).mockResolvedValue({ session, permissions: [] });
    vi.mocked(acpPrompt).mockRejectedValue("The image data is invalid.");
    const ui = render(createElement(AcpWorkspaceAssistant, { projectId: "p" }));
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("p", "first", 0));
    const message = ui.getByLabelText("Message CLI agent") as HTMLTextAreaElement;
    typeMessage(message, "Keep this unsent question");
    const input = ui.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("The image picker is missing.");
    fireEvent.change(input, { target: { files: [new dom.window.File(["image data"], "figure.png", { type: "image/png" })] } });
    await waitFor(() => expect(ui.getByRole("button", { name: "figure.png ×" })).toBeInTheDocument());
    const form = message.closest("form");
    if (!form) throw new Error("The message form is missing.");
    fireEvent.submit(form);
    await waitFor(() => expect(ui.getByRole("alert")).toHaveTextContent("The image data is invalid."));
    await waitFor(() => expect(acpEvents).toHaveBeenCalledTimes(2));
    expect(acpPrompt).toHaveBeenCalledWith("p", "first", "Keep this unsent question", [expect.objectContaining({ mimeType: "image/png" })]);
    expect(message.value).toBe("Keep this unsent question");
    expect(ui.getByRole("button", { name: "figure.png ×" })).toBeInTheDocument();
  });

  it("clears an accepted prompt after a later agent error instead of offering it again", async () => {
    vi.mocked(acpPrompt).mockImplementation(async () => {
      const accepted = { ...event(1, "user_message", { text: "Already sent" }), sessionId: "first" };
      vi.mocked(acpEvents).mockResolvedValue({ events: [accepted], hasMore: false });
      vi.mocked(acpSnapshot).mockResolvedValue({ session: { ...savedSession("first", "failed"), lastSequence: 1 }, permissions: [] });
      throw new Error("The agent disconnected.");
    });
    const ui = render(createElement(AcpWorkspaceAssistant, { projectId: "p" }));
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("p", "first", 0));
    const message = ui.getByLabelText("Message CLI agent") as HTMLTextAreaElement;
    typeMessage(message, "Already sent");
    const form = message.closest("form");
    if (!form) throw new Error("The message form is missing.");
    fireEvent.submit(form);
    await waitFor(() => expect(acpPrompt).toHaveBeenCalledWith("p", "first", "Already sent", []));
    await waitFor(() => expect(message.value).toBe(""));
    expect(useAcpSessionsStore.getState().events.first).toContainEqual(expect.objectContaining({ kind: "user_message" }));
  });

  it("rejects the combined image size before sending and keeps the composer intact", async () => {
    const session = savedSession("first");
    session.capabilities.image = true;
    vi.mocked(acpSessions).mockResolvedValue([session]);
    vi.mocked(acpSnapshot).mockResolvedValue({ session, permissions: [] });
    const ui = render(createElement(AcpWorkspaceAssistant, { projectId: "p" }));
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("p", "first", 0));
    const message = ui.getByLabelText("Message CLI agent") as HTMLTextAreaElement;
    typeMessage(message, "Compare these figures");
    const input = ui.container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("The image picker is missing.");
    for (const name of ["first.png", "second.png"]) {
      fireEvent.change(input, { target: { files: [new dom.window.File([new Uint8Array(470 * 1024)], name, { type: "image/png" })] } });
      await waitFor(() => expect(ui.getByRole("button", { name: `${name} ×` })).toBeInTheDocument());
    }
    const form = message.closest("form");
    if (!form) throw new Error("The message form is missing.");
    fireEvent.submit(form);
    expect(ui.getByRole("alert")).toHaveTextContent("This message and its images are too large.");
    expect(acpPrompt).not.toHaveBeenCalled();
    expect(message.value).toBe("Compare these figures");
    expect(ui.getByRole("button", { name: "first.png ×" })).toBeInTheDocument();
    expect(ui.getByRole("button", { name: "second.png ×" })).toBeInTheDocument();
  });

});
