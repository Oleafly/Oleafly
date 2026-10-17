// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { ALICE_ID, BOB_ID, SERVER_ID, collabError, deferred, fill, member, securityEvent } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabAdminSecurityLog: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

import { SecurityLogTab, eventKindKey } from "./SecurityLogTab";

const copy = enCollab.admin.log;
const members = [member(), member({ account_id: BOB_ID, display_name: "Bob Smith" })];

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SecurityLogTab", () => {
  it("lists events with names, words and times, then loads older entries", async () => {
    mocks.collabAdminSecurityLog
      .mockResolvedValueOnce({
        items: [
          securityEvent(),
          securityEvent({ id: 2, actor: null, kind: "setup_completed", ip: null }),
          securityEvent({ id: 3, actor: BOB_ID, kind: "role_changed", target: ALICE_ID }),
        ],
        next_cursor: "c2",
      })
      .mockResolvedValueOnce({
        items: [
          securityEvent({
            id: 4,
            actor: "0192a0b0-0000-7000-8000-000000000999",
            kind: "member_removed",
            target: "someone-gone",
          }),
          securityEvent({ id: 5, kind: "unknown" }),
        ],
        next_cursor: null,
      });
    const user = userEvent.setup();
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    expect(mocks.collabAdminSecurityLog).toHaveBeenCalledWith(SERVER_ID);
    expect(items[0]).toHaveTextContent(`Alice Chen → ${copy.kinds.signIn}`);
    expect(items[0]).toHaveTextContent(fill(copy.ip, { ip: "203.0.113.7" }));
    expect(items[1]).toHaveTextContent(`${copy.server} → ${copy.kinds.setupCompleted}`);
    expect(items[2]).toHaveTextContent(`Bob Smith → ${copy.kinds.roleChanged}`);
    expect(items[2]).toHaveTextContent(fill(copy.target, { target: "Alice Chen" }));

    await user.click(screen.getByRole("button", { name: copy.loadMore }));
    expect(mocks.collabAdminSecurityLog).toHaveBeenLastCalledWith(SERVER_ID, "c2");
    expect(await screen.findByText(copy.unknownAccount)).toBeInTheDocument();
    const all = screen.getAllByRole("listitem");
    expect(all).toHaveLength(5);
    expect(all[3]).toHaveTextContent(fill(copy.target, { target: "someone-gone" }));
    expect(all[4]).toHaveTextContent(`Alice Chen → ${copy.kinds.unknown}`);
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
  });

  it("names who was refused at sign-in instead of the server", async () => {
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({
          id: 1,
          actor: null,
          kind: "sign_in_refused",
          target: "octocat",
          detail: { provider: "github", reason: "not_admitted" },
        }),
        securityEvent({
          id: 2,
          actor: null,
          kind: "sign_in_refused",
          target: "203.0.113.7",
          detail: { flow: "device_code", reason: "locked_out", limit: "ip" },
        }),
        securityEvent({ id: 3, actor: null, kind: "sign_in_refused", detail: { reason: "suspended" } }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent(`octocat → ${copy.kinds.signInRefused}`);
    expect(items[0]).toHaveTextContent(copy.details.reasons.notAdmitted);
    expect(items[0]).not.toHaveTextContent(copy.server);
    expect(items[0]).not.toHaveTextContent(fill(copy.target, { target: "octocat" }));
    expect(items[0]).toHaveTextContent(fill(copy.ip, { ip: "203.0.113.7" }));
    expect(items[1]).toHaveTextContent(`203.0.113.7 → ${copy.kinds.signInRefused}`);
    expect(items[1]).not.toHaveTextContent(fill(copy.ip, { ip: "203.0.113.7" }));
    expect(items[2]).toHaveTextContent(`${copy.unknownAccount} → ${copy.kinds.signInRefused}`);
    expect(items[2]).not.toHaveTextContent(copy.server);
  });

  it("maps every security event kind to a label, and anything else to the neutral one", () => {
    for (const kind of [
      "setup_completed",
      "sign_in",
      "sign_in_refused",
      "device_added",
      "device_signed_out",
      "refresh_reuse_detected",
      "member_added",
      "member_removed",
      "member_suspended",
      "member_reactivated",
      "role_changed",
      "allowlist_added",
      "allowlist_removed",
      "domain_rule_added",
      "domain_rule_removed",
      "settings_changed",
      "project_shared",
      "project_access_granted",
      "project_access_changed",
      "project_access_removed",
      "project_archived",
      "project_unarchived",
      "project_settings_changed",
      "guest_invited",
      "guest_invitation_approved",
      "guest_invitation_declined",
      "guest_invitation_revoked",
      "guest_admission_ended",
      "project_rejoin_refused",
      "comments_changed_while_off",
    ]) {
      expect(eventKindKey(kind), kind).not.toBe("unknown");
      expect(Object.keys(copy.kinds)).toContain(eventKindKey(kind));
    }
    expect(eventKindKey("unknown")).toBe("unknown");
    expect(eventKindKey("kind_from_a_later_server")).toBe("unknown");
    expect(eventKindKey("hasOwnProperty")).toBe("unknown");
  });

  it("says which project and guest each project event was about", async () => {
    const project = "0192a0b0-0000-7000-8000-0000000000p1";
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({
          id: 1,
          kind: "project_archived",
          target: project,
          project_title: "Thesis",
          detail: { title: "Thesis", by_admin: true },
        }),
        securityEvent({ id: 2, kind: "project_shared", target: project, detail: { title: "Thesis" } }),
        securityEvent({
          id: 3,
          kind: "project_settings_changed",
          target: project,
          project_title: "Thesis",
          detail: { access_log: true },
        }),
        securityEvent({ id: 4, kind: "project_settings_changed", detail: { access_log: false } }),
        securityEvent({ id: 5, kind: "project_settings_changed", detail: { comments_enabled: true } }),
        securityEvent({ id: 6, kind: "project_settings_changed", detail: { comments_enabled: false } }),
        securityEvent({ id: 7, kind: "project_access_changed", detail: { link_sharing: true, link_role: null } }),
        securityEvent({ id: 8, kind: "project_access_changed", detail: { link_sharing: false, link_role: null } }),
        securityEvent({ id: 9, kind: "project_access_changed", detail: { link_sharing: null, link_role: "editor" } }),
        securityEvent({
          id: 10,
          kind: "project_access_changed",
          target: BOB_ID,
          project_title: "Thesis",
          detail: { project, role: "viewer" },
        }),
        securityEvent({ id: 11, kind: "project_access_removed", target: BOB_ID, detail: { project, left: false } }),
        securityEvent({ id: 12, kind: "project_access_removed", target: ALICE_ID, detail: { project, left: true } }),
        securityEvent({
          id: 13,
          kind: "project_access_granted",
          target: project,
          project_title: "Thesis",
          detail: { role: "editor", via: "link" },
        }),
        securityEvent({
          id: 14,
          kind: "guest_invited",
          target: "Zm9yLWFuLWludml0YXRpb24",
          project_title: "Thesis",
          detail: { project, email: "dana@field.org", role: "viewer" },
        }),
        securityEvent({ id: 15, kind: "guest_invitation_approved", detail: { email: "dana@field.org" } }),
        securityEvent({ id: 16, kind: "guest_invitation_declined", detail: { email: "dana@field.org" } }),
        securityEvent({ id: 17, kind: "guest_invitation_revoked", detail: { email: "dana@field.org" } }),
        securityEvent({
          id: 18,
          kind: "guest_admission_ended",
          target: BOB_ID,
          detail: { reason: "no_projects_left", devices_signed_out: 1 },
        }),
        securityEvent({ id: 19, kind: "project_rejoin_refused", target: project, detail: { via: "link" } }),
        securityEvent({ id: 20, kind: "project_unarchived", detail: { title: "Thesis", by_admin: true } }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    const details = copy.details;
    const thesis = fill(details.project, { title: "Thesis" });
    expect(items[0]).toHaveTextContent(`Alice Chen → ${copy.kinds.projectArchived}`);
    expect(items[0]).toHaveTextContent(`${thesis} · ${details.byAdmin}`);
    expect(items[1]).toHaveTextContent(copy.kinds.projectShared);
    expect(items[1]).toHaveTextContent(thesis);
    expect(items[2]).toHaveTextContent(copy.kinds.projectAccessLogOn);
    expect(items[2]).toHaveTextContent(thesis);
    expect(items[2]).not.toHaveTextContent(project);
    expect(items[3]).toHaveTextContent(copy.kinds.projectAccessLogOff);
    expect(items[4]).toHaveTextContent(copy.kinds.projectCommentsOn);
    expect(items[5]).toHaveTextContent(copy.kinds.projectCommentsOff);
    expect(items[6]).toHaveTextContent(copy.kinds.projectLinkSharingOn);
    expect(items[7]).toHaveTextContent(copy.kinds.projectLinkSharingOff);
    expect(items[8]).toHaveTextContent(copy.kinds.projectLinkRoleChanged);
    expect(items[8]).toHaveTextContent(fill(details.role, { role: enCollab.projectRoles.editor }));
    expect(items[9]).toHaveTextContent(copy.kinds.projectAccessChanged);
    expect(items[9]).toHaveTextContent(fill(copy.target, { target: "Bob Smith" }));
    expect(items[9]).toHaveTextContent(`${thesis} · ${fill(details.role, { role: enCollab.projectRoles.viewer })}`);
    expect(items[10]).toHaveTextContent(copy.kinds.projectAccessRemoved);
    expect(items[11]).toHaveTextContent(copy.kinds.projectLeft);
    expect(items[12]).toHaveTextContent(copy.kinds.projectAccessGranted);
    expect(items[12]).toHaveTextContent(
      `${thesis} · ${fill(details.role, { role: enCollab.projectRoles.editor })} · ${details.via.link}`,
    );
    expect(items[13]).toHaveTextContent(copy.kinds.guestInvited);
    expect(items[13]).toHaveTextContent(fill(copy.target, { target: "dana@field.org" }));
    expect(items[13]).not.toHaveTextContent("Zm9yLWFuLWludml0YXRpb24");
    expect(items[13]).toHaveTextContent(`${thesis} · ${fill(details.role, { role: enCollab.projectRoles.viewer })}`);
    expect(items[14]).toHaveTextContent(copy.kinds.guestInvitationApproved);
    expect(items[15]).toHaveTextContent(copy.kinds.guestInvitationDeclined);
    expect(items[16]).toHaveTextContent(copy.kinds.guestInvitationRevoked);
    expect(items[17]).toHaveTextContent(copy.kinds.guestAdmissionEnded);
    expect(items[17]).toHaveTextContent(details.reasons.noProjectsLeft);
    expect(items[18]).toHaveTextContent(copy.kinds.projectRejoinRefused);
    expect(items[18]).toHaveTextContent(details.via.link);
    expect(items[19]).toHaveTextContent(copy.kinds.projectUnarchived);
    for (const item of items) expect(item).not.toHaveTextContent(copy.kinds.unknown);
  });

  it("says who changed comments while they were off and in which project, without the raw ids", async () => {
    const project = "0192a0b0-0000-7000-8000-0000000000p1";
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({
          id: 1,
          actor: BOB_ID,
          kind: "comments_changed_while_off",
          target: project,
          project_title: "Thesis",
          detail: { project, seq: 42, device: "0192a0b0-0000-7000-8000-0000000000d1" },
        }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const [item] = await screen.findAllByRole("listitem");
    expect(item).toHaveTextContent(`Bob Smith → ${copy.kinds.commentsChangedWhileOff}`);
    expect(item).toHaveTextContent(fill(copy.details.project, { title: "Thesis" }));
    expect(item).not.toHaveTextContent(project);
    expect(item).not.toHaveTextContent("0192a0b0-0000-7000-8000-0000000000d1");
  });

  it("explains how each person signed in or why the server refused them", async () => {
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({
          id: 1,
          detail: { provider: "github", via: "allowlist", new_account: true, reactivated: false, device_code: true },
        }),
        securityEvent({ id: 2, detail: { provider: "email-link", via: "linked", new_account: false } }),
        securityEvent({ id: 3, detail: { provider: "uni", via: "domain", reactivated: true } }),
        securityEvent({ id: 4, detail: { provider: "github", via: "guest" } }),
        securityEvent({ id: 5, kind: "setup_completed", detail: { provider: "github" } }),
        securityEvent({
          id: 6,
          actor: null,
          kind: "sign_in_refused",
          target: "dana@field.org",
          detail: { provider: "email-link", reason: "locked_out", limit: "address" },
        }),
        securityEvent({
          id: 7,
          actor: null,
          kind: "sign_in_refused",
          detail: { provider: "email-link", reason: "locked_out", limit: "ip" },
        }),
        securityEvent({
          id: 8,
          actor: null,
          kind: "sign_in_refused",
          target: "Dana's laptop",
          detail: { flow: "device_code", reason: "stopped_by_person", platform: "macos" },
        }),
        securityEvent({
          id: 9,
          actor: null,
          kind: "sign_in_refused",
          detail: { provider: "uni", reason: "not_admitted", device_code: false },
        }),
        securityEvent({ id: 10, actor: null, kind: "sign_in_refused", detail: { reason: "suspended" } }),
        securityEvent({ id: 11, actor: null, kind: "sign_in_refused", detail: { reason: "setup_code_invalid" } }),
        securityEvent({ id: 12, actor: null, kind: "sign_in_refused", detail: { reason: "guest_invitation_unusable" } }),
        securityEvent({ id: 13, actor: null, kind: "sign_in_refused", detail: { reason: "a_later_reason" } }),
        securityEvent({ id: 14, kind: "device_added", detail: { name: "Alice's MacBook", device_code: true } }),
        securityEvent({ id: 15, detail: { via: "setup" } }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    const details = copy.details;
    const github = fill(details.provider, { provider: "GitHub" });
    expect(items[0]).toHaveTextContent(
      `${github} · ${details.signInCode} · ${details.via.allowlist} · ${details.newAccount}`,
    );
    expect(items[1]).toHaveTextContent(details.providerEmailLink);
    expect(items[1]).not.toHaveTextContent(details.newAccount);
    expect(items[2]).toHaveTextContent(
      `${fill(details.provider, { provider: "uni" })} · ${details.via.domain} · ${details.reactivated}`,
    );
    expect(items[3]).toHaveTextContent(`${github} · ${details.via.guest}`);
    expect(items[4]).toHaveTextContent(`${copy.kinds.setupCompleted}${github}`);
    expect(items[5]).toHaveTextContent(`${details.providerEmailLink} · ${details.reasons.lockedOutAddress}`);
    expect(items[5]).toHaveTextContent(`dana@field.org → ${copy.kinds.signInRefused}`);
    expect(items[6]).toHaveTextContent(details.reasons.lockedOutIp);
    expect(items[7]).toHaveTextContent(`${details.signInCode} · ${details.reasons.stoppedByPerson}`);
    expect(items[8]).toHaveTextContent(`${fill(details.provider, { provider: "uni" })} · ${details.reasons.notAdmitted}`);
    expect(items[8]).not.toHaveTextContent(details.signInCode);
    expect(items[9]).toHaveTextContent(details.reasons.suspended);
    expect(items[10]).toHaveTextContent(details.reasons.setupCodeInvalid);
    expect(items[11]).toHaveTextContent(details.reasons.guestInvitationUnusable);
    expect(items[12].querySelectorAll("p")).toHaveLength(2);
    expect(items[13]).toHaveTextContent(`${fill(details.device, { name: "Alice's MacBook" })} · ${details.signInCode}`);
    expect(items[14]).toHaveTextContent(details.via.setup);
  });

  it("says in words why a sign-in was stopped for each refusal reason", async () => {
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({
          id: 1,
          actor: null,
          kind: "sign_in_refused",
          target: "Dana's laptop",
          detail: { provider: "uni", flow: "device_code", reason: "other_browser", platform: "macos" },
        }),
        securityEvent({
          id: 2,
          actor: null,
          kind: "sign_in_refused",
          target: "mallory@uni.edu",
          detail: {
            provider: "email-link",
            issuer: "oleafly-email-link",
            subject: "mallory@uni.edu",
            reason: "address_of_inactive_account",
            device_code: false,
          },
        }),
        securityEvent({
          id: 3,
          actor: null,
          kind: "sign_in_refused",
          target: "203.0.113.7",
          detail: { flow: "device_code", reason: "locked_out", limit: "ip" },
        }),
        securityEvent({
          id: 4,
          actor: null,
          kind: "sign_in_refused",
          target: "Dana's laptop",
          detail: { flow: "device_code", reason: "stopped_by_person", platform: "macos" },
        }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    const details = copy.details;
    expect(items[0]).toHaveTextContent(
      `${fill(details.provider, { provider: "uni" })} · ${details.signInCode} · ${details.reasons.otherBrowser}`,
    );
    expect(items[1]).toHaveTextContent(`${details.providerEmailLink} · ${details.reasons.inactiveAccountAddress}`);
    expect(items[1]).toHaveTextContent(`mallory@uni.edu → ${copy.kinds.signInRefused}`);
    expect(items[2]).toHaveTextContent(`${details.signInCode} · ${details.reasons.lockedOutIp}`);
    expect(items[3]).toHaveTextContent(`${details.signInCode} · ${details.reasons.stoppedByPerson}`);
  });

  it("names settings, roles and list entries instead of showing raw values", async () => {
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({
          id: 1,
          kind: "settings_changed",
          detail: {
            guests_enabled: { from: false, to: true },
            link_sharing_allowed: { from: true, to: false },
            setting_from_a_later_server: { from: false, to: true },
          },
        }),
        securityEvent({ id: 2, kind: "role_changed", target: BOB_ID, detail: { from: "member", to: "maintainer" } }),
        securityEvent({
          id: 3,
          kind: "allowlist_added",
          target: "entry-1",
          detail: { kind: "email", email: "carol@uni.edu", role: "member" },
        }),
        securityEvent({
          id: 4,
          kind: "allowlist_removed",
          target: "entry-2",
          detail: { kind: "provider_login", provider: "github", login: "octocat", role: "member" },
        }),
        securityEvent({
          id: 5,
          kind: "domain_rule_added",
          target: "rule-1",
          detail: { domain: "cs.uni.edu", role: "member" },
        }),
        securityEvent({
          id: 6,
          kind: "member_removed",
          target: "0192a0b0-0000-7000-8000-000000000777",
          detail: { display_name: "Erin Gone", role: "member" },
        }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    const details = copy.details;
    const settings = enCollab.admin.settings;
    expect(items[0]).toHaveTextContent(
      `${fill(details.settingOn, { setting: settings.guestsEnabled.label })} · ${fill(details.settingOff, {
        setting: settings.linkSharingAllowed.label,
      })}`,
    );
    expect(items[0]).not.toHaveTextContent("setting_from_a_later_server");
    expect(items[1]).toHaveTextContent(
      fill(details.roleChange, { from: enCollab.roles.member, to: enCollab.roles.maintainer }),
    );
    expect(items[2]).toHaveTextContent(fill(copy.target, { target: "carol@uni.edu" }));
    expect(items[3]).toHaveTextContent(
      fill(copy.target, { target: fill(enCollab.admin.allowlist.loginEntry, { login: "octocat", provider: "github" }) }),
    );
    expect(items[4]).toHaveTextContent(fill(copy.target, { target: "cs.uni.edu" }));
    expect(items[5]).toHaveTextContent(fill(copy.target, { target: "Erin Gone" }));
  });

  it("shows no detail line when an entry carries nothing readable", async () => {
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({ id: 1, detail: null }),
        securityEvent({ id: 2, kind: "role_changed", detail: "not an object" }),
        securityEvent({ id: 3, kind: "project_settings_changed", detail: { access_log: "yes" } }),
        securityEvent({ id: 4, kind: "sign_in", detail: { provider: 7, via: ["allowlist"] } }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    for (const item of items) expect(item.querySelectorAll("p")).toHaveLength(2);
    expect(items[2]).toHaveTextContent(copy.kinds.projectSettingsChanged);
  });

  it("names the device in device events instead of showing its id", async () => {
    const laptop = "01a131fa-d22e-7000-8000-00000000abcd";
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({ id: 1, kind: "device_added", target: laptop, device_name: "Prajwals-MacBook-Pro", detail: { name: "Prajwals-MacBook-Pro" } }),
        securityEvent({ id: 2, kind: "device_signed_out", target: laptop, device_name: "Prajwals-MacBook-Pro", detail: { by: "self" } }),
        securityEvent({ id: 3, kind: "refresh_reuse_detected", target: laptop, detail: { family: "f" } }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    for (const item of items) expect(item).not.toHaveTextContent(laptop);
    expect(items[0]).toHaveTextContent(fill(copy.details.device, { name: "Prajwals-MacBook-Pro" }));
    expect(items[0]).not.toHaveTextContent(fill(copy.target, { target: "Prajwals-MacBook-Pro" }));
    expect(items[1]).toHaveTextContent(fill(copy.target, { target: "Prajwals-MacBook-Pro" }));
    expect(items[2].textContent).not.toMatch(/·\s*On\s/);
  });

  it("falls back to plain words and the raw target when an entry lacks the usual details", async () => {
    mocks.collabAdminSecurityLog.mockResolvedValueOnce({
      items: [
        securityEvent({ id: 1, kind: "project_access_changed", target: "share-9", detail: {} }),
        securityEvent({
          id: 2,
          kind: "settings_changed",
          detail: { guests_enabled: { from: "off", to: "on" }, directory_visible: null },
        }),
        securityEvent({
          id: 3,
          kind: "allowlist_added",
          target: "entry-3",
          detail: { kind: "provider_login", login: "octocat" },
        }),
        securityEvent({ id: 4, kind: "domain_rule_removed", target: "rule-4", detail: { role: "member" } }),
      ],
      next_cursor: null,
    });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent(`Alice Chen → ${copy.kinds.projectAccessChanged}`);
    expect(items[0]).toHaveTextContent(fill(copy.target, { target: "share-9" }));
    expect(items[1]).toHaveTextContent(copy.kinds.settingsChanged);
    expect(items[1].querySelectorAll("p")).toHaveLength(2);
    expect(items[2]).toHaveTextContent(fill(copy.target, { target: "entry-3" }));
    expect(items[2]).not.toHaveTextContent("octocat");
    expect(items[3]).toHaveTextContent(fill(copy.target, { target: "rule-4" }));
  });

  it("shows the log of the server now in view when an older answer comes back late", async () => {
    const slow = deferred<{ items: ReturnType<typeof securityEvent>[]; next_cursor: string | null }>();
    const failing = deferred<{ items: ReturnType<typeof securityEvent>[]; next_cursor: string | null }>();
    mocks.collabAdminSecurityLog
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce({ items: [securityEvent()], next_cursor: null });
    const { rerender } = render(<SecurityLogTab serverId="server-a" members={members} />);
    rerender(<SecurityLogTab serverId="server-b" members={members} />);
    rerender(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
    await act(async () => {
      slow.resolve({ items: [securityEvent({ id: 7 }), securityEvent({ id: 8 })], next_cursor: "older" });
      failing.reject(collabError("forbidden"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
  });

  it("says when the log is empty", async () => {
    mocks.collabAdminSecurityLog.mockResolvedValue({ items: [], next_cursor: null });
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });

  it("explains failures on the first page and on older pages", async () => {
    mocks.collabAdminSecurityLog
      .mockRejectedValueOnce(collabError("forbidden"))
      .mockResolvedValueOnce({ items: [securityEvent()], next_cursor: "c2" })
      .mockRejectedValueOnce(collabError("rate_limited"));
    const user = userEvent.setup();
    render(<SecurityLogTab serverId={SERVER_ID} members={members} />);
    expect(await screen.findByText(enCollab.errors.forbidden)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    await user.click(await screen.findByRole("button", { name: copy.loadMore }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.rate_limited);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
