import { textDataUrl } from "@/lib/base64";
import type { MentionAttachment } from "@/lib/chat-attachments";
import { frontMatterBody } from "@/lib/front-matter";
import { type NoteFacts, noteFacts, readFileContent } from "@/lib/tauri";
import { trimTrailingCharacters } from "@/lib/trim-character";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { blockOfFragment, shortText, stripBlockIdMarkers } from "./note-block-ids";
import { noteHeadings, noteSection } from "./note-link-format";
import { quoted, untrustedBlock } from "./untrusted-data";

export interface LinkedNoteText {
  noteId: string;
  fragment: string | null;
  title: string;
  label: string;
  markdown: string;
}

export interface LinkedNoteSources {
  facts: () => Promise<readonly NoteFacts[]>;
  read: (storageId: string) => Promise<string>;
}

const NOTE_ADDRESS = /oleafly:\/\/note\/([A-Za-z0-9_-]{1,128})\/?(?:#([^\s)\]>"']*))?/giu;
const MAX_LINKS = 8;
const MAX_CHARS = 20_000;
const TRAILING_PUNCTUATION = ".,;:!?";

export function noteAddressesIn(text: string): { noteId: string; fragment: string | null }[] {
  if (!text.includes("oleafly://")) return [];
  const seen = new Set<string>();
  const found: { noteId: string; fragment: string | null }[] = [];
  for (const [, noteId, raw = ""] of text.matchAll(NOTE_ADDRESS)) {
    const trimmed = trimTrailingCharacters(raw, TRAILING_PUNCTUATION);
    let fragment: string | null = null;
    try {
      fragment = trimmed ? decodeURIComponent(trimmed) : null;
    } catch {
      fragment = trimmed || null;
    }
    const key = `${noteId}#${fragment ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ noteId, fragment });
    if (found.length === MAX_LINKS) break;
  }
  return found;
}

const defaultSources: LinkedNoteSources = {
  facts: () => noteFacts(),
  read: (storageId) => {
    const project = useFilesStore.getState().projects.find((candidate) => candidate.id === storageId);
    return readFileContent(storageId, project?.main_doc || "note.md");
  },
};

async function sliceOf(text: string, fragment: string | null): Promise<{ label: string; markdown: string } | null> {
  const block = blockOfFragment(fragment);
  if (block) {
    const { noteBlock, noteBlockSource } = await import("./note-block-links");
    const markdown = noteBlockSource(text, block);
    return markdown === null ? null : { label: shortText(noteBlock(text, block)?.text ?? "") || `^${block}`, markdown };
  }
  const body = frontMatterBody(text);
  if (!fragment) return { label: "", markdown: stripBlockIdMarkers(body).trim() };
  const markdown = noteSection(body, fragment);
  const heading = noteHeadings(body).find((candidate) => candidate.slug === fragment)?.text ?? fragment;
  return markdown === null ? null : { label: heading, markdown: stripBlockIdMarkers(markdown) };
}

export async function linkedNoteTexts(text: string, sources: LinkedNoteSources = defaultSources): Promise<LinkedNoteText[]> {
  const addresses = noteAddressesIn(text);
  if (addresses.length === 0) return [];
  const byNoteId = new Map((await sources.facts()).flatMap((fact) => (fact.noteId ? [[fact.noteId, fact] as const] : [])));
  const found = await Promise.all(
    addresses.map(async ({ noteId, fragment }): Promise<LinkedNoteText | null> => {
      const fact = byNoteId.get(noteId);
      if (!fact) return null;
      const text = await sources.read(fact.id).catch(() => null);
      const slice = text === null ? null : await sliceOf(text, fragment);
      return slice ? { noteId, fragment, title: fact.title, label: slice.label, markdown: slice.markdown.slice(0, MAX_CHARS) } : null;
    }),
  );
  return found.filter((entry) => entry !== null);
}

function linkedNoteHeading(linked: LinkedNoteText): string {
  const part = linked.label ? ` > ${quoted(linked.label)}` : "";
  const what = blockOfFragment(linked.fragment) ? "A block of the note" : "The note";
  const anchor = linked.fragment ? `#${linked.fragment}` : "";
  return `${what} ${quoted(linked.title)}${part} (link oleafly://note/${linked.noteId}${anchor})`;
}

export async function noteLinkAttachments(text: string, sources?: LinkedNoteSources): Promise<MentionAttachment[]> {
  if (!useSettingsStore.getState().notes) return [];
  const linked = await linkedNoteTexts(text, sources).catch(() => []);
  return linked.map((entry) => ({
    id: `note-link:${entry.noteId}#${entry.fragment ?? ""}`,
    name: entry.label ? `${entry.title} > ${entry.label}` : entry.title,
    mediaType: "text/plain",
    dataUrl: textDataUrl(untrustedBlock(linkedNoteHeading(entry), entry.markdown)),
  }));
}

export async function noteLinkSelections(text: string, sources?: LinkedNoteSources): Promise<{ path: null; text: string }[]> {
  if (!useSettingsStore.getState().notes) return [];
  const linked = await linkedNoteTexts(text, sources).catch(() => []);
  return linked.map((entry) => ({ path: null, text: untrustedBlock(linkedNoteHeading(entry), entry.markdown) }));
}
