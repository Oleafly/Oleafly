import type { SnippetLanguage } from "@oleafly/snippets";

const EXTENSIONS: ReadonlyArray<readonly [RegExp, SnippetLanguage]> = [
  [/\.(?:tex|latex|sty|cls|ltx)$/u, "latex"],
  [/\.typ$/u, "typst"],
  [/\.(?:md|markdown|qmd|rmd)$/u, "markdown"],
  [/\.bib$/u, "bibtex"],
];

export function snippetLanguageForPath(path: string | null): SnippetLanguage | null {
  const lower = path?.toLowerCase() ?? "";
  return EXTENSIONS.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
}
