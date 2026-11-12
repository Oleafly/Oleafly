import { isBlockId, loneBlockId, withoutBlockId } from "@oleafly/wysiwyg/block-id-marker";
import { fencedLines } from "@/lib/code-fences";

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 6;
const PREVIEW_CHARS = 48;

export function blockOfFragment(fragment: string | null | undefined): string | null {
  if (!fragment?.startsWith("^")) return null;
  const id = fragment.slice(1);
  return isBlockId(id) ? id : null;
}

export function blockFragment(id: string): string {
  return `^${id}`;
}

export function newBlockId(taken: ReadonlySet<string> = new Set(), random: () => number = Math.random): string {
  for (;;) {
    let id = "";
    for (let index = 0; index < ID_LENGTH; index++) id += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
    if (!taken.has(id)) return id;
  }
}

export function shortText(text: string, limit = PREVIEW_CHARS): string {
  const flat = text.replaceAll(/\s+/gu, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

export function stripBlockIdMarkers(markdown: string): string {
  if (!markdown.includes("^")) return markdown;
  const kept: string[] = [];
  for (const line of fencedLines(markdown)) {
    if (line.fenced || !line.text.includes("^")) kept.push(line.text);
    else if (loneBlockId(line.text) === null) kept.push(withoutBlockId(line.text));
  }
  return kept.join("\n");
}

export function textFragment(text: string): string {
  return `~${text}`;
}

export function textOfFragment(fragment: string | null | undefined): string | null {
  if (!fragment?.startsWith("~")) return null;
  const text = fragment.slice(1).replaceAll(/^…|…$/gu, "").replaceAll(/\s+/gu, " ").trim();
  return text || null;
}
