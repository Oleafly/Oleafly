import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "../schema";
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

const FRONTMATTER_RE = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/;

export type PreservedMarkdownInlineRange = PreservedInlineRange;

export interface ParseMarkdownBodyOptions {
  /**
   * Absolute source ranges that Markdown must not consume or normalize. The
   * caller uses this for exact math delimiters after syntax-aware scanning.
   */
  preservedInlineRanges?: readonly PreservedMarkdownInlineRange[];
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
): { doc: JSONContent; frontmatter: string; layout: MarkdownSourceLayout | null } {
  const match = FRONTMATTER_RE.exec(source);
  const frontmatter = match ? match[1] : "";
  const body = match ? source.slice(match[0].length) : source;
  const bodyOffset = match?.[0].length ?? 0;
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

  const editor = new Editor({
    element: document.createElement("div"),
    extensions: WYSIWYG_EXTENSIONS,
    content: "",
  });
  const plan = planMarkdownUnits(
    protectedContent,
    editor.storage.markdown.parser.md.parse(protectedContent, {}),
  );
  let parsed: JSONContent | null = null;
  let counts: number[] | null = null;
  if (plan && plan.units.length > 1) {
    let sentinel = "OLEAFLYXBLOCKBOUNDARY";
    while (protectedContent.includes(sentinel)) sentinel += "X";
    editor.commands.setContent(plan.units.join(`\n\n${sentinel}\n\n`));
    const json = editor.getJSON();
    const groups = splitAtBoundaries(json.content ?? [], sentinel);
    if (groups.length === plan.units.length) {
      parsed = { ...json, content: groups.flat() };
      counts = groups.map((group) => group.length);
    }
  }
  if (!parsed) {
    editor.commands.setContent(protectedContent);
    parsed = editor.getJSON();
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
  editor.destroy();

  return { doc, frontmatter, layout };
}
