// Truncates tool outputs and long history so multi-step agent runs stay
// inside model context windows.

export const TOOL_RESULT_MAX_CHARS = 12_000;
export const HISTORY_MSG_MAX_CHARS = 8_000;
export const HISTORY_MAX_TURNS = 24;

export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.max(0, max - 80);
  return `${s.slice(0, keep)}\n… [truncated ${s.length - keep} chars; re-read with tools if needed]`;
}


export type HistoryMsg = { role: string; content: string };

// `messages` should be the conversation *before* the new user turn is
// appended by the caller, or the full list excluding the trailing empty
// assistant.
export function packChatHistory(
  messages: { role: string; content: string }[],
  opts?: { maxTurns?: number; maxChars?: number },
): HistoryMsg[] {
  const maxTurns = opts?.maxTurns ?? HISTORY_MAX_TURNS;
  const maxChars = opts?.maxChars ?? HISTORY_MSG_MAX_CHARS;
  const textTurns = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const recent = textTurns.slice(-maxTurns);
  return recent.map((m) => ({
    role: m.role,
    content: truncateText(m.content || "", maxChars),
  }));
}
