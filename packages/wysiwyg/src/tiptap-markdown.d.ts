import "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownBlockToken } from "./markdown/source-layout";

declare module "@tiptap/core" {
  interface Storage {
    markdown: {
      getMarkdown(): string;
      parser: {
        md: {
          parse(source: string, env: object): MarkdownBlockToken[];
        };
      };
      serializer: {
        serialize(node: ProseMirrorNode): string;
      };
    };
  }
}
