import { i18n } from "@/i18n";

const FENCE = "```";
const SYNTAX_KINDS = ["chart", "plot", "csv", "latex", "typst", "mermaid", "d2", "tikz", "circuitikz", "svg", "html", "jsx", "smiles", "molecule", "sequence", "notebook", "bookmark"] as const;
type SyntaxKind = (typeof SYNTAX_KINDS)[number];

function hasSyntax(kind: string): kind is SyntaxKind {
  return (SYNTAX_KINDS as readonly string[]).includes(kind);
}

const SYNTAX_EXAMPLES: Partial<Record<SyntaxKind, string>> = {
  tikz: String.raw`\draw (0,0) -- (2,1) node[right] {A};`,
  circuitikz: String.raw`\draw (0,0) to[R, l=$R_1$] (2,0);`,
};

export function blockSyntax(kind: string): string | null {
  return hasSyntax(kind) ? i18n.t(($) => $.notes.blocks.syntax[kind], { example: SYNTAX_EXAMPLES[kind] }) : null;
}

const SECTIONS: readonly string[] = [
  `Note blocks. A note is Markdown. Rich content goes in fenced code blocks whose info string names the block. People see each block drawn in place and can switch to its source. Write data and settings, not code, unless the block runs code (html, jsx). Files a block reads live in the note's folder, written as a relative path such as assets/data.csv.`,
  `Chart: ${FENCE}chart with JSON: {"type":"bar|line|area|scatter|pie|donut|histogram","title":"","description":"","note":"","unit":"","xLabel":"","yLabel":"","yScale":"linear|log","stacked":false,"bins":20,"categories":["A","B"],"series":[{"name":"Run 1","values":[1,2],"errors":[0.1,0.2]}]}. bar (default), line and area need categories and one value per category in each series; errors are optional, non-negative and the same length. stacked works for bar and area. pie and donut use categories and the first series. scatter gives each series "points":[[x,y],...] (a third number is its error bar) instead of values. histogram takes raw samples in values and optional bins (1 to 100). At most 8 series and 5000 points. yScale log needs positive values and does not apply to pie, donut or histogram. Numbers only, never expressions.`,
  `Plot (functions): ${FENCE}plot with one item per line. y = x^2 - 1 (or f(x) = ...) draws a function of x. x = cos(t), y = sin(t) draws a parametric curve. Options: domain: -5, 5 (x range, default -10, 10), range: -2, 2 (y range, default automatic), t: 0, 2*pi, labels: x label, y label, point: 1, 0, Root (x, y, optional label; repeatable), title: text. Lines starting with # are ignored. Expressions allow numbers, + - * / ^, parentheses, implicit multiplication (2x, 3sin(x)), pi, e, and sin cos tan asin acos atan sinh cosh tanh exp ln log (natural) log10 sqrt abs floor ceil min max. At most 8 curves and 50 points.`,
  `Table: ${FENCE}csv or ${FENCE}tsv with the data inline (first row is the header), or a line path: assets/results.csv (also .tsv, .xlsx, .xls) with an optional sheet: Sheet1 for spreadsheets. Add thousands: yes to read 1,234 as a number. People can sort, filter and see count, mean, min and max of numeric columns.`,
  String.raw`Math: ${FENCE}latex holds display LaTeX (equation, align and similar environments). Chemistry formulas work with \ce{H2O} and units with \pu{} (mhchem). Inline math in prose uses $...$ and display math uses $$...$$.`,
  `Typst: ${FENCE}typst holds a Typst snippet such as $ E = m c^2 $ and is compiled to an image. No packages from the network.`,
  `Diagram: ${FENCE}mermaid holds a Mermaid diagram (flowchart, sequenceDiagram, classDiagram, stateDiagram, gantt, pie, erDiagram, mindmap, timeline).`,
  `D2: ${FENCE}d2 holds a D2 diagram, such as a -> b: label, with shapes, containers ({ }), direction: right and classes. Layout is dagre; the elk and tala layouts and imports of other files are not available. Icons from the network are not shown.`,
  String.raw`TikZ: ${FENCE}tikz holds a tikzpicture, or bare TikZ commands that are wrapped in one. ${FENCE}circuitikz holds a circuitikz environment or bare CircuiTikZ commands. Lines before the picture (\usetikzlibrary, \usepackage, \tikzset, \ctikzset) go in the preamble, and a full \documentclass document is compiled as written. LaTeX compiles it with the app's bundled engine; shell escape is off. The person can add shared preamble lines in Settings, and in a shared note the block waits for them to click Draw.`,
  `SVG: ${FENCE}svg holds one <svg> element. Scripts, event handlers, links, animations, external references and remote images are removed.`,
  `HTML: ${FENCE}html holds a full HTML document or a fragment with CSS and scripts. It runs in a sandbox with no network: remote scripts, styles, fonts and images are left out, except script tags for Tailwind, d3, Chart.js, Papa Parse, lodash, Recharts, React, ReactDOM and Babel standalone (type="text/babel" scripts), which use the bundled copy. Inline your data. People click Run before scripts start.`,
  `React: ${FENCE}jsx (or tsx, react) holds one React component file with a default export, hooks and Tailwind classes, like a React artifact. Imports available offline: react, react-dom, lucide-react, recharts, d3, lodash (and lodash/<name>), papaparse, chart.js. Anything else fails with a message. No network and no fetch; inline your data. People click Run before it starts.`,
  `Chemical structures: ${FENCE}smiles with one SMILES string per line, optionally named as Name: SMILES (or SMILES name), for example Aspirin: CC(=O)OC1=CC=CC=C1C(=O)O. Each is drawn in 2D; at most 24 per block.`,
  `3D molecule: ${FENCE}molecule (or pdb, mol, sdf, xyz, cif, mol2) with option lines first, then the file text inline or a path: assets/1abc.pdb line. Options: format: pdb|sdf|mol|xyz|cif|mol2, style: cartoon|stick|sphere|line, color: spectrum|chain|element|residue|ss.`,
  `Sequence: ${FENCE}sequence (or fasta) with FASTA records (>header lines followed by residues) or a raw sequence. Whitespace and digits are ignored, ; lines are comments, - and . are gaps. DNA, RNA and protein are detected; people can show the reverse complement and translation of DNA.`,
  `Notebook: ${FENCE}notebook with the .ipynb path on the first line, then optional cells: 2-5 and code: hide.`,
  `Bookmark: ${FENCE}bookmark is a link card with one field per line: url: https://... first, then optional title:, description:, image:, site: and favicon:, each on one line. Write only fields you know; people see the title, description and site as a card that opens the page.`,
  `Code: a fence with a language (python, r, julia, matlab, octave, javascript, typescript, rust, c, cpp, java, go, sql, bash, shell, json, yaml, toml, latex, fortran, and more) is highlighted and stays editable. It does not run.`,
];

export function noteBlockGuide(): string {
  return SECTIONS.join("\n\n");
}
