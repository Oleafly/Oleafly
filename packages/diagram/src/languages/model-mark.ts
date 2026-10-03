import type { DiagramModel } from "@oleafly/latex";

const MARK = "oleafly-diagram-v1:";

function encode(model: DiagramModel): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(model))) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

function decode(text: string): DiagramModel | null {
  try {
    const bytes = Uint8Array.from(atob(text), (character) => character.codePointAt(0) ?? 0);
    const model = JSON.parse(new TextDecoder().decode(bytes)) as DiagramModel;
    return model?.version === 1 && Array.isArray(model.nodes) && Array.isArray(model.edges) ? model : null;
  } catch {
    return null;
  }
}

export function modelMarkLine(comment: string, model: DiagramModel): string {
  return `${comment} ${MARK} ${encode(model)}`;
}

function markIndex(line: string, comment: string): number {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith(comment)) return -1;
  const rest = trimmed.slice(comment.length).trimStart();
  return rest.startsWith(MARK) ? line.length - rest.length + MARK.length : -1;
}

export function readModelMark(source: string, comment: string): DiagramModel | null {
  for (const line of source.split(/\r\n|\r|\n/)) {
    const index = markIndex(line, comment);
    if (index >= 0) return decode(line.slice(index).trim());
  }
  return null;
}

export function withoutModelMark(source: string, comment: string): string {
  return source
    .split(/\r\n|\r|\n/)
    .filter((line) => markIndex(line, comment) < 0)
    .join("\n");
}
