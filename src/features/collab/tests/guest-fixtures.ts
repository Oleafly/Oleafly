import type {
  CollabGuestInvitation,
  CollabGuestInviteResult,
  CollabProjectGuestInvitations,
} from "@/lib/tauri";
import { BOB, SHARED_ID } from "./fixtures";

export const ADD_LINK = "oleafly://server/add?url=https%3A%2F%2Fcollab.uni.edu";

export function invitation(overrides: Partial<CollabGuestInvitation> = {}): CollabGuestInvitation {
  return {
    id: "invitation-1",
    project_id: SHARED_ID,
    project_title: "Grant proposal",
    email: "dana@field.org",
    role: "viewer",
    status: "invited",
    invited_by: BOB,
    created_at: 1_760_000_000_000,
    expires_at: 1_761_209_600_000,
    ...overrides,
  };
}

export function projectInvitations(
  overrides: Partial<CollabProjectGuestInvitations> = {},
): CollabProjectGuestInvitations {
  return {
    guests_enabled: true,
    approval_required: false,
    sends_email: true,
    add_link: ADD_LINK,
    invitations: [],
    ...overrides,
  };
}

export function inviteResult(overrides: Partial<CollabGuestInviteResult> = {}): CollabGuestInviteResult {
  return { invitation: invitation(), emailed: true, add_link: ADD_LINK, ...overrides };
}
