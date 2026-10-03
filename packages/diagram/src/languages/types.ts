import type { DiagramModel } from "@oleafly/latex";

export type DiagramLanguageId = "tikz" | "typst" | "mermaid";

export type DiagramNoteKind = "kept" | "approximated" | "dropped";

export interface DiagramNote {
  kind: DiagramNoteKind;
  code: string;
  detail?: string;
}

export interface DiagramRead<Extras = unknown> {
  model: DiagramModel | null;
  extras: Extras | null;
  notes: DiagramNote[];
}

export interface DiagramReadOptions {
  hint?: DiagramModel | null;
}

export interface DiagramWriteOptions<Extras = unknown> {
  extras?: Extras | null;
  typstVersion?: string | null;
}

export type DiagramSnippetId = "rectangleNode" | "circleNode" | "arrowEdge" | "lineEdge" | "scope";

export interface DiagramFixPrompt {
  system: string;
  user: string;
}

export interface DiagramStandalone {
  code: string;
  background?: string;
}

export interface DiagramLanguage {
  id: DiagramLanguageId;
  name: string;
  extension: string;
  documentExtensions: readonly string[];
  importExtensions: readonly string[];
  vector: boolean;
  load(): Promise<void>;
  ready(): boolean;
  write(model: DiagramModel, options?: DiagramWriteOptions): string;
  read(source: string, options?: DiagramReadOptions): DiagramRead;
  fileSource(model: DiagramModel, options?: DiagramWriteOptions): string;
  standaloneSource(model: DiagramModel, options?: DiagramWriteOptions): string;
  fromStandalone(source: string): DiagramStandalone;
  fromFile(name: string, content: string): string;
  insertText(code: string): string;
  fixPrompt(code: string, log: string): DiagramFixPrompt;
  seeds: { math: string; code: string };
  snippets: Record<DiagramSnippetId, string>;
}
