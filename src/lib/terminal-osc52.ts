// OSC 52 lets a program in the terminal (tmux, vim, an SSH session) put text
// on the clipboard. Only writes are supported: reading the clipboard back
// (`?`) would let any program see what the user copied.

/** Largest decoded payload accepted. */
export const OSC52_MAX_BYTES = 1024 * 1024;

export type Osc52Request = { kind: "write"; text: string } | { kind: "query" } | { kind: "invalid" };

const INVALID: Osc52Request = { kind: "invalid" };
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Base64 length of OSC52_MAX_BYTES, plus padding slack. */
const MAX_ENCODED = Math.ceil(OSC52_MAX_BYTES / 3) * 4 + 4;

/** Parses the text after `52;`: a selection list, `;`, then base64 or `?`. */
export function parseOsc52(data: string): Osc52Request {
  const separator = data.indexOf(";");
  if (separator < 0) return INVALID;
  const payload = data.slice(separator + 1);
  if (payload === "?") return { kind: "query" };
  if (payload.length > MAX_ENCODED) return INVALID;
  const compact = payload.replace(/\s+/g, "");
  if (!BASE64.test(compact)) return INVALID;
  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    return INVALID;
  }
  if (binary.length > OSC52_MAX_BYTES) return INVALID;
  const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
  return { kind: "write", text: new TextDecoder().decode(bytes) };
}
