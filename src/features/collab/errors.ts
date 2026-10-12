import { i18n } from "@/i18n";
import { isCollabCommandError, type CollabErrorCode } from "@/lib/tauri";

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
  return isCollabCommandError(error) ? error.code : "internal";
}

export function collabErrorMessage(code: CollabErrorCode, context?: CollabErrorContext): string {
  if (code === "conflict" && context) return CONFLICT_MESSAGES[context]();
  return i18n.t(($) => $.collab.errors[code]);
}
