# Beamer decks

## Preamble

Keep it small. Every package you add is another thing that can fail on a machine that is not yours.

```latex
\documentclass[aspectratio=169]{beamer}
\usetheme{Madrid}
\usecolortheme{default}
\usepackage[T1]{fontenc}
\usepackage{graphicx}
\usepackage{booktabs}
\graphicspath{{../figures/}}
\setbeamertemplate{navigation symbols}{}
\setbeamertemplate{footline}[frame number]
```

`aspectratio=169` matches every projector built in the last decade. Use `43` only when the venue says so.

`\setbeamertemplate{navigation symbols}{}` removes the small arrow cluster in the corner that nobody has ever clicked.

`\graphicspath` pointing at the paper's figures directory means you reuse the figures instead of copying them. Get the relative path right for where the deck file lives: from `slides/main.tex`, the paper's `figures/` is `../figures/`.

Themes: Madrid and Boadilla are safe defaults. Metropolis looks better but needs its own package, which may not be in the bundle. Check with a compile before committing to it.

## Structure

```latex
\title{The claim, not the topic}
\subtitle{}
\author{Name}
\institute{Institution}
\date{Venue, date}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\section{Problem}
\begin{frame}{Why this matters}
\end{frame}

\end{document}
```

`\section` gives you the structure for a progress bar or a table of contents. For a 15 minute talk, skip the outline slide. It costs 30 seconds to tell an audience what you are about to tell them.

For a 45 minute seminar, an outline slide earns its place, and so do section divider slides:

```latex
\AtBeginSection[]{
  \begin{frame}
    \vfill
    \centering
    \begin{beamercolorbox}[sep=8pt,center,shadow=true,rounded=true]{title}
      \usebeamerfont{title}\insertsectionhead\par
    \end{beamercolorbox}
    \vfill
  \end{frame}
}
```

## Frame patterns

**One message.** The frame title is the message, in a full sentence. "Accuracy improves 12 points on held-out sites" beats "Results".

```latex
\begin{frame}{Removing the largest site does not change the effect}
  \centering
  \includegraphics[width=0.8\textwidth]{ablation}
\end{frame}
```

**Figure with a takeaway.**

```latex
\begin{frame}{The effect is concentrated in the first six months}
  \begin{columns}[T]
    \column{0.6\textwidth}
      \includegraphics[width=\textwidth]{timecourse}
    \column{0.4\textwidth}
      \begin{itemize}
        \item Peak at month 4
        \item Flat after month 6
        \item Same shape in both cohorts
      \end{itemize}
  \end{columns}
\end{frame}
```

**A table, trimmed.** A paper table has ten columns. A slide table has three. Cut to the comparison you are actually making.

```latex
\begin{frame}{Our method wins on the two hardest splits}
  \centering
  \begin{tabular}{lrr}
    \toprule
    Method & Split A & Split B \\
    \midrule
    Baseline & 71.2 & 64.8 \\
    Ours & \textbf{83.4} & \textbf{79.1} \\
    \bottomrule
  \end{tabular}
\end{frame}
```

**Progressive reveal.** Use `\pause` sparingly, and only where the audience genuinely should not see the next line yet.

```latex
\begin{frame}{Two things had to be true}
  \begin{itemize}
    \item The signal survives the filter \pause
    \item The filter does not remove the effect \pause
    \item Neither had been tested
  \end{itemize}
\end{frame}
```

Every `\pause` makes another PDF page, so a deck with heavy pausing has a page count far above its slide count. Count slides, not pages.

**Backup slides.** Put them after a final frame, and mark the boundary so you do not walk into them by accident.

```latex
\appendix
\begin{frame}{Backup: full ablation table}
\end{frame}
```

## Citations

Three or four, in small text at the bottom of the slide that needs them.

```latex
\begin{frame}{Prior work stopped at two sites}
  \begin{itemize}
    \item Single-site studies dominate the literature
  \end{itemize}
  \vfill
  {\tiny Smith et al., 2023; Okafor and Lee, 2024}
\end{frame}
```

Using `biblatex` in a deck works, but it adds a bibliography build to a document that has four references in it. Hand-written short citations are usually the better trade. If the deck does use `biblatex`, remember the `.bbl` is built by the same bibliography step as the paper, so the deck needs its own compile.

## What ruins decks

- Full sentences in bullet points. The audience reads them and stops listening to you.
- More than six lines on a slide.
- A figure copied from the paper at paper font size, which is unreadable from row eight.
- Font smaller than the theme default. If it does not fit, it is two slides.
- A table lifted whole from the paper.
- Reading the slide aloud.
- Running over time. Every minute over is a minute stolen from the next speaker.

## Overflow

Beamer does not clip; it lets content run off the bottom of the slide, where the projector will not show it. The log says `Overfull \vbox`. Always look at the rendered pages with `verify_pdf_pages` or `get_pdf_text` rather than trusting a clean compile.

The fixes, in order of preference: split the frame, cut a bullet, shrink the figure, and only then reduce the font with `\small` on that frame alone. `\tiny` on a slide is a sign the content was never cut.
