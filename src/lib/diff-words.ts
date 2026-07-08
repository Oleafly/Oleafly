export type WordDiffToken = { kind: "same" | "del" | "add"; text: string };

/** Split into words while keeping trailing whitespace glued to each word so
 * concatenating tokens reproduces the source exactly. */
function tokenize(s: string): string[] {
  return s.match(/\S+\s*|\s+/g) ?? [];
}

/**
 * Word-level diff between two strings via LCS. The returned tokens, when
 * concatenated, reproduce `oldText` (same + del) and `newText` (same + add).
 */
export function diffWords(oldText: string, newText: string): WordDiffToken[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: WordDiffToken[] = [];
  const push = (kind: WordDiffToken["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return out;
}
