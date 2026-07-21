export const PREAMBLE = [
  "\\documentclass[11pt]{article}",
  "\\usepackage[utf8]{inputenc}",
  "\\usepackage[T1]{fontenc}",
  "\\usepackage[margin=1in]{geometry}",
  "\\usepackage{amsmath,amssymb}",
  "\\usepackage{graphicx}",
  "\\usepackage{hyperref}",
  "\\setlength{\\parskip}{0.5em}",
  "\\setlength{\\parindent}{0pt}",
].join("\n");

export const SECTION_CMD: Record<1 | 2 | 3, string> = {
  1: "\\section",
  2: "\\subsection",
  3: "\\subsubsection",
};

export function figureBlock(name: string): string {
  return [
    "\\begin{figure}[htbp]",
    "  \\centering",
    `  \\includegraphics[width=\\linewidth]{assets/${name}}`,
    "\\end{figure}",
  ].join("\n");
}
