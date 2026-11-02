import { scanMathExpressions } from "@oleafly/editor/math-source";

const MARKDOWN_FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/u;

/** The math the Visual editor keeps as written when it loads Markdown. */
export function markdownMathRanges(source: string) {
  const bodyOffset = MARKDOWN_FRONTMATTER_RE.exec(source)?.[0].length ?? 0;
  return scanMathExpressions(source, {
    format: "markdown",
    from: bodyOffset,
  }).map(({ from, to }) => ({ from, to }));
}
