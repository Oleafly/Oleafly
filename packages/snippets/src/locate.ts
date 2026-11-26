import { parseJsoncDocument } from "./jsonc";

export function lineAt(text: string, offset: number): number {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let index = text.indexOf("\n"); index >= 0 && index < end; index = text.indexOf("\n", index + 1)) line += 1;
  return line;
}

export function idLine(text: string, id: string): number {
  const document = parseJsoncDocument(text);
  if ("error" in document) return 1;
  const offset = document.keys.get(id);
  return offset === undefined ? 1 : lineAt(text, offset);
}
