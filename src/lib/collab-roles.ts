import type { CollabProjectRole } from "@/lib/tauri";

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
