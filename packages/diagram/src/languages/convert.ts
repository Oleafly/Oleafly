import type { DiagramModel } from "@oleafly/latex";
import type { DiagramLanguageId } from "./types";

type MathConverter = (latex: string) => string;

const TEX_CODE = /^\\texttt\{([^{}]*)\}$/;
const RAW_CODE = /^`([^`]+)`$/;

function mathBody(label: string, language: DiagramLanguageId): string | null {
  const pattern = language === "mermaid" ? /^\$\$([^$]+)\$\$$/ : /^\$([^$]+)\$$/;
  return pattern.exec(label)?.[1] ?? null;
}

function codeBody(label: string, language: DiagramLanguageId): string | null {
  if (language === "tikz") return TEX_CODE.exec(label)?.[1] ?? null;
  if (language === "typst") return RAW_CODE.exec(label)?.[1] ?? null;
  return null;
}

function mathLabel(body: string, from: DiagramLanguageId, to: DiagramLanguageId, latexToTypst: MathConverter | null): string {
  if (to === "mermaid") return `$$${body}$$`;
  if (to === "typst" && from !== "typst" && latexToTypst) return `$${latexToTypst(body)}$`;
  return `$${body}$`;
}

function codeLabel(body: string, to: DiagramLanguageId): string {
  if (to === "tikz") return String.raw`\texttt{${body}}`;
  if (to === "typst") return `\`${body}\``;
  return body;
}

export function convertLabel(
  label: string,
  from: DiagramLanguageId,
  to: DiagramLanguageId,
  latexToTypst: MathConverter | null,
): string {
  if (from === to) return label;
  const math = mathBody(label, from);
  if (math !== null) return mathLabel(math, from, to, latexToTypst);
  const code = codeBody(label, from);
  return code === null ? label : codeLabel(code, to);
}

export function convertModelLabels(
  model: DiagramModel,
  from: DiagramLanguageId,
  to: DiagramLanguageId,
  latexToTypst: MathConverter | null,
): DiagramModel {
  if (from === to) return model;
  return {
    ...model,
    nodes: model.nodes.map((node) => ({ ...node, label: convertLabel(node.label, from, to, latexToTypst) })),
    edges: model.edges.map((edge) =>
      edge.label === undefined ? edge : { ...edge, label: convertLabel(edge.label, from, to, latexToTypst) },
    ),
  };
}

export async function convertModel(
  model: DiagramModel,
  from: DiagramLanguageId,
  to: DiagramLanguageId,
): Promise<DiagramModel> {
  if (from === to) return model;
  const needsMath = to === "typst" && from !== "typst";
  const converter = needsMath
    ? await import("@oleafly/editor/latex-to-typst-math").then(
        (module) => (latex: string) => module.latexMathToTypst(latex),
        () => null,
      )
    : null;
  return convertModelLabels(model, from, to, converter);
}
