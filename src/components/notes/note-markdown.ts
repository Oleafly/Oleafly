import {
  BlockId,
  createWysiwygExtensions,
  parseMarkdownBody,
  serializeMarkdownBody,
  type MarkdownSourceSnapshot,
  type WysiwygExtensionOptions,
} from "@oleafly/wysiwyg";
import type { AnyExtension, JSONContent, NodeViewRenderer } from "@tiptap/core";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";
import { NoteCallout, NoteCalloutTitle } from "./note-callouts";
import { NoteField } from "./note-fields";
import { NoteHighlight } from "./note-highlight";
import { NoteTaskItem, NoteTaskList } from "./note-tasks";
import { NoteTextReplacements } from "./note-text-replacements";

export interface NoteViews {
  callout: NodeViewRenderer | null;
}

export function noteBaseExtensions(options: WysiwygExtensionOptions = {}, views: NoteViews | null = null): AnyExtension[] {
  return [
    ...createWysiwygExtensions({ ...options, markdownTyping: true }),
    NoteTaskList,
    NoteTaskItem.configure({ views: views !== null }),
    NoteHighlight,
    NoteTextReplacements,
    NoteCalloutTitle,
    NoteCallout.configure({ view: views?.callout ?? null }),
    NoteField.configure({ views: views !== null }),
    BlockId,
  ];
}

let schemaExtensions: AnyExtension[] | null = null;

export function noteMarkdownExtensions(): AnyExtension[] {
  schemaExtensions ??= noteBaseExtensions();
  return schemaExtensions;
}

export function parseNoteMarkdown(source: string) {
  return parseMarkdownBody(source, {
    preservedInlineRanges: markdownMathRanges(source),
    extensions: noteMarkdownExtensions(),
  });
}

export function serializeNoteMarkdown(doc: JSONContent, snapshot: MarkdownSourceSnapshot | null = null): string {
  return serializeMarkdownBody(doc, snapshot, noteMarkdownExtensions());
}

const BOM = "\uFEFF";

export function joinNoteSource(frontMatter: string, separator: string, body: string): string {
  if (!frontMatter) return body;
  if (body.startsWith(BOM) && !frontMatter.startsWith(BOM)) {
    return `${BOM}${joinNoteSource(frontMatter, separator, body.slice(BOM.length))}`;
  }
  if (body === "") return `${frontMatter}${separator}`;
  return `${frontMatter}${separator.endsWith("\n") ? separator : "\n\n"}${body}`;
}
