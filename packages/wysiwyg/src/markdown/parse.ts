import type { AnyExtension, JSONContent } from "@tiptap/core";
import { splitMarkdownFrontMatter } from "../front-matter";
import { WYSIWYG_EXTENSIONS } from "../schema";
import { markdownEngine, markdownToDoc } from "./engine";
import {
  normalizePreservedRanges,
  protectInlineSources,
  restoreInlineSources,
  restoreInlineText,
  type PreservedInlineRange,
} from "../preserve-inline";
import {
  markdownPreservedRanges,
  planMarkdownUnits,
  type MarkdownSourceLayout,
} from "./source-layout";

export { splitMarkdownFrontMatter, type MarkdownFrontMatterSplit } from "../front-matter";

export type PreservedMarkdownInlineRange = PreservedInlineRange;

export interface ParseMarkdownBodyOptions {
  preservedInlineRanges?: readonly PreservedMarkdownInlineRange[];
  extensions?: AnyExtension[];
}

function isBoundary(node: JSONContent, sentinel: string): boolean {
  return (
    node.type === "paragraph" &&
    node.content?.length === 1 &&
    node.content[0].type === "text" &&
    node.content[0].text === sentinel &&
    !node.content[0].marks?.length
  );
}

function splitAtBoundaries(nodes: readonly JSONContent[], sentinel: string): JSONContent[][] {
  const groups: JSONContent[][] = [[]];
  for (const node of nodes) {
    if (isBoundary(node, sentinel)) groups.push([]);
    else groups.at(-1)?.push(node);
  }
  return groups;
}

export function parseMarkdownBody(
  source: string,
  options: ParseMarkdownBodyOptions = {},
): { doc: JSONContent; frontmatter: string; separator: string; layout: MarkdownSourceLayout | null } {
  const { frontmatter, separator, body } = splitMarkdownFrontMatter(source);
  const bodyOffset = source.length - body.length;
  const callerRanges = options.preservedInlineRanges ?? [];
  const markdownRanges = markdownPreservedRanges(source, bodyOffset).filter(
    (preserved) => !callerRanges.some((range) => range.from < preserved.to && preserved.from < range.to),
  );
  const ranges = normalizePreservedRanges(source, bodyOffset, [
    ...callerRanges,
    ...markdownRanges,
  ]);
  const { protectedContent, tokenPrefix, sources } = protectInlineSources(
    body,
    ranges,
  );

  const editor = markdownEngine(options.extensions ?? WYSIWYG_EXTENSIONS);
  const plan = planMarkdownUnits(
    protectedContent,
    editor.storage.markdown.parser.md.parse(protectedContent, {}),
  );
  let parsed: JSONContent | null = null;
  let counts: number[] | null = null;
  if (plan && plan.units.length > 1) {
    let sentinel = "OLEAFLYXBLOCKBOUNDARY";
    while (protectedContent.includes(sentinel)) sentinel += "X";
    const json = markdownToDoc(editor, plan.units.join(`\n\n${sentinel}\n\n`));
    const groups = splitAtBoundaries(json.content ?? [], sentinel);
    if (groups.length === plan.units.length) {
      parsed = { ...json, content: groups.flat() };
      counts = groups.map((group) => group.length);
    }
  }
  if (!parsed) {
    parsed = markdownToDoc(editor, protectedContent);
    if (plan?.units.length === 1) counts = [parsed.content?.length ?? 0];
  }
  const last = parsed.content?.at(-1);
  if (counts?.at(-1) && last?.type === "paragraph" && !last.content?.length) {
    counts[counts.length - 1]--;
  }
  const restore = (text: string) => restoreInlineText(text, tokenPrefix, sources);
  const layout: MarkdownSourceLayout | null =
    plan && counts
      ? {
          units: plan.units.map((unit, index) => ({
            source: restore(unit),
            nodes: counts[index],
          })),
          separators: plan.separators.map(restore),
          trailing: restore(plan.trailing),
        }
      : null;
  const doc = restoreInlineSources(parsed, tokenPrefix, sources);

  return { doc, frontmatter, separator, layout };
}

function isEmptyParagraph(node: JSONContent | undefined): boolean {
  return node?.type === "paragraph" && !node.content?.length;
}

/**
 * Which top-level block of `parseMarkdownBody(source, options).doc` holds a
 * source offset, and how many blocks the document has, not counting an empty
 * paragraph at the end. Null when the source has no block layout to map
 * through.
 */
export function markdownBlockAt(
  source: string,
  offset: number,
  options: ParseMarkdownBodyOptions = {},
): { index: number; count: number } | null {
  const { doc, layout } = parseMarkdownBody(source, options);
  const nodes = doc.content ?? [];
  const count = isEmptyParagraph(nodes.at(-1)) ? nodes.length - 1 : nodes.length;
  if (!layout || count === 0) return null;
  const mapped =
    layout.units.reduce((sum, unit) => sum + unit.source.length, 0) +
    layout.separators.reduce((sum, separator) => sum + separator.length, 0) +
    layout.trailing.length;
  // Front matter and blank lines before the first block are not in the layout.
  let start = source.length - mapped;
  let node = 0;
  for (const [index, unit] of layout.units.entries()) {
    const end = start + unit.source.length + (layout.separators[index]?.length ?? 0);
    if (offset < end || index === layout.units.length - 1) {
      return { index: Math.min(node, count - 1), count };
    }
    node += unit.nodes;
    start = end;
  }
  return null;
}
