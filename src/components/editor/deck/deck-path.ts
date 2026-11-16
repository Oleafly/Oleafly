const DECK_FILE = /(?:^|\/)slides\/[^/]+\/index\.tsx$/u;

export function isDeckPath(path: string | null | undefined): boolean {
  return !!path && DECK_FILE.test(path);
}
