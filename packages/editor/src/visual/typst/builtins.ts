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
