import type { AnyExtension, JSONContent } from "@tiptap/core";
import { splitMarkdownFrontMatter } from "../front-matter";
import { WYSIWYG_EXTENSIONS } from "../schema";
import { disputedEmphasisRanges } from "./emphasis-disputes";
import { markdownEngine, markdownToDoc, markdownTokens, withMarkdownParseContext } from "./engine";
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

const FOOTNOTE_REFERENCE = /^\[\^[^\]\s[]+\]$/u;
const TAB_STAND_INS = ["\u2008", "\u2007", "\u2009", "\u200a", "\u2006", "\u2005", "\u2004"];

function definitionLead(tokenPrefix: string, sources: readonly string[]): RegExp | null {
  const references = sources.flatMap((source, index) => (FOOTNOTE_REFERENCE.test(source) ? [index] : []));
  return references.length > 0 ? new RegExp(`^${tokenPrefix}(?:${references.join("|")})X:`, "u") : null;
}

function prepare(source: string, options: ParseMarkdownBodyOptions) {
  const { frontmatter, separator, body } = splitMarkdownFrontMatter(source);
  const bodyOffset = source.length - body.length;
  const callerRanges = options.preservedInlineRanges ?? [];
  const editor = markdownEngine(options.extensions ?? WYSIWYG_EXTENSIONS);
  const projectFile = !editor.schema.nodes.callout;
  const markdownRanges = markdownPreservedRanges(source, bodyOffset, projectFile).filter(
    (preserved) => !callerRanges.some((range) => range.from < preserved.to && preserved.from < range.to),
  );
  const emphasisRanges = projectFile ? disputedEmphasisRanges(source, bodyOffset, [...callerRanges, ...markdownRanges]) : [];
  const ranges = normalizePreservedRanges(source, bodyOffset, [
    ...callerRanges,
    ...markdownRanges,
    ...emphasisRanges,
  ]);
  const { protectedContent, tokenPrefix, sources } = protectInlineSources(
    body,
    ranges,
  );
  const env: { references?: Record<string, { href: string; title: string }> } = {};
  const context = {
    definitionLead: definitionLead(tokenPrefix, sources),
    tab: body.includes("\t") ? (TAB_STAND_INS.find((standIn) => !body.includes(standIn)) ?? null) : null,
  };
  const plan = withMarkdownParseContext(context, () =>
    planMarkdownUnits(protectedContent, markdownTokens(editor, protectedContent, env)),
  );
  const restore = (text: string) => restoreInlineText(text, tokenPrefix, sources);
  const toDoc = (markdown: string) => withMarkdownParseContext(context, () => markdownToDoc(editor, markdown));
  return { frontmatter, separator, bodyOffset, protectedContent, tokenPrefix, sources, plan, restore, env, toDoc, tab: context.tab };
}

export interface MarkdownUnits {
  bodyFrom: number;
  spans: { from: number; to: number }[];
  references: Map<string, { href: string; title: string }>;
}

export function markdownUnits(source: string, options: ParseMarkdownBodyOptions = {}): MarkdownUnits {
  const { bodyOffset, plan, restore, env } = prepare(source, options);
  const references = new Map(
    Object.entries(env.references ?? {}).map(([label, { href, title }]) => [restore(label), { href: restore(href), title: restore(title) }]),
  );
  if (!plan) return { bodyFrom: bodyOffset, spans: [], references };
  let at = bodyOffset + restore(plan.leading).length;
  const spans = plan.units.map((unit, index) => {
    const from = at;
    at += restore(unit).length;
    const span = { from, to: at };
    at += restore(plan.separators[index] ?? "").length;
    return span;
  });
  return { bodyFrom: bodyOffset, spans, references };
}

export function parseMarkdownBody(
  source: string,
  options: ParseMarkdownBodyOptions = {},
): { doc: JSONContent; frontmatter: string; separator: string; layout: MarkdownSourceLayout | null } {
  const { frontmatter, separator, protectedContent, tokenPrefix, sources, plan, restore, toDoc, tab } = prepare(source, options);
  let parsed: JSONContent | null = null;
  let counts: number[] | null = null;
  if (plan && plan.units.length > 1) {
    let sentinel = "OLEAFLYXBLOCKBOUNDARY";
    while (protectedContent.includes(sentinel)) sentinel += "X";
    const json = toDoc(plan.units.join(`\n\n${sentinel}\n\n`));
    const groups = splitAtBoundaries(json.content ?? [], sentinel);
    if (groups.length === plan.units.length) {
      parsed = { ...json, content: groups.flat() };
      counts = groups.map((group) => group.length);
    }
  }
  if (!parsed) {
    parsed = toDoc(protectedContent);
    if (plan?.units.length === 1) counts = [parsed.content?.length ?? 0];
  }
  const last = parsed.content?.at(-1);
  if (counts?.at(-1) && last?.type === "paragraph" && !last.content?.length) {
    counts[counts.length - 1]--;
  }
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
  const doc = restoreInlineSources(parsed, tokenPrefix, sources, tab);

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
