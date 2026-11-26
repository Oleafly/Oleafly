import type { CollabChatMessage, CollabChatStatus, CollabProjectRole } from "@/lib/tauri";
import { canChatProjectRole } from "../roles";
import type { LiveSeed } from "./fixtures";

export const CHAT_AT = 1_760_000_000_000;

export function chatStatus(seed: LiveSeed, overrides: Partial<CollabChatStatus> = {}): CollabChatStatus {
  const overleaf = seed.name === "overleaf";
  return {
    available: true,
    post: true,
    reactions: !overleaf,
    edit: overleaf,
    clear: !overleaf,
    math: overleaf,
    markdown: !overleaf,
    maxLength: overleaf ? 10_240 : 4_000,
    ...overrides,
  };
}

export function chatMessage(
  id: string,
  author: string,
  body: string,
  at = CHAT_AT,
  overrides: Partial<CollabChatMessage> = {},
): CollabChatMessage {
  return {
    id,
    author,
    at,
    body,
    deleted: false,
    verified: true,
    reactions: [],
    pending: false,
    mentions: [],
    editedAt: null,
    ...overrides,
  };
}

export function chatStatusFor(seed: LiveSeed, role: CollabProjectRole | null): CollabChatStatus {
  if (seed.name === "overleaf") return chatStatus(seed);
  return chatStatus(seed, { post: canChatProjectRole(role), clear: role === "owner" });
}
