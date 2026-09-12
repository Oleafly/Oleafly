export const PREAMBLE = [
  String.raw`\documentclass[11pt]{article}`,
  String.raw`\usepackage[utf8]{inputenc}`,
  String.raw`\usepackage[T1]{fontenc}`,
  String.raw`\usepackage[margin=1in]{geometry}`,
  String.raw`\usepackage{amsmath,amssymb}`,
  String.raw`\usepackage{graphicx}`,
  String.raw`\usepackage{hyperref}`,
  String.raw`\setlength{\parskip}{0.5em}`,
  String.raw`\setlength{\parindent}{0pt}`,
].join("\n");

export const SECTION_CMD: Record<1 | 2 | 3, string> = {
  1: String.raw`\section`,
  2: String.raw`\subsection`,
  3: String.raw`\subsubsection`,
};

export function figureBlock(name: string): string {
  return [
    String.raw`\begin{figure}[htbp]`,
    String.raw`  \centering`,
    String.raw`  \includegraphics[width=\linewidth]{assets/${name}}`,
    String.raw`\end{figure}`,
  ].join("\n");
}
