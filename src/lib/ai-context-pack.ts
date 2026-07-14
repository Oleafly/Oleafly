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

export function packToolOutput(output: unknown, maxChars = TOOL_RESULT_MAX_CHARS): unknown {
  if (output == null) return output;
  if (typeof output === "string") return truncateText(output, maxChars);

  if (typeof output === "object") {
    try {
      const raw = JSON.stringify(output);
      if (raw.length <= maxChars) return output;
      // Prefer trimming known large string fields.
      const o = { ...(output as Record<string, unknown>) };
      for (const key of ["content", "log", "text", "log_tail", "body"]) {
        if (typeof o[key] === "string") {
          o[key] = truncateText(o[key] as string, Math.floor(maxChars * 0.7));
        }
      }
      const again = JSON.stringify(o);
      if (again.length <= maxChars) return o;
      return {
        truncated: true,
        preview: truncateText(again, maxChars),
        note: "Tool output was truncated for context. Call the tool again with a narrower scope if needed.",
      };
    } catch {
      return { truncated: true, note: "Tool output could not be serialized." };
    }
  }
  return output;
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
