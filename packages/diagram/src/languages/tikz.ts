import {
  buildStandaloneDoc,
  DIAGRAM_LIBS,
  diagramFromSource,
  importTikz,
  modelToTikz,
  serializeDiagram,
} from "@oleafly/latex";
import type { DiagramLanguage, DiagramNote } from "./types";

function notesFor(source: string): DiagramNote[] {
  return importTikz(source).unsupported.map((item) =>
    item === "truncated" ? { kind: "dropped", code: "truncated" } : { kind: "dropped", code: "tikzCommand", detail: item },
  );
}

function documentBody(source: string): DiagramStandaloneBody {
  const begin = source.indexOf(String.raw`\begin{document}`);
  const end = source.lastIndexOf(String.raw`\end{document}`);
  if (begin < 0 || end < begin) return { code: source };
  const body = source.slice(begin + String.raw`\begin{document}`.length, end);
  const color = /\\definecolor\{obgcolor\}\{HTML\}\{([0-9A-Fa-f]{6})\}/.exec(source);
  const code = body
    .split("\n")
    .filter((line) => !/^\s*\\(?:definecolor\{obgcolor\}|pagecolor\{obgcolor\})/.test(line))
    .join("\n")
    .trim();
  return color ? { code, background: `#${color[1].toLowerCase()}` } : { code };
}

interface DiagramStandaloneBody {
  code: string;
  background?: string;
}

export const tikzLanguage: DiagramLanguage = {
  id: "tikz",
  name: "TikZ",
  extension: "tikz",
  documentExtensions: [".tex", ".latex", ".ltx"],
  importExtensions: [".tikz", ".tex"],
  vector: false,
  load: () => Promise.resolve(),
  ready: () => true,
  write: (model) => modelToTikz(model),
  read: (source) => ({ model: diagramFromSource(source), extras: null, notes: notesFor(source) }),
  fileSource: (model) => serializeDiagram(model),
  standaloneSource: (model) =>
    buildStandaloneDoc({ code: serializeDiagram(model), libraries: DIAGRAM_LIBS, background: model.background }),
  fromStandalone: documentBody,
  fromFile: (_name, content) => content,
  insertText: (code) => `${code.trim()}\n`,
  fixPrompt: (code, log) => ({
    system: String.raw`You fix LaTeX/TikZ figure code so it compiles under Tectonic (XeLaTeX) in a standalone document with tikz + shapes.geometric, arrows.meta, positioning, calc, backgrounds loaded. Return ONLY the corrected figure body: the \begin{tikzpicture}...\end{tikzpicture} plus any \definecolor lines. No preamble, no \documentclass, no explanation, no markdown code fences. Never use em dashes.`,
    user: `This TikZ figure failed to compile. Fix it.\n\nCODE:\n${code}\n\nCOMPILE LOG (tail):\n${log}`,
  }),
  seeds: { math: "$E = mc^2$", code: String.raw`\texttt{print(x)}` },
  snippets: {
    rectangleNode: "\\node (n) [draw, rounded corners] {Label};\n",
    circleNode: "\\node (n) [draw, circle] {};\n",
    arrowEdge: "\\draw[->] (a) -- (b);\n",
    lineEdge: "\\draw (a) -- (b);\n",
    scope: "\\begin{scope}\n  \n\\end{scope}\n",
  },
};
