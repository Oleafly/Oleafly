import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Markdown } from "tiptap-markdown";
import type { AnyExtension } from "@tiptap/core";
import { RawBlock } from "./raw-block";
import { RawInline } from "./raw-inline";

export const WYSIWYG_EXTENSIONS: AnyExtension[] = [
  StarterKit.configure({
    codeBlock: false,
    horizontalRule: false,
  }),
  Image.configure({ inline: false }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Markdown,
  RawBlock,
  RawInline,
];
