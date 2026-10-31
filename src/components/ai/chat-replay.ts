import type { ChatMessage } from "@/store/chats";

export interface MessageActionState {
  regenerate?: "regenerate" | "retry";
  editable?: boolean;
}

export function turnStartIndex(messages: readonly ChatMessage[], index: number): number {
  for (let at = Math.min(index, messages.length - 1); at >= 0; at -= 1) {
    const message = messages[at];
    if (message.role === "user" && !message.steered) return at;
  }
  return -1;
}

export function lastTurnStart(messages: readonly ChatMessage[]): number {
  return turnStartIndex(messages, messages.length - 1);
}

export function userTurnsFrom(messages: readonly ChatMessage[], from: number): number {
  let turns = 0;
  for (let at = Math.max(0, from); at < messages.length; at += 1) {
    if (messages[at].role === "user" && !messages[at].steered) turns += 1;
  }
  return turns;
}

export function changedFileCount(messages: readonly ChatMessage[], from: number): number {
  let files = 0;
  for (let at = Math.max(0, from); at < messages.length; at += 1) {
    const changes = messages[at].turnChanges;
    if (changes) files += changes.files.length + (changes.moreFiles ?? 0);
  }
  return files;
}

export function turnsToDrop(
  threadTurnIds: readonly (string | null)[],
  turnId: string | undefined,
  fallback: number,
): number {
  if (turnId) {
    const at = threadTurnIds.lastIndexOf(turnId);
    if (at !== -1) return threadTurnIds.length - at;
  }
  return fallback;
}

export function replayMode(messages: readonly ChatMessage[], userIndex: number): "inPlace" | "fork" {
  return userIndex === lastTurnStart(messages) ? "inPlace" : "fork";
}

function latestAssistantIndex(messages: readonly ChatMessage[]): number {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    if (messages[at].role === "assistant") return at;
  }
  return -1;
}

export function messageActionState(
  messages: readonly ChatMessage[],
  index: number,
  ctx: { enabled: boolean; excludeContent?: string },
): MessageActionState {
  if (!ctx.enabled) return {};
  const message = messages[index];
  if (!message) return {};
  if (message.role === "assistant") {
    if (index !== latestAssistantIndex(messages) || turnStartIndex(messages, index) === -1) return {};
    return { regenerate: message.failed ? "retry" : "regenerate" };
  }
  if (message.id && !message.steered && message.content !== ctx.excludeContent) {
    return { editable: true };
  }
  return {};
}
