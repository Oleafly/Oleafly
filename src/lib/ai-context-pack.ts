// Truncates tool outputs and long history so multi-step agent runs stay
// inside model context windows.

export const TOOL_RESULT_MAX_CHARS = 12_000;
export const HISTORY_MSG_MAX_CHARS = 8_000;
export const HISTORY_MAX_TURNS = 24;

export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.max(0, max - 80);
  return `${s.slice(0, keep)}\n… [truncated ${s.length - keep} chars. Re-read with tools if needed]`;
}

// Keeps the start and the end, favouring the end, where command output
// prints its errors and summary.
export function truncateMiddle(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.max(0, max - 80);
  const head = Math.floor(keep / 3);
  const tail = keep - head;
  return `${s.slice(0, head)}\n… [truncated ${s.length - keep} chars from the middle] …\n${s.slice(s.length - tail)}`;
}

const SHORTENED_KEYS = ["content", "log", "text", "log_tail", "body", "output"];
const MIDDLE_CUT_KEYS = new Set(["output"]);

// Returns null when no field is long enough to shorten.
function shortenFields(o: Record<string, unknown>, max: number): Record<string, unknown> | null {
  const packed = { ...o };
  let cut = false;
  for (const key of SHORTENED_KEYS) {
    const value = o[key];
    if (typeof value !== "string" || value.length <= max) continue;
    packed[key] = MIDDLE_CUT_KEYS.has(key) ? truncateMiddle(value, max) : truncateText(value, max);
    cut = true;
  }
  if (!cut) return null;
  packed.truncated = true;
  return packed;
}

export function packToolOutput(output: unknown, maxChars = TOOL_RESULT_MAX_CHARS): unknown {
  if (output == null) return output;
  if (typeof output === "string") return truncateText(output, maxChars);

  if (typeof output === "object") {
    try {
      const raw = JSON.stringify(output);
      if (raw.length <= maxChars) return output;
      let again = raw;
      let fieldMax = Math.floor(maxChars * 0.7);
      // JSON escaping (newlines, quotes, colour codes) can make a field longer
      // than its text, so shrink the fields until the whole result fits.
      for (let attempt = 0; attempt < 3; attempt++) {
        const o = shortenFields(output as Record<string, unknown>, fieldMax);
        if (!o) break;
        again = JSON.stringify(o);
        if (again.length <= maxChars) return o;
        fieldMax = Math.floor((fieldMax * maxChars * 0.95) / again.length);
      }
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
// assistant. `droppedTurns` counts the messages left out.
export function packChatHistoryInfo(
  messages: { role: string; content: string }[],
  opts?: { maxTurns?: number; maxChars?: number },
): { messages: HistoryMsg[]; droppedTurns: number } {
  const maxTurns = opts?.maxTurns ?? HISTORY_MAX_TURNS;
  const maxChars = opts?.maxChars ?? HISTORY_MSG_MAX_CHARS;
  const textTurns = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const recent = textTurns.slice(-maxTurns);
  return {
    messages: recent.map((m) => ({
      role: m.role,
      content: truncateText(m.content || "", maxChars),
    })),
    droppedTurns: textTurns.length - recent.length,
  };
}

export function packChatHistory(
  messages: { role: string; content: string }[],
  opts?: { maxTurns?: number; maxChars?: number },
): HistoryMsg[] {
  return packChatHistoryInfo(messages, opts).messages;
}
