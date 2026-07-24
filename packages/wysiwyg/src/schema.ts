import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { AnyExtension } from "@tiptap/core";
import { RawBlock } from "./raw-block";
import { RawInline } from "./raw-inline";

export const WYSIWYG_EXTENSIONS: AnyExtension[] = [
  StarterKit.configure({
    codeBlock: false,
    horizontalRule: false,
    undoRedo: false,
  }),
  Markdown,
  RawBlock,
  RawInline,
];
