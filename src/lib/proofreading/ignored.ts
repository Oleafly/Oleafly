export const BUILTIN_PROOFREADING_WORDS = new Set([
  "api",
  "argv",
  "backend",
  "begin",
  "bibtex",
  "boolean",
  "config",
  "end",
  "enum",
  "filename",
  "frontend",
  "href",
  "ieee",
  "inline",
  "latex",
  "localhost",
  "luatex",
  "pdf",
  "pdflatex",
  "stdin",
  "stdout",
  "string",
  "tectonic",
  "tex",
  "url",
  "xelatex",
  "xetex",
]);

export function isSessionIgnoredWord(word: string): boolean {
  const normalized = word
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
  if (BUILTIN_PROOFREADING_WORDS.has(normalized)) return true;
  if (/\d/u.test(word)) return true;
  return (
    word.length >= 2 &&
    word === word.toLocaleUpperCase("en-US") &&
    /\p{Lu}/u.test(word)
  );
}
