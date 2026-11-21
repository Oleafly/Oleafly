import type { ProjectWritingFile } from "../index";

export const MAIN = String.raw`\documentclass[10pt,twocolumn,letterpaper]{article}
\usepackage[review]{cvpr}
\usepackage{amsmath}
\title{Sparse Fields for Fast View Synthesis}
\begin{document}
\twocolumn[{\renewcommand\twocolumn[1][]{#1}\maketitle
\begin{center}
\captionsetup{type=figure}
\includegraphics[width=\textwidth]{figs/teaser}
\caption{Our method renders a scene in real time.}
\label{fig:teaser}
\end{center}}]
\begin{abstract}
We present sparse fields for view synthesis. Code will be released at \url{https://oleafly.edu/sparse-fields}.
\end{abstract}
\input{sec/intro}
\input{sec/method}
\include{sec/experiments}
\end{document}
\begin{table}\caption{After the end.}\end{table}
`;

export const INTRO = String.raw`\section{Introduction}
\label{sec:intro}
View synthesis needs dense samples~\cite{mildenhall2020nerf}. We show more scenes in the supplementary material.
Proofs are in Appendix~\ref{sec:proofs}.
See the supplementary (Sec.~\ref{sec:missing}) for timing.
% We will add more baselines in the final version.
`;

export const METHOD = String.raw`\section{Method}
\label{sec:method}
\subsection{Sparse fields}
We model the scene as
\begin{equation}
  f(x) = \sum_i w_i \phi(x - c_i).
  \label{eq:field}
\end{equation}
The loss is
\begin{align}
  L &= L_{\text{rgb}} + \lambda L_{\text{sparse}}, \\
  L_{\text{sparse}} &= \sum_i |w_i| \nonumber \\
  &\quad + \mu R.
\end{align}
\subsection{Rendering}
We render with
\begin{equation*}
  C = \int T(t) \sigma(t) c(t) \, dt.
\end{equation*}
\begin{figure}[t]
\centering
\includegraphics[width=\linewidth]{figs/pipeline}
\caption{Pipeline overview.}
\label{fig:pipeline}
\end{figure}
`;

export const EXPERIMENTS = String.raw`\section{Experiments}
\subsection{Setup}
We train for 30k steps on one GPU.
\begin{table}[t]
\centering
\begin{tabular}{lc}
Method & PSNR \\
Ours & 31.2 \\
\end{tabular}
\caption{Results on the synthetic scenes.}
\label{tab:synthetic}
\end{table}
\begin{table*}[t]
\caption{Results on real scenes.}
\label{tab:real}
\end{table*}
\subsection{Ablation}
\begin{figure*}[t]
\includegraphics{figs/qualitative}
\caption{Qualitative results.}
\label{fig:qualitative}
\end{figure*}
We will release the trained models.
\section*{Acknowledgements}
We thank the lab.
`;

export const SUPP = String.raw`\documentclass[10pt,twocolumn,letterpaper]{article}
\usepackage{cvpr}
\begin{document}
\section{Proofs}
\label{sec:proofs}
In this supplementary material, we prove the bound.
\section{More scenes}
\label{sec:more-scenes}
We will release the data with the code.
\end{document}
`;

export const REBUTTAL = String.raw`\documentclass[10pt,twocolumn,letterpaper]{article}
\usepackage[rebuttal]{cvpr}
\begin{document}
We thank the reviewers for their careful reading.
\textbf{R1 (ablation).} We will add the ablation on $\lambda$ in the final version.
\textbf{R2 (scenes).} We will include more scenes in Sec.~\ref{sec:more-scenes}.
\textbf{R3 (speed).} As shown in the supplementary, we run at 30 FPS.
\end{document}
`;

export const REVIEWS = `# Reviewer 1

**Summary.** The paper proposes sparse fields.

**Weaknesses**
1. The gains in Table 2 are small on real scenes.
2. Fig. 3 lacks a comparison with dense baselines.
3) Eq. (2) mixes two losses without explanation.

# Reviewer 2
- Section 3.1 does not state the training hardware.
- Line 123 has a typo.
- The novelty over prior sparse methods is unclear.
- Table 9 is never discussed.
`;

export const CVPR_PROJECT: ProjectWritingFile[] = [
  { path: "main.tex", content: MAIN },
  { path: "sec/intro.tex", content: INTRO },
  { path: "sec/method.tex", content: METHOD },
  { path: "sec/experiments.tex", content: EXPERIMENTS },
  { path: "supp.tex", content: SUPP },
  { path: "rebuttal.tex", content: REBUTTAL },
  { path: "reviews.md", content: REVIEWS },
];
