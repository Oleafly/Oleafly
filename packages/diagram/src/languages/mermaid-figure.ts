const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

export function figureHash(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * FNV_PRIME);
  }
  return hash.toString(16).padStart(16, "0");
}

export function fencedCode(code: string): string {
  return code.replaceAll("\r\n", "\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd();
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

export function mermaidFigurePath(code: string): string {
  return `figures/mermaid-${figureHash(fencedCode(code))}.png`;
}
