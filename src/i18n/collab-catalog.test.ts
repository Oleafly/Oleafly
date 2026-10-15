import { describe, expect, it } from "vitest";
import { flattenCatalog } from "@oleafly/i18n-contract";
import collab from "./locales/en/collab.json" with { type: "json" };
import context from "./context/collab.json" with { type: "json" };

const ERROR_CODES = [
  "unreachable",
  "not_https",
  "client_too_old",
  "server_too_old",
  "not_admitted",
  "sign_in_cancelled",
  "sign_in_timed_out",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "setup_code_invalid",
  "server",
  "internal",
  "server_changed",
  "duplicate_server",
  "device_in_use",
  "server_unknown",
  "too_large",
  "invalid",
  "invalid_domain",
  "invalid_email",
  "invalid_login",
  "guests_off",
  "link_sharing_off",
  "access_log_off",
  "last_admin",
  "duplicate_entry",
  "already_member",
  "project_not_shared",
  "project_full",
  "not_a_link",
  "signed_out",
  "server_removed",
  "share_in_progress",
  "cancelled",
  "cloud_synced",
  "owner_away",
  "wrong_server",
];
const CHECKS = ["reachable", "https", "protocol", "webSocket", "signInProviders", "email", "clock"];
const STATUSES = ["pass", "fail", "info", "skipped"];
const EVENT_KINDS = [
  "setupCompleted",
  "signIn",
  "signInRefused",
  "deviceAdded",
  "deviceSignedOut",
  "refreshReuseDetected",
  "memberAdded",
  "memberRemoved",
  "memberSuspended",
  "memberReactivated",
  "roleChanged",
  "allowlistAdded",
  "allowlistRemoved",
  "domainRuleAdded",
  "domainRuleRemoved",
  "settingsChanged",
  "projectShared",
  "projectAccessGranted",
  "projectAccessChanged",
  "projectAccessRemoved",
  "projectLeft",
  "projectLinkSharingOn",
  "projectLinkSharingOff",
  "projectLinkRoleChanged",
  "projectArchived",
  "projectUnarchived",
  "projectSettingsChanged",
  "projectAccessLogOn",
  "projectAccessLogOff",
  "projectCommentsOn",
  "projectCommentsOff",
  "projectRejoinRefused",
  "commentsChangedWhileOff",
  "guestInvited",
  "guestInvitationApproved",
  "guestInvitationDeclined",
  "guestInvitationRevoked",
  "guestAdmissionEnded",
  "unknown",
];
const RUNTIME_SETTINGS = [
  "guestsEnabled",
  "guestApprovalRequired",
  "directoryVisible",
  "directoryShowsEmail",
  "linkSharingAllowed",
  "accessLogsAllowed",
  "emailNotifications",
];

const flat = flattenCatalog(collab);

describe("collab catalog", () => {
  it("has one message per error code the backend sends", () => {
    expect(Object.keys(collab.errors).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("has a label and a sentence for every check and every status", () => {
    expect(Object.keys(collab.section.checks.items).sort()).toEqual([...CHECKS].sort());
    expect(Object.keys(collab.section.checks.status).sort()).toEqual([...STATUSES].sort());
    for (const id of CHECKS) {
      for (const key of ["label", ...STATUSES]) {
        expect(flat.get(`section.checks.items.${id}.${key}`), `${id}.${key}`).toBeTruthy();
      }
    }
  });

  it("names every server role, security event and runtime setting", () => {
    expect(Object.keys(collab.roles)).toEqual(["admin", "maintainer", "member", "guest", "unknown"]);
    expect(Object.keys(collab.projectRoles)).toEqual(["owner", "editor", "viewer", "unknown"]);
    expect(Object.keys(collab.admin.log.kinds).sort()).toEqual([...EVENT_KINDS].sort());
    for (const key of RUNTIME_SETTINGS) {
      expect(flat.get(`admin.settings.${key}.label`), key).toBeTruthy();
      expect(flat.get(`admin.settings.${key}.description`), key).toBeTruthy();
    }
  });

  it("writes plain sentences with no dashes, semicolons, stray spaces or plural forms", () => {
    for (const [key, value] of flat) {
      expect(value, key).not.toMatch(/[—–;；]/u);
      expect(value.trim(), key).toBe(value);
      expect(key, key).not.toMatch(/_(zero|one|two|few|many|other)$/u);
    }
  });

  it("calls each collaboration idea by one name on every screen", () => {
    // Admins suspend and reactivate accounts, so members see the same word.
    expect(collab.section.server.suspended).toBe(collab.admin.members.suspended);
    expect(collab.sync.suspended).toMatch(/suspended/u);
    expect(collab.section.server.suspendedHint).toMatch(/suspended/u);
    expect(collab.activity.suspended).toBe(collab.section.server.suspendedHint);
    // The people list is "People", so its own buttons don't call them members,
    // and the people let in are "Allowed people", not "the list".
    expect(collab.admin.members.removeConfirm.confirm).not.toMatch(/member/u);
    expect(collab.admin.members.suspendConfirm.confirm).not.toMatch(/member/u);
    expect(collab.section.server.manageHint).toContain(collab.admin.tabs.allowlist);
    for (const [key, value] of flat) if (key.startsWith("admin.allowlist.")) expect(value, key).not.toMatch(/the list/u);
    expect(collab.errors.duplicate_entry).not.toMatch(/list/u);
    // One name for the list of people let in, the people list and server settings.
    expect(collab.admin.members.addHint).toContain(collab.admin.tabs.allowlist);
    expect(collab.admin.log.kinds.allowlistAdded).toContain(collab.admin.tabs.allowlist);
    expect(collab.admin.log.kinds.allowlistRemoved).toContain(collab.admin.tabs.allowlist);
    expect(collab.errors.not_admitted).not.toMatch(/list/u);
    expect(collab.admin.tabs.members).toBe(collab.console.sections.people);
    expect(collab.admin.tabs.settings).toBe(collab.console.sections.settings);
    for (const [key, value] of flat) expect(value, key).not.toMatch(/paused your account|allowed list|Account paused/u);
  });

  it("says why a project can't take new people in words that fit the person joining and the admin approving", () => {
    // An admin approving a guest sees this too, so it doesn't send them to an admin.
    expect(collab.errors.owner_away).not.toMatch(/admin/iu);
    expect(collab.errors.owner_away).toMatch(/until their account is active again/u);
  });

  it("says where the setup code comes from, and what to do when the server isn't yours", () => {
    const setup = collab.addServer.setupDescription;
    expect(setup).toMatch(/the installer showed you/u);
    expect(setup).toMatch(/server's log/u);
    expect(setup).toMatch(/If you didn't install it, ask the person who runs it/u);
  });

  it("only explains keys the catalog has", () => {
    for (const key of flattenCatalog(context).keys()) {
      expect(flat.has(key), key).toBe(true);
    }
  });
});
