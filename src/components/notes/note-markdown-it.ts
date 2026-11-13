import type { MarkdownNodeSpec } from "tiptap-markdown";

export type MarkdownIt = Parameters<NonNullable<NonNullable<MarkdownNodeSpec["parse"]>["setup"]>>[0];
export type MdToken = ReturnType<MarkdownIt["parse"]>[number];
export type MdCoreState = Parameters<Parameters<MarkdownIt["core"]["ruler"]["after"]>[2]>[0];
export type MdInlineState = Parameters<Parameters<MarkdownIt["inline"]["ruler"]["before"]>[2]>[0];
