import type { AnyExtension } from "@tiptap/core";
import type { MarkdownNodeSpec } from "tiptap-markdown";
import { splitMarkdownFrontMatter } from "../front-matter";
import { WYSIWYG_EXTENSIONS } from "../schema";
import { markdownEngine } from "./engine";

type MarkdownIt = Parameters<NonNullable<NonNullable<MarkdownNodeSpec["parse"]>["setup"]>>[0];

type MarkdownReference =
  | { kind: "image" | "link"; target: string; line: number }
  | { kind: "fence"; info: string; content: string; line: number };

const INLINE_TARGETS: Readonly<Record<string, readonly ["image" | "link", string]>> = {
  image: ["image", "src"],
  link_open: ["link", "href"],
};

export function markdownReferences(source: string, extensions: AnyExtension[] = WYSIWYG_EXTENSIONS): MarkdownReference[] {
  const { body } = splitMarkdownFrontMatter(source);
  const before = source.slice(0, source.length - body.length).split("\n").length - 1;
  const md = markdownEngine(extensions).storage.markdown.parser.md as MarkdownIt;
  const found: MarkdownReference[] = [];
  for (const token of md.parse(body, {})) {
    const line = before + (token.map?.[0] ?? 0) + 1;
    if (token.type === "fence") found.push({ kind: "fence", info: token.info.trim(), content: token.content, line });
    for (const child of token.children ?? []) {
      const inline = INLINE_TARGETS[child.type];
      const target = inline ? child.attrGet(inline[1]) : null;
      if (inline && target) found.push({ kind: inline[0], target, line });
    }
  }
  return found;
}
