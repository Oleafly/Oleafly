export const TYPST_STYLE_CALLS: ReadonlySet<string> = new Set([
  "underline",
  "strike",
  "overline",
  "highlight",
  "smallcaps",
  "emph",
  "strong",
  "sub",
  "super",
  "text",
  "upper",
  "lower",
]);

// Every callee the Typst Visual builder renders itself. A bare call to one of these keeps
// its built-in widget even when a form shares the name.
export const BUILTIN_DISPATCH_NAMES: ReadonlySet<string> = new Set([
  "figure",
  "table",
  "image",
  "link",
  "footnote",
  "cite",
  "ref",
  ...TYPST_STYLE_CALLS,
]);
