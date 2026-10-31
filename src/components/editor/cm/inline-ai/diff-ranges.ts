import { diffWords } from "@/lib/diff-words";

export type DecoSpan = {
  from: number;
  to: number;
  kind: "del" | "add";
  text?: string;
};

export function buildDecoSpans(original: string, proposed: string, base: number): DecoSpan[] {
  const spans: DecoSpan[] = [];
  let cursor = base;
  for (const t of diffWords(original, proposed)) {
    if (t.kind === "same") {
      cursor += t.text.length;
    } else if (t.kind === "del") {
      spans.push({ from: cursor, to: cursor + t.text.length, kind: "del" });
      cursor += t.text.length;
    } else {
      spans.push({ from: cursor, to: cursor, kind: "add", text: t.text });
    }
  }
  return spans;
}
