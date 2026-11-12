import { scanMathExpressions } from "@oleafly/editor/math-source";
import { splitMarkdownFrontMatter } from "@oleafly/wysiwyg/front-matter";

export function markdownMathRanges(source: string) {
  return scanMathExpressions(source, {
    format: "markdown",
    from: source.length - splitMarkdownFrontMatter(source).body.length,
  }).map(({ from, to }) => ({ from, to }));
}
