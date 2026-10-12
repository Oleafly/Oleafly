import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import * as tauri from "./tauri";

const SERVER = "0192f5a4-7b1c-7d2e-8f3a-1b2c3d4e5f60";
const PROJECT = "grant-proposal";
const INVITATION = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
});

describe("guest invitation IPC contract", () => {
  it.each([
    [
      "collabGuestInvitations",
      () => tauri.collabGuestInvitations(PROJECT),
      "collab_guest_invitations",
      { projectId: PROJECT },
    ],
    [
      "collabGuestInvite",
      () => tauri.collabGuestInvite(PROJECT, "dana@field.org", "viewer"),
      "collab_guest_invite",
      { projectId: PROJECT, email: "dana@field.org", role: "viewer" },
    ],
    [
      "collabGuestInvitationRevoke",
      () => tauri.collabGuestInvitationRevoke(PROJECT, INVITATION),
      "collab_guest_invitation_revoke",
      { projectId: PROJECT, invitationId: INVITATION },
    ],
    [
      "collabAdminGuestInvitations",
      () => tauri.collabAdminGuestInvitations(SERVER),
      "collab_admin_guest_invitations",
      { serverId: SERVER },
    ],
    [
      "collabAdminGuestApprove",
      () => tauri.collabAdminGuestApprove(SERVER, INVITATION),
      "collab_admin_guest_approve",
      { serverId: SERVER, invitationId: INVITATION },
    ],
    [
      "collabAdminGuestDecline",
      () => tauri.collabAdminGuestDecline(SERVER, INVITATION),
      "collab_admin_guest_decline",
      { serverId: SERVER, invitationId: INVITATION },
    ],
    [
      "collabAdminGuestRevoke",
      () => tauri.collabAdminGuestRevoke(SERVER, INVITATION),
      "collab_admin_guest_revoke",
      { serverId: SERVER, invitationId: INVITATION },
    ],
  ] as const)("sends %s", async (_label, call, command, args) => {
    await call();
    expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });
});

describe("guest invitation command drift", () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it("registers every guest command the bridge calls", () => {
    const registered = [...read("../../src-tauri/src/lib.rs").matchAll(/collab::guests::(collab_[a-z_]+)/g)].map(
      (match) => match[1],
    );
    expect(registered).toEqual([
      "collab_guest_invitations",
      "collab_guest_invite",
      "collab_guest_invitation_revoke",
      "collab_admin_guest_invitations",
      "collab_admin_guest_approve",
      "collab_admin_guest_decline",
      "collab_admin_guest_revoke",
    ]);
    const defined = [...read("../../src-tauri/src/collab/guests.rs").matchAll(/pub async fn (collab_[a-z_]+)/g)].map(
      (match) => match[1],
    );
    expect(defined).toEqual(registered);
  });
});
