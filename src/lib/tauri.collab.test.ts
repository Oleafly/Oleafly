import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CollabMemberPatch,
  CollabNewAllowlistEntry,
  CollabNewDomainRule,
  CollabRuntimeSettingsPatch,
} from "./tauri";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import * as tauri from "./tauri-collab";

const SERVER = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f60";
const ACCOUNT = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f61";
const DEVICE = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f62";
const patch: CollabMemberPatch = { role: "maintainer", status: null };
const entry: CollabNewAllowlistEntry = { matcher: { kind: "email", email: "alice@uni.edu" }, role: "member" };
const rule: CollabNewDomainRule = { domain: "cs.uni.edu", role: "member" };
const settings: CollabRuntimeSettingsPatch = { guests_enabled: true };

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.listen.mockReset().mockResolvedValue(mocks.unlisten);
});

describe("collaboration IPC contract", () => {
  it.each([
    ["collabServersList", () => tauri.collabServersList(), "collab_servers_list", undefined],
    ["collabServerProbe", () => tauri.collabServerProbe("https://uni.edu/oleafly"), "collab_server_probe", { url: "https://uni.edu/oleafly" }],
    [
      "collabServerSignIn without a setup code",
      () => tauri.collabServerSignIn("https://uni.edu", "github"),
      "collab_server_sign_in",
      { url: "https://uni.edu", providerId: "github", setupCode: null },
    ],
    [
      "collabServerSignIn with a setup code",
      () => tauri.collabServerSignIn("https://uni.edu", "github", "K7QX-2MPL"),
      "collab_server_sign_in",
      { url: "https://uni.edu", providerId: "github", setupCode: "K7QX-2MPL" },
    ],
    ["collabServerSignInCancel", () => tauri.collabServerSignInCancel(), "collab_server_sign_in_cancel", undefined],
    [
      "collabServerSignOut",
      () => tauri.collabServerSignOut(SERVER),
      "collab_server_sign_out",
      { serverId: SERVER, keepLocalCopy: false },
    ],
    [
      "collabServerSignOut keeping local copies",
      () => tauri.collabServerSignOut(SERVER, true),
      "collab_server_sign_out",
      { serverId: SERVER, keepLocalCopy: true },
    ],
    [
      "collabServerRemove",
      () => tauri.collabServerRemove(SERVER),
      "collab_server_remove",
      { serverId: SERVER, keepLocalCopy: false },
    ],
    ["collabServerDevices", () => tauri.collabServerDevices(SERVER), "collab_server_devices", { serverId: SERVER }],
    [
      "collabServerSignOutDevice",
      () => tauri.collabServerSignOutDevice(SERVER, DEVICE),
      "collab_server_sign_out_device",
      { serverId: SERVER, deviceId: DEVICE },
    ],
    ["collabServerTest", () => tauri.collabServerTest("https://uni.edu"), "collab_server_test", { url: "https://uni.edu" }],
    ["collabServerRefresh", () => tauri.collabServerRefresh(SERVER), "collab_server_refresh", { serverId: SERVER }],
    ["collabAdminMembers", () => tauri.collabAdminMembers(SERVER), "collab_admin_members", { serverId: SERVER }],
    [
      "collabAdminMemberDevices",
      () => tauri.collabAdminMemberDevices(SERVER, ACCOUNT),
      "collab_admin_member_devices",
      { serverId: SERVER, accountId: ACCOUNT },
    ],
    [
      "collabAdminPatchMember",
      () => tauri.collabAdminPatchMember(SERVER, ACCOUNT, patch),
      "collab_admin_patch_member",
      { serverId: SERVER, accountId: ACCOUNT, patch },
    ],
    [
      "collabAdminRemoveMember",
      () => tauri.collabAdminRemoveMember(SERVER, ACCOUNT),
      "collab_admin_remove_member",
      { serverId: SERVER, accountId: ACCOUNT },
    ],
    [
      "collabAdminSignOutDevice",
      () => tauri.collabAdminSignOutDevice(SERVER, DEVICE),
      "collab_admin_sign_out_device",
      { serverId: SERVER, deviceId: DEVICE },
    ],
    ["collabAdminAllowlist", () => tauri.collabAdminAllowlist(SERVER), "collab_admin_allowlist", { serverId: SERVER }],
    [
      "collabAdminAddAllowlist",
      () => tauri.collabAdminAddAllowlist(SERVER, entry),
      "collab_admin_add_allowlist",
      { serverId: SERVER, entry },
    ],
    [
      "collabAdminRemoveAllowlist",
      () => tauri.collabAdminRemoveAllowlist(SERVER, "entry-1"),
      "collab_admin_remove_allowlist",
      { serverId: SERVER, entryId: "entry-1" },
    ],
    ["collabAdminDomainRules", () => tauri.collabAdminDomainRules(SERVER), "collab_admin_domain_rules", { serverId: SERVER }],
    [
      "collabAdminAddDomainRule",
      () => tauri.collabAdminAddDomainRule(SERVER, rule),
      "collab_admin_add_domain_rule",
      { serverId: SERVER, rule },
    ],
    [
      "collabAdminRemoveDomainRule",
      () => tauri.collabAdminRemoveDomainRule(SERVER, "rule-1"),
      "collab_admin_remove_domain_rule",
      { serverId: SERVER, ruleId: "rule-1" },
    ],
    ["collabAdminSettings", () => tauri.collabAdminSettings(SERVER), "collab_admin_settings", { serverId: SERVER }],
    [
      "collabAdminPatchSettings",
      () => tauri.collabAdminPatchSettings(SERVER, settings),
      "collab_admin_patch_settings",
      { serverId: SERVER, patch: settings },
    ],
    [
      "collabAdminSecurityLog from the start",
      () => tauri.collabAdminSecurityLog(SERVER),
      "collab_admin_security_log",
      { serverId: SERVER, cursor: null },
    ],
    [
      "collabAdminSecurityLog from a cursor",
      () => tauri.collabAdminSecurityLog(SERVER, "c2"),
      "collab_admin_security_log",
      { serverId: SERVER, cursor: "c2" },
    ],
    [
      "collabLinkPreview",
      () => tauri.collabLinkPreview(SERVER, ACCOUNT),
      "collab_link_preview",
      { serverId: SERVER, sharedProjectId: ACCOUNT },
    ],
    [
      "collabJoinProject",
      () => tauri.collabJoinProject(SERVER, ACCOUNT),
      "collab_join_project",
      { serverId: SERVER, sharedProjectId: ACCOUNT },
    ],
    [
      "collabJoinCancel",
      () => tauri.collabJoinCancel(SERVER, ACCOUNT),
      "collab_join_cancel",
      { serverId: SERVER, sharedProjectId: ACCOUNT },
    ],
  ] as const)("sends %s", async (_label, call, command, args) => {
    await call();
    if (args === undefined) expect(mocks.invoke).toHaveBeenCalledWith(command);
    else expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });
});

describe("collaboration IPC helpers", () => {
  it("recognises the structured command error", () => {
    expect(tauri.isCollabCommandError({ code: "not_admitted", message: "" })).toBe(true);
    expect(tauri.isCollabCommandError({ code: "server_changed", message: "a b" })).toBe(true);
    for (const code of ["invalid", "project_full", "not_a_link", "signed_out", "server_removed", "turned_off"]) {
      expect(tauri.isCollabCommandError({ code, message: "" }), code).toBe(true);
    }
    expect(tauri.isCollabCommandError({ code: "teapot", message: "" })).toBe(false);
    expect(tauri.isCollabCommandError({ code: "server" })).toBe(false);
    expect(tauri.isCollabCommandError("unreachable")).toBe(false);
    expect(tauri.isCollabCommandError(null)).toBe(false);
  });

  it("forwards join progress with the server and project it belongs to", async () => {
    const seen: unknown[] = [];
    await tauri.onCollabJoinProgress((payload) => seen.push(payload));
    expect(tauri.COLLAB_JOIN_PROGRESS_EVENT).toBe("collab-join-progress");
    expect(mocks.listen).toHaveBeenCalledWith("collab-join-progress", expect.any(Function));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: unknown }) => void;
    const payload = { serverId: SERVER, sharedProjectId: ACCOUNT, done: 2, total: 5 };
    handler({ payload });
    expect(seen).toEqual([payload]);
  });

  it("forwards the files a live project couldn't write", async () => {
    const seen: unknown[] = [];
    await tauri.onCollabLiveUnwritten((payload) => seen.push(payload));
    expect(tauri.COLLAB_LIVE_UNWRITTEN_EVENT).toBe("collab-live-unwritten");
    expect(mocks.listen).toHaveBeenCalledWith("collab-live-unwritten", expect.any(Function));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: unknown }) => void;
    const payload = { projectId: "grant", files: [{ path: "main.tex", reason: "locked" }] };
    handler({ payload });
    expect(seen).toEqual([payload]);
  });

  it("forwards the project a server refused because it reached its size limit", async () => {
    const seen: unknown[] = [];
    await tauri.onCollabLiveProjectFull((payload) => seen.push(payload));
    expect(tauri.COLLAB_LIVE_PROJECT_FULL_EVENT).toBe("collab-live-project-full");
    expect(mocks.listen).toHaveBeenCalledWith("collab-live-project-full", expect.any(Function));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: unknown }) => void;
    handler({ payload: { projectId: "grant" } });
    expect(seen).toEqual([{ projectId: "grant" }]);
  });

  it("flushes a live project, waiting for figures only when asked", async () => {
    await tauri.collabLiveFlush("grant");
    await tauri.collabLiveFlush("grant", { waitForFigures: true });
    expect(mocks.invoke.mock.calls).toEqual([
      ["collab_live_flush", { projectId: "grant", waitForFigures: false }],
      ["collab_live_flush", { projectId: "grant", waitForFigures: true }],
    ]);
  });

  it("forwards the files a stopped live session wrote, with their hashes", async () => {
    const seen: unknown[] = [];
    await tauri.onCollabLiveWritten((payload) => seen.push(payload));
    expect(tauri.COLLAB_LIVE_WRITTEN_EVENT).toBe("collab-live-written");
    expect(mocks.listen).toHaveBeenCalledWith("collab-live-written", expect.any(Function));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: unknown }) => void;
    const payload = { projectId: "grant", files: [{ path: "main.tex", hash: "c0ffee" }] };
    handler({ payload });
    expect(seen).toEqual([payload]);
  });

  it("forwards how far a figure's upload got", async () => {
    const seen: unknown[] = [];
    await tauri.onCollabUploadProgress((payload) => seen.push(payload));
    expect(tauri.COLLAB_UPLOAD_PROGRESS_EVENT).toBe("collab-upload-progress");
    expect(mocks.listen).toHaveBeenCalledWith("collab-upload-progress", expect.any(Function));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: unknown }) => void;
    const payload = { projectId: "grant", path: "figures/plot.png", done: 10, total: 40 };
    handler({ payload });
    expect(seen).toEqual([payload]);
  });

  it("asks a waiting live session to reconnect now, with no arguments", async () => {
    await tauri.collabLiveReconnectNow();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("collab_live_reconnect_now");
  });

  it("forwards server change events", async () => {
    const seen: string[] = [];
    const unlisten = await tauri.onCollabServerChanged((payload) => seen.push(payload.serverId));
    expect(tauri.COLLAB_SERVER_CHANGED_EVENT).toBe("collab-server-changed");
    expect(mocks.listen).toHaveBeenCalledWith("collab-server-changed", expect.any(Function));
    const handler = mocks.listen.mock.calls[0][1] as (event: { payload: { serverId: string } }) => void;
    handler({ payload: { serverId: SERVER } });
    expect(seen).toEqual([SERVER]);
    expect(unlisten).toBe(mocks.unlisten);
  });
});

describe("collaboration command drift", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  const registered = [...read("../../src-tauri/src/lib.rs").matchAll(/collab::commands::(collab_[a-z_]+)/g)].map(
    (match) => match[1],
  );
  const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

  it("registers every collaboration command once", () => {
    expect(registered).toHaveLength(25);
    expect(new Set(registered).size).toBe(registered.length);
  });

  it("gives every live editing command a wrapper, the new reconnect one too", () => {
    const live = [...read("../../src-tauri/src/lib.rs").matchAll(/collab::live::commands::(collab_[a-z_]+)/g)].map(
      (match) => match[1],
    );
    expect(live).toContain("collab_live_reconnect_now");
    const wrappers = read("./tauri-collab.ts");
    for (const name of live) expect(wrappers).toContain(`"${name}"`);
    expect(read("../../packages/backend-port/src/index.ts")).toContain("collabLiveReconnectNow:");
  });

  it("gives every registered command a wrapper in the collaboration module and a contract entry", () => {
    const wrappers = read("./tauri-collab.ts");
    const contract = read("../../packages/backend-port/src/index.ts");
    for (const name of registered) {
      expect(wrappers).toContain(`"${name}"`);
      expect(contract).toContain(`${camel(name)}:`);
    }
  });
});
