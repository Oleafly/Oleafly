import {
  type MermaidExtras,
  mermaidBlocks,
  mermaidFileSource,
  modelToMermaid,
  readMermaid,
} from "../mermaid";
import { mermaidCodeFence } from "./mermaid-figure";
import type { DiagramLanguage, DiagramWriteOptions } from "./types";

const extrasOf = (options?: DiagramWriteOptions) => (options?.extras as MermaidExtras | null | undefined) ?? null;

const isMarkdown = (name: string) => /\.(?:md|markdown)$/i.test(name);

export const mermaidLanguage: DiagramLanguage = {
  id: "mermaid",
  name: "Mermaid",
  extension: "mmd",
  documentExtensions: [".md", ".markdown"],
  importExtensions: [".mmd", ".md"],
  vector: true,
  load: () => Promise.resolve(),
  ready: () => true,
  write: (model, options) => modelToMermaid(model, { extras: extrasOf(options) }),
  read: (source, options) => readMermaid(source, options),
  fileSource: (model, options) => `${mermaidFileSource(model, { extras: extrasOf(options) })}\n`,
  standaloneSource: (model, options) =>
    `${mermaidCodeFence(mermaidFileSource(model, { extras: extrasOf(options) }))}\n`,
  fromStandalone: (source) => ({ code: mermaidBlocks(source)[0]?.code ?? source }),
  fromFile: (name, content) => (isMarkdown(name) ? (mermaidBlocks(content)[0]?.code ?? content) : content),
  insertText: (code) => `${mermaidCodeFence(code)}\n`,
  seeds: { math: "$$E = mc^2$$", code: "print(x)" },
  snippets: {
    rectangleNode: 'n["Label"]\n',
    circleNode: 'm(("Circle"))\n',
    arrowEdge: "n --> m\n",
    lineEdge: "n --- m\n",
    scope: 'subgraph g ["Group"]\n  \nend\n',
  },
};
