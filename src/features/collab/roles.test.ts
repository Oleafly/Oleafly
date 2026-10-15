import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SERVER_ACTIONS,
  SERVER_ROLES,
  assignableRoles,
  canChangeMember,
  canManageServer,
  isReadOnlyProjectRole,
  isStaffRole,
  serverRoleAllows,
  toServerRole,
  type ServerAction,
} from "./roles";

const TRUTH_TABLE: Readonly<Record<ServerAction, { maintainer: boolean; member: boolean }>> = {
  manageMembers: { maintainer: true, member: false },
  manageDomainRules: { maintainer: true, member: false },
  approveGuests: { maintainer: true, member: false },
  readSecurityLog: { maintainer: true, member: false },
  signOutAnyDevice: { maintainer: true, member: false },
  manageStaff: { maintainer: false, member: false },
  changeSettings: { maintainer: false, member: false },
  viewStorage: { maintainer: false, member: false },
  deleteProjectForStorage: { maintainer: false, member: false },
  shareProjects: { maintainer: true, member: true },
  seeDirectory: { maintainer: true, member: true },
};

const ROLES_RS = fileURLToPath(new URL("../../../crates/oleafly-collab-protocol/src/roles.rs", import.meta.url));

function rustVariants(source: string, name: string): string[] {
  const body = new RegExp(`pub enum ${name}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? "";
  return body
    .replace(/#\[[^\]]*\]/g, "")
    .split(",")
    .map((variant) => variant.trim())
    .filter((variant) => /^[A-Z]\w*$/.test(variant));
}

function camel(variant: string): string {
  return variant.charAt(0).toLowerCase() + variant.slice(1);
}

describe("serverRoleAllows", () => {
  it.each(SERVER_ACTIONS)("%s follows the program plan's truth table", (action) => {
    expect(serverRoleAllows("admin", action)).toBe(true);
    expect(serverRoleAllows("maintainer", action)).toBe(TRUTH_TABLE[action].maintainer);
    expect(serverRoleAllows("member", action)).toBe(TRUTH_TABLE[action].member);
    expect(serverRoleAllows("guest", action)).toBe(false);
  });

  it("names the same actions and roles, in the same order, as the protocol crate", () => {
    const source = readFileSync(ROLES_RS, "utf8");
    expect(rustVariants(source, "ServerAction").map(camel)).toEqual([...SERVER_ACTIONS]);
    // `Unknown` stands for a role from a later server. It is never granted, so
    // the app lists only the roles it can pick and reads the rest as no role.
    expect(
      rustVariants(source, "ServerRole")
        .map(camel)
        .filter((role) => role !== "unknown"),
    ).toEqual([...SERVER_ROLES]);
    expect(Object.keys(TRUTH_TABLE).sort()).toEqual([...SERVER_ACTIONS].sort());
  });
});

describe("role helpers", () => {
  it("lets an admin grant any role and a maintainer only member or guest", () => {
    expect(assignableRoles("admin")).toEqual(["admin", "maintainer", "member", "guest"]);
    expect(assignableRoles("maintainer")).toEqual(["member", "guest"]);
    expect(isStaffRole("maintainer")).toBe(true);
    expect(isStaffRole("guest")).toBe(false);
  });

  it("keeps staff rows read-only for a maintainer", () => {
    expect(canChangeMember("maintainer", "member")).toBe(true);
    expect(canChangeMember("maintainer", "guest")).toBe(true);
    expect(canChangeMember("maintainer", "maintainer")).toBe(false);
    expect(canChangeMember("maintainer", "admin")).toBe(false);
    expect(canChangeMember("admin", "admin")).toBe(true);
    expect(canChangeMember("member", "guest")).toBe(false);
  });

  it("opens Manage server for admins and maintainers only", () => {
    expect(canManageServer("admin")).toBe(true);
    expect(canManageServer("maintainer")).toBe(true);
    expect(canManageServer("member")).toBe(false);
    expect(canManageServer("guest")).toBe(false);
    expect(canManageServer(null)).toBe(false);
  });

  it("reads a role from wire text", () => {
    expect(toServerRole("maintainer")).toBe("maintainer");
    expect(toServerRole("owner")).toBeNull();
    expect(toServerRole(undefined)).toBeNull();
  });

  it("gives a server role from a later server no rights at all", () => {
    const role = toServerRole("unknown");
    expect(role).toBeNull();
    expect(canManageServer(role)).toBe(false);
  });

  it("treats a project role from a later server as read-only, like a viewer", () => {
    expect(isReadOnlyProjectRole("unknown")).toBe(true);
    expect(isReadOnlyProjectRole("viewer")).toBe(true);
    expect(isReadOnlyProjectRole("editor")).toBe(false);
    expect(isReadOnlyProjectRole("owner")).toBe(false);
    expect(isReadOnlyProjectRole(null)).toBe(false);
  });
});
