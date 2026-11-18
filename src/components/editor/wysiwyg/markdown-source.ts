import { scanMathExpressions, type MathExpression } from "@oleafly/editor/math-source";
import { splitMarkdownFrontMatter } from "@oleafly/wysiwyg/front-matter";

const BLANK_LINE = /\n[ \t]*\n/u;
const LATEX_BODY = /[\\^_{}=+]/u;

function closedMath(source: string, pandoc: boolean): MathExpression[] {
  return scanMathExpressions(source, {
    format: "markdown",
    pandoc,
    from: source.length - splitMarkdownFrontMatter(source).body.length,
  }).filter((expression) => expression.status === "complete");
}

export function markdownMathRanges(source: string) {
  return closedMath(source, true).map(({ from, to }) => ({ from, to }));
}

function ownsLines(source: string, from: number, to: number): boolean {
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = source.indexOf("\n", to);
  return /^[ \t>]*$/u.test(source.slice(lineStart, from)) && /^[ \t]*$/u.test(source.slice(to, lineEnd < 0 ? source.length : lineEnd));
}

function bracketMath(source: string, expression: MathExpression): boolean {
  if (BLANK_LINE.test(expression.source)) return false;
  if (expression.delimiter === "\\(") return true;
  return expression.delimiter === "\\[" && LATEX_BODY.test(expression.body) && ownsLines(source, expression.from, expression.to);
}

export function noteMathRanges(source: string) {
  const brackets = closedMath(source, false).filter((expression) => bracketMath(source, expression));
  const dollars = markdownMathRanges(source).filter((range) => !brackets.some((math) => math.from < range.to && range.from < math.to));
  return [...dollars, ...brackets.map(({ from, to }) => ({ from, to }))].sort((left, right) => left.from - right.from);
}
