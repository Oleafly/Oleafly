import type { CollabProjectRole, CollabServerRole } from "@/lib/tauri";

export const SERVER_ROLES = ["admin", "maintainer", "member", "guest"] as const satisfies readonly CollabServerRole[];

export type ServerRole = (typeof SERVER_ROLES)[number];

export const SERVER_ACTIONS = [
  "manageMembers",
  "manageDomainRules",
  "approveGuests",
  "readSecurityLog",
  "signOutAnyDevice",
  "manageStaff",
  "changeSettings",
  "viewStorage",
  "deleteProjectForStorage",
  "shareProjects",
  "seeDirectory",
] as const;

export type ServerAction = (typeof SERVER_ACTIONS)[number];

const MAINTAINER_ACTIONS: ReadonlySet<ServerAction> = new Set<ServerAction>([
  "manageMembers",
  "manageDomainRules",
  "approveGuests",
  "readSecurityLog",
  "signOutAnyDevice",
  "shareProjects",
  "seeDirectory",
]);

const MEMBER_ACTIONS: ReadonlySet<ServerAction> = new Set<ServerAction>(["shareProjects", "seeDirectory"]);

export function serverRoleAllows(role: ServerRole, action: ServerAction): boolean {
  switch (role) {
    case "admin":
      return true;
    case "maintainer":
      return MAINTAINER_ACTIONS.has(action);
    case "member":
      return MEMBER_ACTIONS.has(action);
    case "guest":
      return false;
  }
}

export function toServerRole(value: string | null | undefined): ServerRole | null {
  return SERVER_ROLES.find((role) => role === value) ?? null;
}

export function isStaffRole(role: ServerRole): boolean {
  return role === "admin" || role === "maintainer";
}

export function assignableRoles(actor: ServerRole): ServerRole[] {
  return serverRoleAllows(actor, "manageStaff")
    ? [...SERVER_ROLES]
    : SERVER_ROLES.filter((role) => !isStaffRole(role));
}

export function canChangeMember(actor: ServerRole, target: ServerRole): boolean {
  if (!serverRoleAllows(actor, "manageMembers")) return false;
  return !isStaffRole(target) || serverRoleAllows(actor, "manageStaff");
}

export function canManageServer(role: ServerRole | null): boolean {
  return role !== null && serverRoleAllows(role, "manageMembers");
}

export function isReadOnlyProjectRole(role: CollabProjectRole | null | undefined): boolean {
  return role === "viewer" || role === "commenter" || role === "unknown";
}

export function canEditProjectRole(role: CollabProjectRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export function suggestsOnlyProjectRole(role: CollabProjectRole | null | undefined): boolean {
  return role === "reviewer";
}

export function canSuggestProjectRole(role: CollabProjectRole | null | undefined): boolean {
  return canEditProjectRole(role) || role === "reviewer";
}

export function canCommentProjectRole(role: CollabProjectRole | null | undefined): boolean {
  return canSuggestProjectRole(role) || role === "commenter";
}

export function canChatProjectRole(role: CollabProjectRole | null | undefined): boolean {
  return canCommentProjectRole(role);
}
