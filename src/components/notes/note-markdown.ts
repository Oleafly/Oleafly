import {
  createWysiwygExtensions,
  parseMarkdownBody,
  serializeMarkdownBody,
  type MarkdownSourceSnapshot,
  type WysiwygExtensionOptions,
} from "@oleafly/wysiwyg";
import type { AnyExtension, JSONContent, NodeViewRenderer } from "@tiptap/core";
import type { LinkOptions } from "@tiptap/extension-link";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";
import { NoteCallout, NoteCalloutTitle } from "./note-callouts";
import { NoteHighlight } from "./note-highlight";
import { NoteTaskItem, NoteTaskList } from "./note-tasks";

export const NOTE_ITEM_LINK = /^oleafly:\/\/(?:note|project)\/[\w-]+\/?(?:#[^\s#]*)?$/iu;

export interface NoteViews {
  callout: NodeViewRenderer | null;
}

type Configurable = AnyExtension & { configure(options: Partial<LinkOptions>): AnyExtension };

export function withNoteHrefs(extension: AnyExtension): AnyExtension {
  if (extension.name !== "link") return extension;
  return (extension as Configurable).configure({
    isAllowedUri: (url: string, context: { defaultValidate: (url: string) => boolean }) =>
      context.defaultValidate(url) || NOTE_ITEM_LINK.test(url),
  });
}

export function noteBaseExtensions(options: WysiwygExtensionOptions = {}, views: NoteViews | null = null): AnyExtension[] {
  return [
    ...createWysiwygExtensions(options).map(withNoteHrefs),
    NoteTaskList,
    NoteTaskItem.configure({ views: views !== null }),
    NoteHighlight,
    NoteCalloutTitle,
    NoteCallout.configure({ view: views?.callout ?? null }),
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
