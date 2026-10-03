import { sha1Prefix } from "./png";

export function fencedCode(code: string): string {
  return code.replaceAll("\r\n", "\n").replace(/^(?:[ \t]*\n)+/, "").replace(/\s+$/, "");
}

export function mermaidCodeFence(code: string): string {
  const body = fencedCode(code);
  let longest = 2;
  for (const line of body.split("\n")) {
    const match = /^\s*(`{3,})/.exec(line);
    if (match) longest = Math.max(longest, match[1].length);
  }
  const fence = "`".repeat(longest + 1);
  return `${fence}mermaid\n${body}\n${fence}`;
}

export async function mermaidFigurePath(code: string): Promise<string> {
  return `figures/mermaid-${await sha1Prefix(fencedCode(code))}.png`;
}
