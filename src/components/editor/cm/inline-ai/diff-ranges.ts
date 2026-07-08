import { diffWords } from "@/lib/diff-words";

export type DecoSpan = {
  from: number;
  to: number;
  kind: "del" | "add";
  /** Preview text for `add` spans (zero-width inserts). */
  text?: string;
};

/**
 * Turn a word diff into absolute document ranges for decoration.
 *
 * `same`/`del` tokens consume characters of the original text (which is still in
 * the document during review), advancing a cursor from `base`. `del` tokens
 * become marks over that range. `add` tokens are zero-width insertion points
 * carrying the preview text, anchored at the current cursor.
 */
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
