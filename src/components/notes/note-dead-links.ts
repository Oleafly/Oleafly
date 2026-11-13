import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { fencedLines } from "@/lib/code-fences";
import { openNoteEditor } from "@/lib/open-note-editors";
import type { NoteLinkRecord } from "@/lib/tauri";
import { blockOfFragment } from "./note-block-ids";
import { noteLinkHref, parseNoteLink } from "./note-link-format";
import type { LinkableNote } from "./note-links";

export type DeadLinkKind = "note" | "block";

export interface DeadLink {
  key: string;
  sourceId: string;
  targetId: string;
  block: string | null;
  line: number;
  snippet: string;
  missing: DeadLinkKind;
  target: LinkableNote | null;
}

export interface LinkMatch {
  noteId: string;
  block: string | null;
}

export type LinkFix = { kind: "remove" } | { kind: "relink"; noteId: string };

export interface NoteTextStore {
  load: (id: string) => Promise<{ text: string; version: string }>;
  save: (id: string, text: string, version: string) => Promise<unknown>;
}

const LINK_LABEL = /(!?)\[((?:\\.|[^\\[\]])*)\]\(/giu;
const NOTE_DESTINATION = /\s*<?(oleafly:\/\/note\/[A-Za-z0-9_-]{1,128}\/?(?:#[^\s)>]*)?)>?(?:\s+"(?:\\.|[^"\\])*")?\s*\)/iuy;

interface MarkdownNoteLink {
  from: number;
  to: number;
  bang: string;
  label: string;
  destination: string;
}

function* markdownNoteLinks(text: string): Generator<MarkdownNoteLink> {
  const labels = new RegExp(LINK_LABEL);
  for (let label = labels.exec(text); label; label = labels.exec(text)) {
    NOTE_DESTINATION.lastIndex = labels.lastIndex;
    const destination = NOTE_DESTINATION.exec(text);
    if (destination) {
      const to = NOTE_DESTINATION.lastIndex;
      yield { from: label.index, to, bang: label[1], label: label[2], destination: destination[1] };
      labels.lastIndex = to;
    } else {
      labels.lastIndex = label.index + 1;
    }
  }
}

function replaceNoteLinks(text: string, replace: (link: MarkdownNoteLink) => string): string {
  let replaced = "";
  let last = 0;
  for (const link of markdownNoteLinks(text)) {
    replaced += text.slice(last, link.from) + replace(link);
    last = link.to;
  }
  return replaced + text.slice(last);
}

function missingPart(block: string | undefined, target: LinkableNote | null, blocks: ReadonlyMap<string, ReadonlySet<string>>): DeadLinkKind | null {
  if (!target) return "note";
  const known = blocks.get(target.projectId);
  return block && known && !known.has(block) ? "block" : null;
}

export function findDeadLinks(records: readonly NoteLinkRecord[], notes: readonly LinkableNote[]): DeadLink[] {
  const byNoteId = new Map(notes.map((note) => [note.noteId, note]));
  const blocks = new Map(records.map((record) => [record.projectId, new Set(record.blocks ?? [])]));
  const found: DeadLink[] = [];
  for (const record of records) {
    for (const link of record.links) {
      if (link.kind !== "note") continue;
      const target = byNoteId.get(link.id) ?? null;
      const missing = missingPart(link.block, target, blocks);
      if (!missing) continue;
      found.push({
        key: `${record.projectId}\n${link.id}\n${link.block ?? ""}`,
        sourceId: record.projectId,
        targetId: link.id,
        block: link.block ?? null,
        line: link.line ?? 0,
        snippet: link.snippet,
        missing,
        target,
      });
    }
  }
  return found;
}

export function linkMatches(href: string, match: LinkMatch): boolean {
  const target = parseNoteLink(href);
  if (target?.kind !== "note" || target.id !== match.noteId) return false;
  return match.block === null || blockOfFragment(target.heading) === match.block;
}

function fixedHref(fix: LinkFix): string | null {
  return fix.kind === "remove" ? null : noteLinkHref("note", fix.noteId);
}

export function rewriteNoteLinks(markdown: string, match: LinkMatch, fix: LinkFix): { text: string; count: number } {
  let count = 0;
  const href = fixedHref(fix);
  const lines = fencedLines(markdown).map((line) => {
    if (line.fenced || !line.text.includes("oleafly://")) return line.text;
    return replaceNoteLinks(line.text, (link) => {
      if (!linkMatches(link.destination, match)) return line.text.slice(link.from, link.to);
      count += 1;
      return href === null ? link.label : `${link.bang}[${link.label}](${href})`;
    });
  });
  return { text: lines.join("\n"), count };
}

export function firstLinkLabel(markdown: string, match: LinkMatch): string | null {
  for (const line of fencedLines(markdown)) {
    if (line.fenced) continue;
    for (const found of markdownNoteLinks(line.text)) {
      if (linkMatches(found.destination, match)) return found.label.replaceAll(/\\(.)/gu, "$1").trim() || null;
    }
  }
  return null;
}

function hrefOf(node: ProseMirrorNode): string | null {
  const link = node.marks.find((mark) => mark.type.name === "link");
  return typeof link?.attrs.href === "string" ? link.attrs.href : null;
}

export function rewriteDocLinks(view: EditorView, match: LinkMatch, fix: LinkFix): number {
  const { state } = view;
  const link = state.schema.marks.link;
  if (!link || !view.editable) return 0;
  const href = fixedHref(fix);
  const tr = state.tr;
  let count = 0;
  state.doc.descendants((node, pos) => {
    if (node.isText) {
      const current = hrefOf(node);
      if (current && linkMatches(current, match)) {
        tr.removeMark(pos, pos + node.nodeSize, link);
        if (href) tr.addMark(pos, pos + node.nodeSize, link.create({ href }));
        count += 1;
      }
      return false;
    }
    if (node.type.name === "image" && linkMatches(String(node.attrs.src ?? ""), match)) {
      const at = tr.mapping.map(pos);
      if (href) tr.setNodeAttribute(at, "src", href);
      else tr.replaceWith(at, at + node.nodeSize, state.schema.text(String(node.attrs.alt || " ")));
      count += 1;
      return false;
    }
    return true;
  });
  if (count > 0) view.dispatch(tr);
  return count;
}

export async function fixNoteLinks(sourceId: string, match: LinkMatch, fix: LinkFix, store: NoteTextStore): Promise<number> {
  const open = openNoteEditor(sourceId)?.editor;
  if (open && !open.isDestroyed) return rewriteDocLinks(open.view, match, fix);
  const source = await store.load(sourceId);
  const next = rewriteNoteLinks(source.text, match, fix);
  if (next.count > 0) await store.save(sourceId, next.text, source.version);
  return next.count;
}
