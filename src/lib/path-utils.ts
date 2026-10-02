export function isSeparator(char: string | undefined): boolean {
  return char === "/" || char === "\\";
}

function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

export function basename(path: string): string {
  return path.slice(lastSeparator(path) + 1);
}

export function dirname(path: string): string {
  const index = lastSeparator(path);
  return index < 0 ? "" : path.slice(0, index);
}
