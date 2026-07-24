import { StarterKit } from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import type { AnyExtension } from "@tiptap/core";
import { RawBlock } from "./raw-block";

export const WYSIWYG_EXTENSIONS: AnyExtension[] = [
  StarterKit.configure({
    codeBlock: false,
    horizontalRule: false,
  }),
  Markdown,
  RawBlock,
];
