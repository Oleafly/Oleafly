import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initTestI18n } from "@/components/ai/acp/tests/ui-fixtures";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import * as acp from "./acp";
import type { AcpHermesSettings, AcpPreferences, AcpPromptInput, AcpRemoteHermes } from "./acp";

const catalogEvents = new EventTarget();
let catalogChanges = 0;
catalogEvents.addEventListener("oleafly:acp-catalog-changed", () => {
  catalogChanges += 1;
});

beforeAll(async () => {
  await initTestI18n();
  vi.stubGlobal("window", catalogEvents);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
  catalogChanges = 0;
});

const input: AcpPromptInput = {
  text: "hi",
  images: [],
  files: [{ kind: "project", path: "a.tex" }],
  selections: [],
  skillId: null,
};
const prefs: AcpPreferences = { experimentalV2: true, experimentalProviders: false, inactivityMinutes: 30 };
const remote: AcpRemoteHermes = { host: "lab", port: 22, folder: "/home/ada/paper", command: "hermes", profile: null };
const hermes: AcpHermesSettings = { mode: "remote", profile: null, memory: true, toolGateway: false, remote };

describe("CLI agent IPC", () => {
  it("returns the 200 newest conversations as a list, as 0.4.7 did", async () => {
    mocks.invoke.mockResolvedValueOnce({ sessions: [{ id: "a" }], hasMore: true });
    await expect(acp.acpSessions("p")).resolves.toEqual([{ id: "a" }]);
    expect(mocks.invoke).toHaveBeenCalledWith("acp_sessions", { projectId: "p", query: null, before: null, beforeId: null, limit: 200 });
  });

  it("pages conversations by search and time", async () => {
    await acp.acpSessionPage("p", { query: "chapter", before: 123, limit: 20 });
    expect(mocks.invoke).toHaveBeenLastCalledWith("acp_sessions", { projectId: "p", query: "chapter", before: 123, beforeId: null, limit: 20 });
    await acp.acpSessionPage("p", { before: 123, beforeId: "s9", limit: 20 });
    expect(mocks.invoke).toHaveBeenLastCalledWith("acp_sessions", { projectId: "p", query: null, before: 123, beforeId: "s9", limit: 20 });
    await acp.acpSessionPage("p");
    expect(mocks.invoke).toHaveBeenLastCalledWith("acp_sessions", { projectId: "p", query: null, before: null, beforeId: null, limit: null });
  });

  it("sends a prompt as one input object", async () => {
    await acp.acpPrompt("p", "s", input);
    expect(mocks.invoke).toHaveBeenCalledWith("acp_prompt", { projectId: "p", sessionId: "s", input });
  });

  it("sends a boolean option in its typed form", async () => {
    await acp.acpSetConfigOption("p", "s", "fast", { type: "boolean", value: true });
    const [command, args] = mocks.invoke.mock.calls[0];
    expect(command).toBe("acp_set_config_option");
    expect(args.value).toEqual({ type: "boolean", value: true });
  });

  it("passes an API key only as the apiKey argument", async () => {
    await acp.acpAuthenticate("p", "s", "api-key", "sk-test");
    const [command, { apiKey, ...otherArgs }] = mocks.invoke.mock.calls[0];
    expect(command).toBe("acp_authenticate");
    expect(apiKey).toBe("sk-test");
    expect(JSON.stringify(otherArgs)).not.toContain("sk-test");
    await acp.acpAuthenticate("p", "s", "browser");
    expect(mocks.invoke).toHaveBeenLastCalledWith("acp_authenticate", { projectId: "p", sessionId: "s", methodId: "browser", apiKey: null });
  });

  it("calls each command with the argument names the backend expects", async () => {
    const cases: [() => Promise<unknown>, string, Record<string, unknown> | undefined][] = [
      [() => acp.acpCatalog(), "acp_catalog", { probe: false }],
      [() => acp.acpCatalog(true), "acp_catalog", { probe: true }],
      [() => acp.acpRegistrySearch("claude"), "acp_registry_search", { query: "claude" }],
      [() => acp.acpStart("p", "claude"), "acp_start", { projectId: "p", agentId: "claude" }],
      [() => acp.acpReconnect("p", "s"), "acp_reconnect", { projectId: "p", sessionId: "s" }],
      [() => acp.acpCancel("p", "s"), "acp_cancel", { projectId: "p", sessionId: "s" }],
      [() => acp.acpDisconnect("p", "s"), "acp_disconnect", { projectId: "p", sessionId: "s" }],
      [() => acp.acpSetModel("p", "s", "opus"), "acp_set_model", { projectId: "p", sessionId: "s", modelId: "opus" }],
      [() => acp.acpPermission("p", "s", "perm", "allow"), "acp_permission", { projectId: "p", sessionId: "s", permissionId: "perm", optionId: "allow" }],
      [() => acp.acpDelegatedPermission("p", "child", "parent", "perm", null), "acp_delegated_permission",
        { projectId: "p", sessionId: "child", parentSessionId: "parent", permissionId: "perm", optionId: null }],
      [() => acp.acpSnapshot("p", "s"), "acp_snapshot", { projectId: "p", sessionId: "s" }],
      [() => acp.acpEvents("p", "s"), "acp_events", { projectId: "p", sessionId: "s", after: 0, limit: 300 }],
      [() => acp.acpEvents("p", "s", 10, 50), "acp_events", { projectId: "p", sessionId: "s", after: 10, limit: 50 }],
      [() => acp.acpCheckAgent("claude"), "acp_check_agent", { agentId: "claude", path: null }],
      [() => acp.acpCheckAgent("claude", "/bin/claude"), "acp_check_agent", { agentId: "claude", path: "/bin/claude" }],
      [() => acp.acpPickAgentProgram("claude"), "acp_pick_agent_program", { agentId: "claude" }],
      [() => acp.acpSessionExport("p", "s", "/tmp/c.json"), "acp_session_export", { projectId: "p", sessionId: "s", path: "/tmp/c.json" }],
      [() => acp.acpSessionEventsAll("p", "s"), "acp_session_events_all", { projectId: "p", sessionId: "s" }],
      [() => acp.acpSetMode("p", "s", "plan"), "acp_set_mode", { projectId: "p", sessionId: "s", modeId: "plan" }],
      [() => acp.acpSteer("p", "s", "Also fix the figures"), "acp_steer", { projectId: "p", sessionId: "s", text: "Also fix the figures" }],
      [() => acp.acpRefreshPlanUsage("p", "s"), "acp_refresh_plan_usage", { projectId: "p", sessionId: "s" }],
      [() => acp.acpSignInCommand(null, "claude", null, "terminal"), "acp_sign_in_command",
        { projectId: null, agentId: "claude", sessionId: null, methodId: "terminal" }],
      [() => acp.acpLogout("p", "s"), "acp_logout", { projectId: "p", sessionId: "s" }],
      [() => acp.acpElicitationRespond("p", "s", "e1", "decline"), "acp_elicitation_respond",
        { projectId: "p", sessionId: "s", elicitationId: "e1", action: "decline", content: null }],
      [() => acp.acpElicitationRespond("p", "s", "e1", "accept", { name: "x" }), "acp_elicitation_respond",
        { projectId: "p", sessionId: "s", elicitationId: "e1", action: "accept", content: { name: "x" } }],
      [() => acp.acpSessionRename("p", "s", "Intro"), "acp_session_rename", { projectId: "p", sessionId: "s", title: "Intro" }],
      [() => acp.acpSessionDelete("p", "s", true), "acp_session_delete", { projectId: "p", sessionId: "s", fromAgent: true }],
      [() => acp.acpAgentSessions("p", "codex"), "acp_agent_sessions", { projectId: "p", agentId: "codex", cursor: null }],
      [() => acp.acpAgentSessions("p", "codex", "next"), "acp_agent_sessions", { projectId: "p", agentId: "codex", cursor: "next" }],
      [() => acp.acpSessionImport("p", "codex", ["n1", "n2"]), "acp_session_import", { projectId: "p", agentId: "codex", nativeSessionIds: ["n1", "n2"] }],
      [() => acp.acpFork("p", "s"), "acp_fork", { projectId: "p", sessionId: "s" }],
      [() => acp.acpCommitTurn("p", "s", "turn-1", "Fix intro", ["main.tex"]), "acp_commit_turn",
        { projectId: "p", sessionId: "s", turnId: "turn-1", message: "Fix intro", paths: ["main.tex"] }],
      [() => acp.acpPreferences(), "acp_preferences", undefined],
      [() => acp.acpSetPreferences(prefs), "acp_set_preferences", { prefs }],
      [() => acp.acpAgentPreferences("claude"), "acp_agent_preferences", { agentId: "claude" }],
      [() => acp.acpSetAgentPreferences("claude", { effort: null, mode: null, provider: "openrouter" }), "acp_set_agent_preferences",
        { agentId: "claude", prefs: { effort: null, mode: null, provider: "openrouter" } }],
      [() => acp.acpProviderChoices("claude"), "acp_provider_choices", { agentId: "claude" }],
      [() => acp.acpHermesSettings("p"), "acp_hermes_settings", { projectId: "p" }],
      [() => acp.acpSetHermesSettings("p", hermes), "acp_set_hermes_settings", { projectId: "p", settings: hermes }],
      [() => acp.acpHermesStatus("p"), "acp_hermes_status", { projectId: "p" }],
      [() => acp.acpHermesSetOption("p", "memory", true), "acp_hermes_set_option", { projectId: "p", option: "memory", enabled: true }],
      [() => acp.acpTestRemoteHermes("p", remote), "acp_test_remote_hermes", { projectId: "p", remote }],
      [() => acp.acpBufferReply("req", null), "acp_buffer_reply", { requestId: "req", content: null }],
    ];
    for (const [call, command, args] of cases) {
      mocks.invoke.mockClear();
      await call();
      if (args === undefined) expect(mocks.invoke).toHaveBeenCalledWith(command);
      else expect(mocks.invoke).toHaveBeenCalledWith(command, args);
    }
    expect(catalogChanges).toBe(0);
  });

  it("tells the app the catalog changed after registering, removing, installing or choosing a program", async () => {
    await acp.acpRegister("{\"id\":\"x\"}");
    expect(mocks.invoke).toHaveBeenLastCalledWith("acp_register", { definitionJson: "{\"id\":\"x\"}" });
    await acp.acpRemoveAgent("x");
    expect(mocks.invoke).toHaveBeenLastCalledWith("acp_remove_agent", { agentId: "x" });
    await acp.acpInstall("x");
    expect(mocks.invoke).toHaveBeenLastCalledWith("acp_install", { agentId: "x" });
    await acp.acpSetAgentProgram("x", "/bin/x");
    expect(mocks.invoke).toHaveBeenLastCalledWith("acp_set_agent_program", { agentId: "x", path: "/bin/x" });
    expect(catalogChanges).toBe(4);
    mocks.invoke.mockRejectedValueOnce(new Error("install failed"));
    await expect(acp.acpInstall("x")).rejects.toThrow("install failed");
    expect(catalogChanges).toBe(4);
  });

  it("passes the payload of each event to its listener", async () => {
    const stop = vi.fn();
    mocks.listen.mockResolvedValue(stop);
    const received: unknown[] = [];
    await expect(acp.onAcpEvent((value) => received.push(value))).resolves.toBe(stop);
    await acp.onAcpSession((value) => received.push(value));
    await acp.onAcpBufferRequest((value) => received.push(value));
    const resync = vi.fn();
    await acp.onAcpResync(resync);
    expect(mocks.listen.mock.calls.map(([name]) => name)).toEqual(["acp:event", "acp:session", "acp:buffer-request", "acp:resync"]);
    for (const [, handler] of mocks.listen.mock.calls.slice(0, 3)) handler({ payload: { id: "payload" } });
    expect(received).toEqual([{ id: "payload" }, { id: "payload" }, { id: "payload" }]);
    expect(mocks.listen.mock.calls[3][1]).toBe(resync);
  });

  it("turns any failure into a message", () => {
    expect(acp.acpError("The agent stopped.")).toBe("The agent stopped.");
    expect(acp.acpError(new Error("Connection lost."))).toBe("Connection lost.");
    expect(acp.acpError({ code: 7 })).toMatch(/\S/);
  });
});
