// Comment characters are replaced with spaces (not deleted) so every character
// offset stays put and position-based Finding reporting remains correct.
//
// This duplicates the maskComments helper in src/lib/index/parse-file.ts on
// purpose: preflight must not import from src/lib/index/.
export function maskComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== "%") continue;
        let b = 0;
        for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) b++;
        if (b % 2 === 0) return line.slice(0, i) + " ".repeat(line.length - i);
      }
      return line;
    })
    .join("\n");
}
