import { Extension, type AnyExtension } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Mapping, ReplaceAroundStep, ReplaceStep, type MapResult } from "@tiptap/pm/transform";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { isBlockId, loneBlockId, trailingBlockId } from "./block-id-marker";
import { markdownEngine } from "./markdown/engine";

type MarkdownIt = Parameters<NonNullable<NonNullable<MarkdownNodeSpec["parse"]>["setup"]>>[0];
type MdToken = ReturnType<MarkdownIt["parse"]>[number];

interface BlockIdOptions {
  inlineTypes: readonly string[];
  trailingTypes: readonly string[];
}

const BLOCK_ID_ATTRIBUTE = "data-block-id";
const INLINE_OWNERS = new Set(["paragraph_open", "heading_open"]);
const TRAILING_OWNERS = new Set(["table_open", "blockquote_open", "bullet_list_open", "ordered_list_open"]);
const SELF_CONTAINED = new Set(["fence", "code_block"]);
const blockIdKey = new PluginKey("blockIds");
const withRule = new WeakSet<MarkdownIt>();

export function blockIdOf(node: ProseMirrorNode): string | null {
  const id: unknown = node.attrs.blockId;
  return isBlockId(id) ? id : null;
}

function openOf(tokens: readonly MdToken[], close: number): number {
  const level = tokens[close].level;
  for (let index = close - 1; index >= 0; index--) {
    if (tokens[index].level === level && tokens[index].nesting === 1) return index;
  }
  return -1;
}

function previousBlock(tokens: readonly MdToken[], before: number): MdToken | null {
  const token = tokens[before];
  if (!token) return null;
  if (SELF_CONTAINED.has(token.type)) return token;
  if (token.nesting !== -1) return null;
  const open = tokens[openOf(tokens, before)];
  return open && TRAILING_OWNERS.has(open.type) ? open : null;
}

function inlineOwner(tokens: readonly MdToken[], open: number): MdToken {
  const parent = tokens[open - 1];
  return tokens[open].type === "paragraph_open" && parent?.type === "list_item_open" ? parent : tokens[open];
}

function attachLoneId(tokens: MdToken[], index: number, id: string): boolean {
  const target = previousBlock(tokens, index - 2);
  if (!target || target.attrGet(BLOCK_ID_ATTRIBUTE)) return false;
  target.attrSet(BLOCK_ID_ATTRIBUTE, id);
  const end = tokens[index - 1].map?.[1];
  if (target.map && end !== undefined) target.map = [target.map[0], end];
  tokens.splice(index - 1, 3);
  return true;
}

function markBlockIds(tokens: MdToken[]): void {
  for (let index = 1; index < tokens.length; index++) {
    const inline = tokens[index];
    const open = tokens[index - 1];
    if (inline.type !== "inline" || !INLINE_OWNERS.has(open.type)) continue;
    const lone = open.type === "paragraph_open" ? loneBlockId(inline.content) : null;
    if (lone) {
      if (attachLoneId(tokens, index, lone)) index -= 2;
      continue;
    }
    const trailing = trailingBlockId(inline.content);
    if (!trailing) continue;
    const owner = inlineOwner(tokens, index - 1);
    if (owner.attrGet(BLOCK_ID_ATTRIBUTE)) continue;
    owner.attrSet(BLOCK_ID_ATTRIBUTE, trailing.id);
    inline.content = inline.content.slice(0, trailing.at);
  }
}

function setupBlockIds(md: MarkdownIt): void {
  if (withRule.has(md)) return;
  withRule.add(md);
  md.core.ruler.after("block", "block_ids", (state) => {
    markBlockIds(state.tokens);
    return true;
  });
}

function withMarker(node: ProseMirrorNode, id: string, schema: Schema): ProseMirrorNode {
  if (node.content.size === 0) return node;
  return node.copy(node.content.append(Fragment.from(schema.text(` ^${id}`))));
}

function markedItem(item: ProseMirrorNode, id: string, schema: Schema): ProseMirrorNode {
  const first = item.firstChild;
  if (!first?.isTextblock) return item;
  return item.copy(item.content.replaceChild(0, withMarker(first, id, schema)));
}

function markerParagraph(id: string, schema: Schema): ProseMirrorNode | null {
  return schema.nodes.paragraph?.create(null, schema.text(`^${id}`)) ?? null;
}

function withBlockIdMarkers(node: ProseMirrorNode, options: BlockIdOptions): ProseMirrorNode {
  const { schema } = node.type;
  const inline = new Set(options.inlineTypes);
  const trailing = new Set(options.trailingTypes);
  const visit = (current: ProseMirrorNode): ProseMirrorNode => {
    let next = current;
    if (!current.isTextblock && current.childCount > 0) {
      const children: ProseMirrorNode[] = [];
      let changed = false;
      current.forEach((child) => {
        const visited = visit(child);
        changed ||= visited !== child;
        children.push(visited);
        const id = trailing.has(child.type.name) ? blockIdOf(child) : null;
        const marker = id ? markerParagraph(id, schema) : null;
        if (marker) {
          children.push(marker);
          changed = true;
        }
      });
      if (changed) next = current.copy(Fragment.from(children));
    }
    const id = inline.has(current.type.name) ? blockIdOf(current) : null;
    if (!id) return next;
    return next.isTextblock ? withMarker(next, id, schema) : markedItem(next, id, schema);
  };
  return visit(node);
}

interface Range {
  from: number;
  to: number;
  carriesId: boolean;
}

interface Owner {
  pos: number;
  node: ProseMirrorNode;
}

function insertedRanges(tr: Transaction): Range[] {
  const ranges: Range[] = [];
  tr.steps.forEach((step, index) => {
    if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep) || !step.slice.content.firstChild?.isBlock) return;
    let carriesId = false;
    step.slice.content.descendants((node) => {
      carriesId ||= blockIdOf(node) !== null;
      return !carriesId;
    });
    const after = tr.mapping.slice(index + 1);
    ranges.push({ from: after.map(step.from, -1), to: after.map(step.from + step.slice.size, 1), carriesId });
  });
  return ranges;
}

function joinsBlocks(tr: Transaction): boolean {
  return tr.steps.some((step, index) => {
    if (step instanceof ReplaceAroundStep) return true;
    if (!(step instanceof ReplaceStep) || step.from === step.to) return false;
    const doc = tr.docs[index];
    return !doc.resolve(step.from).sameParent(doc.resolve(step.to));
  });
}

function within(ranges: readonly Range[], pos: number, carryingId: boolean): boolean {
  return ranges.some((range) => (!carryingId || range.carriesId) && pos >= range.from && pos < range.to);
}

function idOwners(doc: ProseMirrorNode): Map<string, Owner[]> {
  const owners = new Map<string, Owner[]>();
  doc.descendants((node, pos) => {
    const id = blockIdOf(node);
    if (id) owners.set(id, [...(owners.get(id) ?? []), { pos, node }]);
    return !node.isTextblock;
  });
  return owners;
}

function keepsMarker(node: ProseMirrorNode, inline: ReadonlySet<string>): boolean {
  if (!inline.has(node.type.name)) return true;
  const block = node.isTextblock ? node : node.firstChild;
  return !block?.isTextblock || block.content.size > 0;
}

function clearDuplicateBlockIds(tr: Transaction, inserted: readonly Range[], inline: ReadonlySet<string>): void {
  for (const list of idOwners(tr.doc).values()) {
    if (list.length < 2) continue;
    const marked = list.map((owner) => ({ ...owner, fresh: within(inserted, owner.pos, true), filled: keepsMarker(owner.node, inline) }));
    const keep =
      marked.find((owner) => !owner.fresh && owner.filled) ?? marked.find((owner) => owner.filled) ?? marked.find((owner) => !owner.fresh) ?? marked[0];
    for (const owner of marked) {
      if (owner !== keep) tr.setNodeAttribute(owner.pos, "blockId", null);
    }
  }
}

function moveIdsOffEmptyHalves(tr: Transaction, inserted: readonly Range[], inline: ReadonlySet<string>): void {
  const moves: { from: number; to: number; id: string }[] = [];
  tr.doc.descendants((node, pos, parent, index) => {
    const id = blockIdOf(node);
    const next = id && parent && !keepsMarker(node, inline) ? parent.maybeChild(index + 1) : null;
    const at = pos + node.nodeSize;
    if (id && next?.type === node.type && blockIdOf(next) === null && keepsMarker(next, inline) && within(inserted, at, false)) {
      moves.push({ from: pos, to: at, id });
    }
    return !node.isTextblock;
  });
  for (const move of moves) {
    tr.setNodeAttribute(move.from, "blockId", null);
    tr.setNodeAttribute(move.to, "blockId", move.id);
  }
}

function ownerAt(doc: ProseMirrorNode, at: number, types: ReadonlySet<string>, inline: ReadonlySet<string>): Owner | null {
  const $at = doc.resolve(at);
  const after = $at.nodeAfter;
  if (after && types.has(after.type.name)) return { pos: at, node: after };
  for (let depth = $at.depth; depth > 0; depth--) {
    const node = $at.node(depth);
    if (!types.has(node.type.name)) continue;
    const parent = $at.node(depth - 1);
    const item = node.isTextblock && parent.firstChild === node && inline.has(parent.type.name) && !parent.isTextblock;
    return item ? { pos: $at.before(depth - 1), node: parent } : { pos: $at.before(depth), node };
  }
  return null;
}

function survivingPos(start: MapResult, end: MapResult): number | null {
  if (!start.deleted) return start.pos;
  return end.deleted ? null : end.pos;
}

function restoreLostIds(tr: Transaction, before: ProseMirrorNode, mapping: Mapping, types: ReadonlySet<string>, inline: ReadonlySet<string>): void {
  const present = idOwners(tr.doc);
  for (const [id, [owner]] of idOwners(before)) {
    if (present.has(id) || !mapping.mapResult(owner.pos, 1).deleted) continue;
    const inset = owner.node.isTextblock ? 1 : 2;
    const start = mapping.mapResult(owner.pos + inset, 1);
    const end = mapping.mapResult(owner.pos + owner.node.nodeSize - inset, -1);
    const at = survivingPos(start, end);
    const target = at === null ? null : ownerAt(tr.doc, at, types, inline);
    if (target && blockIdOf(target.node) === null) tr.setNodeAttribute(target.pos, "blockId", id);
  }
}

export type MarkdownBlockKind = "paragraph" | "heading" | "item" | "table" | "quote" | "callout" | "code" | "list";

interface MarkdownBlockSpan {
  kind: MarkdownBlockKind;
  id: string | null;
  start: number;
  end: number;
  idLine: number;
  trailing: boolean;
  text: string;
  nested: boolean;
}

const SPAN_KINDS: Readonly<Record<string, MarkdownBlockKind>> = {
  paragraph_open: "paragraph",
  heading_open: "heading",
  list_item_open: "item",
  table_open: "table",
  blockquote_open: "quote",
  fence: "code",
  code_block: "code",
  bullet_list_open: "list",
  ordered_list_open: "list",
};

function lastFilled(lines: readonly string[], start: number, end: number): number {
  let line = Math.min(end, lines.length) - 1;
  while (line > start && lines[line].trim() === "") line--;
  return line;
}

function firstInline(tokens: readonly MdToken[], from: number): string {
  for (let index = from + 1; index < tokens.length && tokens[index].level > tokens[from].level; index++) {
    if (tokens[index].type === "inline") return tokens[index].content;
  }
  return "";
}

function tableText(tokens: readonly MdToken[], from: number): string {
  const cells: string[] = [];
  for (let index = from + 1; index < tokens.length && tokens[index].type !== "tr_close"; index++) {
    if (tokens[index].type === "inline") cells.push(tokens[index].content);
  }
  return cells.join(" | ");
}

function spanText(tokens: readonly MdToken[], index: number, kind: MarkdownBlockKind): string {
  const token = tokens[index];
  if (kind === "code") return [token.info.trim(), token.content.split("\n", 1)[0]].filter(Boolean).join(" ");
  if (kind === "table") return tableText(tokens, index);
  return firstInline(tokens, index);
}

function skipsSpan(tokens: readonly MdToken[], index: number, kind: MarkdownBlockKind, id: string | null, quoted: boolean): boolean {
  if (tokens[index].type === "paragraph_open" && tokens[index - 1]?.type === "list_item_open") return true;
  return (kind === "list" && !id) || (kind === "paragraph" && quoted && !id);
}

function textEndLine(tokens: readonly MdToken[], index: number, kind: MarkdownBlockKind, end: number): number {
  const firstParagraph = kind === "item" ? tokens[index + 1] : null;
  return firstParagraph?.type === "paragraph_open" && firstParagraph.map ? firstParagraph.map[1] : end;
}

function blockSpanAt(tokens: readonly MdToken[], index: number, lines: readonly string[], containers: readonly string[]): MarkdownBlockSpan | null {
  const token = tokens[index];
  const kind = SPAN_KINDS[token.type];
  const id = token.attrGet(BLOCK_ID_ATTRIBUTE);
  if (!kind || !token.map || skipsSpan(tokens, index, kind, id, containers.includes("blockquote_open"))) return null;
  const resolved = kind === "quote" && token.attrGet("data-callout") !== null ? "callout" : kind;
  const trailing = resolved !== "paragraph" && resolved !== "heading" && resolved !== "item";
  const [start, end] = token.map;
  return {
    kind: resolved,
    id: isBlockId(id) ? id : null,
    start,
    end,
    idLine: lastFilled(lines, start, trailing ? end : textEndLine(tokens, index, kind, end)),
    trailing,
    text: spanText(tokens, index, kind).replaceAll(/\s+/gu, " ").trim(),
    nested: containers.length > 0,
  };
}

export function markdownBlockSpans(source: string, extensions: AnyExtension[]): MarkdownBlockSpan[] {
  const md = markdownEngine(extensions).storage.markdown.parser.md as MarkdownIt;
  setupBlockIds(md);
  const tokens = md.parse(source, {});
  const lines = source.split("\n");
  const spans: MarkdownBlockSpan[] = [];
  const containers: string[] = [];
  tokens.forEach((token, index) => {
    if (token.nesting === -1) {
      containers.pop();
      return;
    }
    const span = blockSpanAt(tokens, index, lines, containers);
    if (span) spans.push(span);
    if (token.nesting === 1) containers.push(token.type);
  });
  return spans;
}

export const BlockId = Extension.create<BlockIdOptions>({
  name: "blockId",
  priority: 40,

  addOptions() {
    return {
      inlineTypes: ["paragraph", "heading", "listItem", "taskItem"],
      trailingTypes: ["table", "blockquote", "callout", "codeBlock", "bulletList", "orderedList", "taskList"],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: [...this.options.inlineTypes, ...this.options.trailingTypes],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => {
              const id = element.dataset.blockId ?? element.querySelector<HTMLElement>(":scope > code")?.dataset.blockId;
              return isBlockId(id) ? id : null;
            },
            renderHTML: (attributes: Record<string, unknown>) =>
              isBlockId(attributes.blockId) ? { [BLOCK_ID_ATTRIBUTE]: attributes.blockId } : {},
          },
        },
      },
    ];
  },

  addStorage() {
    return { markdown: { parse: { setup: setupBlockIds } } };
  },

  onBeforeCreate() {
    const markdown = (this.editor.storage as unknown as Record<string, unknown>).markdown as
      | { parser?: { md?: MarkdownIt }; serializer?: { serialize: (doc: ProseMirrorNode) => string } }
      | undefined;
    if (markdown?.parser?.md) setupBlockIds(markdown.parser.md);
    const serializer = markdown?.serializer;
    if (!serializer) return;
    const serialize = serializer.serialize.bind(serializer);
    const options = this.options;
    serializer.serialize = (doc) => serialize(withBlockIdMarkers(doc, options));
  },

  addProseMirrorPlugins() {
    const inline = new Set(this.options.inlineTypes);
    const types = new Set([...this.options.inlineTypes, ...this.options.trailingTypes]);
    return [
      new Plugin({
        key: blockIdKey,
        appendTransaction: (transactions, old, state) => {
          let inserted: Range[] = [];
          let joined = false;
          const mapping = new Mapping();
          for (const tr of transactions) {
            if (!tr.docChanged) continue;
            inserted = inserted.map((range) => ({ ...range, from: tr.mapping.map(range.from, -1), to: tr.mapping.map(range.to, 1) }));
            inserted.push(...insertedRanges(tr));
            joined ||= joinsBlocks(tr);
            mapping.appendMapping(tr.mapping);
          }
          if (inserted.length === 0 && !joined) return null;
          const repair = state.tr;
          if (inserted.length > 0) {
            clearDuplicateBlockIds(repair, inserted, inline);
            moveIdsOffEmptyHalves(repair, inserted, inline);
          }
          if (joined) restoreLostIds(repair, old.doc, mapping, types, inline);
          return repair.docChanged ? repair : null;
        },
      }),
    ];
  },
});
