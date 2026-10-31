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
