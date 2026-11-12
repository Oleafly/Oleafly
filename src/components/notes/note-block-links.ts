import { blockIdOf, markdownBlockSpans, markdownPreservedRanges, type MarkdownBlockKind } from "@oleafly/wysiwyg";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, NodeSelection, Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";
import { frontMatterBody } from "@/lib/front-matter";
import { trimTrailingCharacters } from "@/lib/trim-character";
import { newBlockId, stripBlockIdMarkers } from "./note-block-ids";
import { isSpaceOrTab } from "./note-link-format";
import { noteMarkdownExtensions } from "./note-markdown";

export type NoteBlockKind = MarkdownBlockKind;

export interface NoteBlock {
  id: string | null;
  kind: NoteBlockKind;
  text: string;
  start: number;
  end: number;
  idLine: number;
  trailing: boolean;
  nested: boolean;
}

export interface DocBlock {
  id: string | null;
  pos: number;
  node: ProseMirrorNode;
  kind: NoteBlockKind;
  text: string;
}

const FLASH_CLASS = "note-block-flash";
const FLASH_MS = 1600;
const FLASH_WAIT_FRAMES = 30;
const LINKABLE_TYPES = new Set(["paragraph", "heading", "listItem", "taskItem", "table", "blockquote", "callout", "codeBlock"]);
const CONTAINER_TYPES = ["listItem", "taskItem", "table", "callout", "blockquote"];
const CONTAINER_MARKS = /^(?:[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t])))*/u;
const NODE_KINDS: Readonly<Record<string, NoteBlockKind>> = {
  paragraph: "paragraph",
  heading: "heading",
  listItem: "item",
  taskItem: "item",
  table: "table",
  blockquote: "quote",
  callout: "callout",
  codeBlock: "code",
  bulletList: "list",
  orderedList: "list",
  taskList: "list",
};

function frontMatterOffset(text: string): { head: string; body: string } {
  const body = frontMatterBody(text);
  return { head: text.slice(0, text.length - body.length), body };
}

export function noteBlocks(markdown: string): NoteBlock[] {
  return markdownBlockSpans(frontMatterBody(markdown), noteMarkdownExtensions()).map((span) => ({ ...span }));
}

function withSourcesMasked(body: string): string {
  let masked = body;
  for (const { from, to } of [...markdownMathRanges(body), ...markdownPreservedRanges(body)]) {
    masked = masked.slice(0, from) + masked.slice(from, to).replaceAll(/[^\r\n]/gu, "x") + masked.slice(to);
  }
  return masked;
}

export function noteItemLines(markdown: string): number[] {
  const { head, body } = frontMatterOffset(markdown);
  const offset = head.split("\n").length - 1;
  return markdownBlockSpans(withSourcesMasked(body), noteMarkdownExtensions()).flatMap((span) => (span.kind === "item" ? [span.start + offset] : []));
}

export function noteBlock(markdown: string, id: string): NoteBlock | null {
  if (!markdown.includes(`^${id}`)) return null;
  return noteBlocks(markdown).find((block) => block.id === id) ?? null;
}

export function noteBlockSource(markdown: string, id: string): string | null {
  const block = noteBlock(markdown, id);
  if (!block) return null;
  const lines = frontMatterBody(markdown).split("\n");
  return stripBlockIdMarkers(lines.slice(block.start, block.end).join("\n")).trim();
}

function containerLead(line: string): string {
  let end = CONTAINER_MARKS.exec(line)?.[0].length ?? 0;
  while (isSpaceOrTab(line[end])) end += 1;
  return line.slice(0, end);
}

function containerPrefix(block: Pick<NoteBlock, "kind" | "nested">, line: string): string {
  if (!block.nested) return "";
  const lead = containerLead(line).replaceAll(/[^ \t>]/gu, " ");
  return block.kind === "quote" || block.kind === "callout" ? lead.replace(/>[ \t]?(?=[^>]*$)/u, "") : lead;
}

export function withBlockId(text: string, block: Pick<NoteBlock, "idLine" | "trailing" | "kind" | "nested">, id: string): string {
  const { head, body } = frontMatterOffset(text);
  const lines = body.split("\n");
  const at = block.idLine;
  if (at < 0 || at >= lines.length) return text;
  const line = lines[at];
  const ending = line.endsWith("\r") ? "\r" : "";
  if (block.trailing) {
    const prefix = containerPrefix(block, line);
    const blank = prefix.trimEnd();
    const next = lines[at + 1]?.replace(/\r$/u, "");
    const tail = next !== undefined && next.trim() !== "" && next.trimEnd() !== blank ? [blank + ending] : [];
    lines.splice(at + 1, 0, blank + ending, `${prefix}^${id}${ending}`, ...tail);
  } else {
    lines[at] = `${trimTrailingCharacters(line.slice(0, line.length - ending.length), " \t")} ^${id}${ending}`;
  }
  return head + lines.join("\n");
}

function kindOf(node: ProseMirrorNode): NoteBlockKind {
  return NODE_KINDS[node.type.name] ?? "paragraph";
}

function blockText(node: ProseMirrorNode): string {
  if (node.type.name === "codeBlock") return [String(node.attrs.language ?? ""), node.textContent.split("\n", 1)[0]].filter(Boolean).join(" ");
  const first = node.isTextblock ? node : node.firstChild;
  return (first?.isTextblock ? first.textContent : node.textContent).replaceAll(/\s+/gu, " ").trim();
}

function docBlock(node: ProseMirrorNode, pos: number): DocBlock {
  return { id: blockIdOf(node), pos, node, kind: kindOf(node), text: blockText(node) };
}

export function docBlockAt(state: EditorState, at?: number): DocBlock | null {
  const { selection } = state;
  if (at === undefined && selection instanceof NodeSelection && LINKABLE_TYPES.has(selection.node.type.name)) {
    return docBlock(selection.node, selection.from);
  }
  const $pos = state.doc.resolve(at ?? selection.from);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (CONTAINER_TYPES.includes(node.type.name) || node.type.name === "codeBlock") return docBlock(node, $pos.before(depth));
  }
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.isTextblock && LINKABLE_TYPES.has(node.type.name)) return docBlock(node, $pos.before(depth));
  }
  const after = $pos.nodeAfter;
  return after && LINKABLE_TYPES.has(after.type.name) ? docBlock(after, $pos.pos) : null;
}

export function findDocBlock(doc: ProseMirrorNode, id: string): DocBlock | null {
  let found: DocBlock | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (blockIdOf(node) === id) found = docBlock(node, pos);
    return !node.isTextblock;
  });
  return found;
}

function docBlockIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const id = blockIdOf(node);
    if (id) ids.add(id);
    return !node.isTextblock;
  });
  return ids;
}

export function docBlocks(doc: ProseMirrorNode): DocBlock[] {
  const found: DocBlock[] = [];
  doc.descendants((node, pos, parent) => {
    const name = node.type.name;
    const firstOfItem = parent && (parent.type.name === "listItem" || parent.type.name === "taskItem") && parent.firstChild === node;
    const quoted = parent && (parent.type.name === "blockquote" || parent.type.name === "callout");
    const listed = name === "bulletList" || name === "orderedList" || name === "taskList";
    const linkable = LINKABLE_TYPES.has(name) || (listed && blockIdOf(node) !== null);
    if (linkable && !firstOfItem && !(quoted && node.isTextblock && blockIdOf(node) === null)) {
      const block = docBlock(node, pos);
      if (block.text || block.id) found.push(block);
    }
    return !node.isTextblock && name !== "codeBlock" && name !== "table";
  });
  return found;
}

export function ensureDocBlockId(view: EditorView, block: DocBlock): string | null {
  if (block.id) return block.id;
  if (!view.editable) return null;
  const id = newBlockId(docBlockIds(view.state.doc));
  view.dispatch(view.state.tr.setNodeAttribute(block.pos, "blockId", id));
  return id;
}

const blockFlashKey = new PluginKey<DecorationSet>("noteBlockFlash");

function flashed(doc: ProseMirrorNode, pos: number): DecorationSet {
  const node = doc.nodeAt(pos);
  return node ? DecorationSet.create(doc, [Decoration.node(pos, pos + node.nodeSize, { class: FLASH_CLASS })]) : DecorationSet.empty;
}

export function blockFlashPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: blockFlashKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        const meta: unknown = tr.getMeta(blockFlashKey);
        if (meta === null) return DecorationSet.empty;
        if (typeof meta === "number") return flashed(tr.doc, meta);
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
      },
    },
    props: { decorations: (state) => blockFlashKey.getState(state) },
    view: () => {
      let timer = 0;
      return {
        update: (view, previous) => {
          const current = blockFlashKey.getState(view.state);
          if (current === blockFlashKey.getState(previous) || current === DecorationSet.empty) return;
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(blockFlashKey, null).setMeta("addToHistory", false));
          }, FLASH_MS);
        },
        destroy: () => window.clearTimeout(timer),
      };
    },
  });
}

function scrollToBlock(view: EditorView, pos: number, frames = FLASH_WAIT_FRAMES): void {
  const dom = view.isDestroyed ? null : view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return;
  if (!dom.isConnected && frames > 0) {
    window.requestAnimationFrame(() => scrollToBlock(view, pos, frames - 1));
    return;
  }
  dom.scrollIntoView?.({ block: "center" });
}

function showBlock(view: EditorView, block: DocBlock): void {
  const inside = Math.min(block.pos + 1, view.state.doc.content.size);
  const tr = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(inside))).setMeta(blockFlashKey, block.pos);
  view.dispatch(tr);
  scrollToBlock(view, block.pos);
}

export function revealBlock(view: EditorView, id: string): boolean {
  const block = findDocBlock(view.state.doc, id);
  if (!block) return false;
  showBlock(view, block);
  return true;
}

interface BlockSpot {
  id: string | null;
  kind: NoteBlockKind;
  text: string;
  at: number;
  live: boolean;
}

interface BlockWriter {
  editor: () => EditorView | null;
  load: () => Promise<{ text: string; version: string }>;
  save: (text: string, version: string) => Promise<unknown>;
}

function liveSpot(view: EditorView, spot: BlockSpot): DocBlock | null {
  const blocks = docBlocks(view.state.doc);
  return (
    blocks.find((block) => spot.live && block.pos === spot.at && block.text === spot.text) ??
    blocks.find((block) => block.kind === spot.kind && block.text === spot.text) ??
    null
  );
}

export async function assignNoteBlockId(spot: BlockSpot, writer: BlockWriter): Promise<string | null> {
  if (spot.id) return spot.id;
  const view = writer.editor();
  if (view) {
    const block = liveSpot(view, spot);
    return block ? ensureDocBlockId(view, block) : null;
  }
  const source = await writer.load();
  const blocks = noteBlocks(source.text);
  const block = blocks.find((entry) => entry.idLine === spot.at && entry.text === spot.text) ?? blocks.find((entry) => entry.kind === spot.kind && entry.text === spot.text);
  if (!block) return null;
  if (block.id) return block.id;
  const id = newBlockId(new Set(blocks.flatMap((entry) => (entry.id ? [entry.id] : []))));
  await writer.save(withBlockId(source.text, block, id), source.version);
  return id;
}

function flat(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim().toLowerCase();
}

export function findTextBlock(doc: ProseMirrorNode, text: string): DocBlock | null {
  const wanted = flat(text);
  if (!wanted) return null;
  const blocks = docBlocks(doc);
  return blocks.find((block) => flat(block.text).startsWith(wanted)) ?? blocks.find((block) => flat(block.node.textContent).includes(wanted)) ?? null;
}

export function revealTextBlock(view: EditorView, text: string): boolean {
  const block = findTextBlock(view.state.doc, text);
  if (!block) return false;
  showBlock(view, block);
  return true;
}
