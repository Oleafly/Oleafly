import { logError } from "@/lib/log";

export interface ComposerContextItem {
  id: string;
  kind: string;
  refId: string;
  label: string;
}

export interface ExpandedComposerContext {
  refId: string;
  path: string | null;
  text: string;
}

export interface ComposerContextKind {
  expand(projectId: string, refIds: readonly string[]): Promise<readonly ExpandedComposerContext[]>;
  sent?(projectId: string, refIds: readonly string[]): void;
}

export interface ExpandedComposerContextItem extends ExpandedComposerContext {
  item: ComposerContextItem;
}

const kinds = new Map<string, ComposerContextKind>();

export function registerComposerContextKind(kind: string, handler: ComposerContextKind): () => void {
  kinds.set(kind, handler);
  return () => {
    if (kinds.get(kind) === handler) kinds.delete(kind);
  };
}

export function sameComposerContext(left: ComposerContextItem, right: ComposerContextItem): boolean {
  return left.kind === right.kind && left.refId === right.refId;
}

function byKind(items: readonly ComposerContextItem[]): Map<string, ComposerContextItem[]> {
  const groups = new Map<string, ComposerContextItem[]>();
  for (const item of items) {
    const group = groups.get(item.kind);
    if (group) group.push(item);
    else groups.set(item.kind, [item]);
  }
  return groups;
}

export async function expandComposerContext(
  projectId: string,
  items: readonly ComposerContextItem[],
): Promise<ExpandedComposerContextItem[]> {
  if (items.length === 0) return [];
  const groups = [...byKind(items)];
  const expanded = await Promise.all(groups.map(async ([kind, group]) => {
    const handler = kinds.get(kind);
    if (!handler) return new Map<string, ExpandedComposerContext>();
    const results = await handler.expand(projectId, group.map((item) => item.refId));
    return new Map(results.map((result) => [result.refId, result]));
  }));
  const found = new Map(groups.map(([kind], index) => [kind, expanded[index]]));
  const out: ExpandedComposerContextItem[] = [];
  for (const item of items) {
    const result = found.get(item.kind)?.get(item.refId);
    if (result) out.push({ ...result, item });
  }
  return out;
}

export function markComposerContextSent(projectId: string, items: readonly ComposerContextItem[]): void {
  for (const [kind, group] of byKind(items)) {
    const handler = kinds.get(kind);
    if (!handler?.sent) continue;
    try {
      handler.sent(projectId, group.map((item) => item.refId));
    } catch (error) {
      void logError("mark composer context sent", error);
    }
  }
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

export function composerContextBlock(expanded: readonly ExpandedComposerContextItem[]): string {
  return expanded
    .map((entry) => {
      const heading = entry.path ? `${entry.item.label} (${entry.path})` : entry.item.label;
      const fence = "`".repeat(Math.max(3, longestBacktickRun(entry.text) + 1));
      return `${heading}:\n${fence}\n${entry.text}\n${fence}`;
    })
    .join("\n\n");
}

export function withComposerContext(text: string, expanded: readonly ExpandedComposerContextItem[]): string {
  const block = composerContextBlock(expanded);
  if (!block) return text;
  return text.trim() ? `${text}\n\n${block}` : block;
}
