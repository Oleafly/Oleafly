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

import * as tauri from "./tauri";

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
    ["collabServerSignOut", () => tauri.collabServerSignOut(SERVER), "collab_server_sign_out", { serverId: SERVER }],
    ["collabServerRemove", () => tauri.collabServerRemove(SERVER), "collab_server_remove", { serverId: SERVER }],
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
    expect(tauri.isCollabCommandError({ code: "teapot", message: "" })).toBe(false);
    expect(tauri.isCollabCommandError({ code: "server" })).toBe(false);
    expect(tauri.isCollabCommandError("unreachable")).toBe(false);
    expect(tauri.isCollabCommandError(null)).toBe(false);
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
    expect(registered).toHaveLength(24);
    expect(new Set(registered).size).toBe(registered.length);
  });

  it("gives every registered command a wrapper and a contract entry", () => {
    const wrappers = read("./tauri.ts");
    const contract = read("../../packages/backend-port/src/index.ts");
    for (const name of registered) {
      expect(wrappers).toContain(`"${name}"`);
      expect(contract).toContain(`${camel(name)}:`);
    }
  });
});
