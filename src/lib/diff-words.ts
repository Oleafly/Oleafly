import { commonAffixBounds, myersEditScript } from "./myers-diff";

export type WordDiffToken = { kind: "same" | "del" | "add"; text: string };

export const WORD_DIFF_WORK_LIMIT = 500_000;

const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

export function wordsOf(s: string): string[] {
  const tokens = s.match(/\S+\s*|\s+/g) ?? [];
  if (!segmenter || !UNSPACED.test(s)) return tokens;
  return tokens.flatMap((token) =>
    UNSPACED.test(token) ? Array.from(segmenter.segment(token), (part) => part.segment) : [token],
  );
}

export function diffWords(oldText: string, newText: string): WordDiffToken[] {
  const a = wordsOf(oldText);
  const b = wordsOf(newText);

  const out: WordDiffToken[] = [];
  const push = (kind: WordDiffToken["kind"], text: string) => {
    if (!text) return;
    const last = out.at(-1);
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };

  const bounds = commonAffixBounds(a, b);
  const script = myersEditScript(
    a.slice(bounds.prefix, bounds.oldEnd),
    b.slice(bounds.prefix, bounds.newEnd),
    WORD_DIFF_WORK_LIMIT,
  );

  if (!script) {
    push("del", oldText);
    push("add", newText);
    return out;
  }

  push("same", a.slice(0, bounds.prefix).join(""));
  for (const edit of script) {
    if (edit.kind === "add") {
      const start = bounds.prefix + edit.newStart;
      push("add", b.slice(start, start + edit.length).join(""));
    } else {
      const start = bounds.prefix + edit.oldStart;
      push(edit.kind, a.slice(start, start + edit.length).join(""));
    }
  }
  push("same", a.slice(bounds.oldEnd).join(""));

  return out;
}
