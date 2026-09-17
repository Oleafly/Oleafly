export const SAMPLE_DOCUMENT = String.raw`\documentclass{report}
\usepackage{amsmath,amsthm,xcolor,graphicx,booktabs}
\newtheorem{lemma}{Lemma}
\begin{document}
\part{Widgets}
\chapter{Rendering}
\section{Inline and display math}
Einstein wrote $E = mc^2$ here\footnote{A short note.} and continued.
\begin{equation}
  \int_0^1 x^2 \, dx = \frac{1}{3}
\end{equation}
\begin{lemma}[Small]
  Every widget renders in place.
\end{lemma}
\textcolor{red}{Red text} and \colorbox{yellow}{boxed text}.
\begin{table}[h]
  \centering
  \begin{tabular}{lcr}
    \hline
    Name & Count & Share \\
    \hline
    Alpha & 1 & 10\% \\
    Beta & 2 & 20\% \\
    \hline
  \end{tabular}
  \caption{A small table}
  \label{tab:small}
\end{table}
\end{document}
`;

export const TITLE_DOCUMENT = String.raw`\documentclass{article}
\title{A \textbf{bold} title}
\author{Ann \and Bob}
\begin{document}
\maketitle
Body text.
\end{document}
`;

export const LIST_DOCUMENT = String.raw`\begin{document}
\section{Lists}
\begin{itemize}
  \item First
  \item Second
\end{itemize}
\begin{description}
  \item[Term] Meaning
\end{description}
Tail
\end{document}
`;

export function positionOf(doc: string, needle: string, occurrence = 0): number {
  let index = -1;
  for (let count = 0; count <= occurrence; count += 1) {
    index = doc.indexOf(needle, index + 1);
    if (index === -1) throw new Error(`"${needle}" not found`);
  }
  return index;
}
