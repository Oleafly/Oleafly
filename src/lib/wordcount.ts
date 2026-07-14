export function countWords(tex: string): {
  words: number;
  characters: number;
  lines: number;
} {
  let t = tex.replace(/(^|[^\\])%.*$/gm, "$1");
  t = t.replace(/\\(begin|end)\s*\{[^}]*\}/g, " ");
  t = t.replace(/\\[a-zA-Z]+\*?\s*\{([^}]*)\}/g, "$1");
  t = t.replace(/\\[a-zA-Z]+\*?/g, " ").replace(/[{}$]/g, " ");
  const words = t.split(/\s+/).filter(Boolean);
  return {
    words: words.length,
    characters: tex.length,
    lines: tex.split(/\n/).length,
  };
}
