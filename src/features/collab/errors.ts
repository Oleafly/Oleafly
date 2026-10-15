import { i18n } from "@/i18n";
import { decodeAppError } from "@/lib/app-error";
import type { CollabErrorCode } from "@/lib/tauri";
import { isCollabCommandError } from "@/lib/tauri-collab";

// What the backend's switch says when Live collaboration is off and a command
// is refused before it runs, as one of the app's own errors.
const SWITCH_OFF = "collab.turned_off";

export const COLLAB_ERROR_CODES = [
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
  "turned_off",
  "cloud_synced",
  "owner_away",
  "wrong_server",
] as const satisfies readonly CollabErrorCode[];

type UnlistedCode = Exclude<CollabErrorCode, (typeof COLLAB_ERROR_CODES)[number]>;

export const COLLAB_ERROR_CODES_COMPLETE: [UnlistedCode] extends [never] ? true : never = true;

export type CollabErrorContext = "members" | "allowlist" | "domains";

const CONFLICT_MESSAGES: Readonly<Record<CollabErrorContext, () => string>> = {
  members: () => i18n.t(($) => $.collab.admin.members.lastAdmin),
  allowlist: () => i18n.t(($) => $.collab.admin.allowlist.duplicate),
  domains: () => i18n.t(($) => $.collab.admin.domains.duplicate),
};

export function collabErrorCode(error: unknown): CollabErrorCode {
  if (isCollabCommandError(error)) return error.code;
  if (decodeAppError(error)?.code === SWITCH_OFF) return "turned_off";
  return "internal";
}

export function collabErrorMessage(code: CollabErrorCode, context?: CollabErrorContext): string {
  // The switch's own message already lives with the app's other errors.
  if (code === "turned_off") return i18n.t(($) => $.errors.collab.turned_off);
  if (context && (code === "conflict" || (code === "duplicate_entry" && context !== "members"))) {
    return CONFLICT_MESSAGES[context]();
  }
  return i18n.t(($) => $.collab.errors[code]);
}

// A refusal the server has no code for comes back as `invalid` with the
// server's own sentence, which says more than any general wording could.
export function collabErrorText(error: unknown, context?: CollabErrorContext): string {
  const code = collabErrorCode(error);
  if (code === "invalid" && isCollabCommandError(error) && error.message.trim()) return error.message.trim();
  return collabErrorMessage(code, context);
}
