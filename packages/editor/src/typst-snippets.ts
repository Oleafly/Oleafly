import {
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { createCompletionRequestGuard } from "./completion-request";
import {
  boundedCompletionContext,
  shouldRunCompletionSource,
} from "./completion-trigger";
import { guardCompletionForSource } from "./latex";
import { editorMessage, type EditorMessageKey } from "./messages";
import { typstContextAt } from "./typst-editing";
import { typstStyleVersion } from "./bibliography-styles";
import { MULTIPLE_BIBLIOGRAPHIES_SINCE, typstVersionAtLeast } from "./typst-bibliography-parameters";

export interface TypstSnippet {
  readonly label: string;
  readonly detail: EditorMessageKey;
  readonly template: string;
  readonly since?: readonly [number, number];
}

export const TYPST_SNIPPETS: readonly TypstSnippet[] = [
  { label: "/heading", detail: "typst.snippet.heading", template: "= ${1}" },
  {
    label: "/figure",
    detail: "typst.snippet.figure",
    template: '#figure(\n  image("${1}"),\n  caption: [${2}],\n) <fig:${3}>',
  },
  {
    label: "/tablefigure",
    detail: "typst.snippet.tableFigure",
    template:
      "#figure(\n  table(\n    columns: ${1:2},\n    [${2}], [${3}],\n  ),\n  caption: [${4}],\n) <tab:${5}>",
  },
  {
    label: "/table",
    detail: "typst.snippet.table",
    template: "#table(\n  columns: ${1:2},\n  [${2}], [${3}],\n)",
  },
  { label: "/equation", detail: "typst.snippet.equation", template: "$ ${1} $" },
  {
    label: "/numberedequation",
    detail: "typst.snippet.numberedEquation",
    template: '#math.equation(block: true, numbering: "(1)", $ ${1} $) <eq:${2}>',
  },
  { label: "/footnote", detail: "typst.snippet.footnote", template: "#footnote[${1}]" },
  { label: "/quote", detail: "typst.snippet.quote", template: "#quote(block: true)[${1}]" },
  { label: "/code", detail: "typst.snippet.code", template: "```${1}\n${2}\n```" },
  { label: "/outline", detail: "typst.snippet.outline", template: "#outline()" },
  {
    label: "/bibliography",
    detail: "typst.snippet.bibliography",
    template: '#bibliography("${1}")',
  },
  {
    label: "/partbibliography",
    detail: "typst.snippet.partBibliography",
    template:
      '#bibliography(\n  "${1:refs.bib}",\n  title: [${2:References}],\n  target: selector(cite).within(<${3:part}>),\n  group: ${4:none},\n)',
    since: MULTIPLE_BIBLIOGRAPHIES_SINCE,
  },
  { label: "/pagebreak", detail: "typst.snippet.pagebreak", template: "#pagebreak()" },
  { label: "/columns", detail: "typst.snippet.columns", template: "#columns(${1:2})[${2}]" },
  {
    label: "/grid",
    detail: "typst.snippet.grid",
    template: "#grid(\n  columns: ${1:2},\n  gutter: ${2:1em},\n  [${3}], [${4}],\n)",
  },
  { label: "/link", detail: "typst.snippet.link", template: '#link("${1}")[${2}]' },
  { label: "/list", detail: "typst.snippet.list", template: "- ${1}" },
  { label: "/enum", detail: "typst.snippet.enum", template: "+ ${1}" },
  { label: "/terms", detail: "typst.snippet.terms", template: "/ ${1}: ${2}" },
];

const SLASH_COMMAND = /(?:^|\s)(\/[A-Za-z]*)$/u;

export function typstSlashCompletions(
  context: CompletionContext,
): CompletionResult | null {
  if (!shouldRunCompletionSource(context, "typst")) return null;
  const before = boundedCompletionContext(context.state, context.pos);
  const match = SLASH_COMMAND.exec(before);
  if (!match) return null;
  const from = context.pos - match[1].length;
  if (typstContextAt(context.state, from) !== "markup") return null;
  const guard = createCompletionRequestGuard(context);
  const version = typstStyleVersion();
  return {
    from,
    options: TYPST_SNIPPETS.filter((entry) => !entry.since || typstVersionAtLeast(version, entry.since)).map((entry) =>
      guardCompletionForSource(guard, {
        label: entry.label,
        type: "snippet",
        detail: editorMessage(entry.detail),
        apply: snippet(entry.template),
      } satisfies Completion),
    ),
  };
}
