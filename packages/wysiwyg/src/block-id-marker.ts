const ID = "[A-Za-z0-9-]{1,64}";
const VALID_ID = new RegExp(`^${ID}$`, "u");
const TRAILING_ID = new RegExp(`\\s+\\^(${ID})[ \\t]*$`, "u");
const LONE_ID = new RegExp(`^\\s*\\^(${ID})[ \\t]*$`, "u");

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && VALID_ID.test(value);
}

export function loneBlockId(line: string): string | null {
  return LONE_ID.exec(line)?.[1] ?? null;
}

export function trailingBlockId(text: string): { id: string; at: number } | null {
  const match = TRAILING_ID.exec(text);
  return match && match.index > 0 ? { id: match[1], at: match.index } : null;
}

export function withoutBlockId(text: string): string {
  const found = trailingBlockId(text);
  return found ? text.slice(0, found.at) : text;
}
