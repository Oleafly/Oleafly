import type { CollabEditMode, CollabProjectRole, WebFeatures } from "./protocol";

export interface RoleAbilities {
  edit: boolean;
  chooseMode: boolean;
  alwaysSuggest: boolean;
  comment: boolean;
  resolve: boolean;
  chat: boolean;
  clearChat: boolean;
}

export function abilitiesFor(role: CollabProjectRole, features: WebFeatures): RoleAbilities {
  const manages = role === "owner" || role === "editor";
  const reviews = role === "reviewer";
  const talks = manages || reviews || role === "commenter";
  return {
    edit: manages || (reviews && features.suggestions),
    chooseMode: manages && features.suggestions,
    alwaysSuggest: reviews,
    comment: talks && features.comments,
    resolve: manages && features.suggestions,
    chat: talks && features.chat,
    clearChat: role === "owner" && features.chat,
  };
}

export function effectiveMode(role: CollabProjectRole, chosen: CollabEditMode, features: WebFeatures): CollabEditMode {
  if (role === "reviewer") return "suggesting";
  if ((role === "owner" || role === "editor") && features.suggestions) return chosen;
  return "editing";
}

export function canWithdraw(role: CollabProjectRole, author: string, self: string | null): boolean {
  return self !== null && author === self && role !== "viewer" && role !== "commenter" && role !== "unknown";
}
