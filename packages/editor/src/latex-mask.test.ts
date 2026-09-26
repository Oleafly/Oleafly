import { describe, it, expect } from "vitest";
import {
  intersectsMaskedRegion,
  maskLatex,
  maskLatexForProse,
  maskLatexForProseRegions,
  maskToProse,
  spellcheckRanges,
} from "./latex-mask";

function words(tex: string): Set<string> {
  return new Set(spellcheckRanges(tex).map((r) => r.word));
}

describe("maskLatex", () => {
  it("preserves length so offsets map 1:1 onto the document", () => {
    const samples = [
      "Plain prose with no macros.",
      "\\section{Title} body \\cite{key} and $x^2$ done.",
      "\\begin{equation}E = mc^2\\end{equation}\ntext",
      "accented café naïve résumé",
    ];
    for (const s of samples) expect(maskLatex(s)).toHaveLength(s.length);
  });

  it("never blanks newlines (line numbers stay aligned)", () => {
    const s = "line one\n\\cite{x}\nline three";
    const masked = maskLatex(s);
    expect(masked.split("\n")).toHaveLength(s.split("\n").length);
  });

  it("masks a whole control sequence spelled with Unicode letters", () => {
    const w = words(String.raw`Text \výsledek konec a \αβ dále Dvo\v{r}ák`);
    expect(w.has("sledek")).toBe(false);
    expect(w.has("ýsledek")).toBe(false);
    expect(w.has("Text")).toBe(true);
    expect(w.has("konec")).toBe(true);
  });

  describe("removes non-prose (false positives)", () => {
    it("drops \\ref / \\eqref / \\cite / \\label keys", () => {
      const w = words("See \\eqref{eq:sdpa} and \\cite{vaswani2017}; \\label{sec:intro}.");
      expect(w.has("eq")).toBe(false);
      expect(w.has("sdpa")).toBe(false);
      expect(w.has("vaswani")).toBe(false);
      expect(w.has("sec")).toBe(false);
      expect(w.has("intro")).toBe(false);
    });

    it("drops \\usepackage / \\documentclass / \\includegraphics arguments", () => {
      const w = words("\\documentclass{article}\\usepackage{amsmath}\\includegraphics{fig/plot.png}");
      expect(w.has("article")).toBe(false);
      expect(w.has("amsmath")).toBe(false);
      expect(w.has("plot")).toBe(false);
      expect(w.has("fig")).toBe(false);
    });

    it("drops preamble document metadata", () => {
      const w = words(
        "\\title{MetadataQwertzuiopz}\\author{AuthorQwertzuiopz}\\date{DateQwertzuiopz}",
      );
      expect(w.has("MetadataQwertzuiopz")).toBe(false);
      expect(w.has("AuthorQwertzuiopz")).toBe(false);
      expect(w.has("DateQwertzuiopz")).toBe(false);
    });

    it("masks math environments (equation, align)", () => {
      const w = words("\\begin{align}\\mathrm{Attention}(Q,K,V) = \\mathrm{softmax}(QK)V\\end{align}");
      expect(w.has("Attention")).toBe(false);
      expect(w.has("softmax")).toBe(false);
      expect(w.has("align")).toBe(false);
    });

    it("masks inline and bracket math", () => {
      const w = words("value $x_{ij}^2$ and \\[ \\gamma = \\beta \\] end");
      expect(w.has("ij")).toBe(false);
      expect(w.has("gamma")).toBe(false);
      expect(w.has("beta")).toBe(false);
      expect(w.has("value")).toBe(true);
      expect(w.has("end")).toBe(true);
    });

    it("masks verbatim / code environments", () => {
      const w = words("\\begin{verbatim}\nfor i in range(10): teh code\n\\end{verbatim}");
      expect(w.has("teh")).toBe(false);
      expect(w.has("code")).toBe(false);
      expect(w.has("verbatim")).toBe(false);
    });

    it("drops \\begin/\\end environment names but keeps the body", () => {
      const w = words("\\begin{itemize}\\item Real prose here\\end{itemize}");
      expect(w.has("itemize")).toBe(false);
      expect(w.has("Real")).toBe(true);
      expect(w.has("prose")).toBe(true);
    });

    it("blanks a line-break spacing unit like \\\\[3pt]", () => {
      expect(words("Name\\\\[3pt] Title").has("pt")).toBe(false);
    });

    it("ignores comments", () => {
      const w = words("real text % teh commented mistake here\nmore");
      expect(w.has("teh")).toBe(false);
      expect(w.has("commented")).toBe(false);
      expect(w.has("real")).toBe(true);
      expect(w.has("more")).toBe(true);
    });
  });

  describe("keeps real prose (no false negatives)", () => {
    it("keeps section titles and text-formatting arguments", () => {
      const w = words("\\section{Introduction} \\textbf{Bold claim} \\emph{stressed}");
      expect(w.has("Introduction")).toBe(true);
      expect(w.has("Bold")).toBe(true);
      expect(w.has("claim")).toBe(true);
      expect(w.has("stressed")).toBe(true);
    });

    it("keeps unknown/custom macro prose arguments", () => {
      const w = words("\\role{Senior Software Engineer}{Google}");
      expect(w.has("Senior")).toBe(true);
      expect(w.has("Software")).toBe(true);
      expect(w.has("Engineer")).toBe(true);
      expect(w.has("Google")).toBe(true);
    });

    it("keeps a real misspelling so it can be flagged", () => {
      // Regression for: 'Senior Softwar Engineer' produced no warning.
      expect(words("Senior Softwar Engineer").has("Softwar")).toBe(true);
    });

    it("keeps visible \\href text while masking its URL", () => {
      const hw = words("\\href{https://alexchen.dev}{alexchen.dev} \\href{mailto:a@b.com}{a@b.com}");
      expect(hw.has("alexchen")).toBe(true);
      expect(hw.has("dev")).toBe(true);
      expect(hw.has("com")).toBe(false);
    });

    it("for \\textcolor, drops the color but keeps the shown text", () => {
      const cw = words("\\textcolor{red}{Hello there}");
      expect(cw.has("red")).toBe(false);
      expect(cw.has("Hello")).toBe(true);
      expect(cw.has("there")).toBe(true);
    });

    it("blanks dimension arguments of \\vspace / \\hspace", () => {
      const w = words("\\vspace{2pt} real text \\hspace{1.5in} more");
      expect(w.has("pt")).toBe(false);
      expect(w.has("in")).toBe(false);
      expect(w.has("real")).toBe(true);
      expect(w.has("more")).toBe(true);
    });

    it("keeps table cell prose (tabular is not opaque)", () => {
      const w = words("\\begin{tabular}{lc} Model & Result \\\\ Transformer & Best \\end{tabular}");
      expect(w.has("Model")).toBe(true);
      expect(w.has("Transformer")).toBe(true);
    });
  });

  it("reports word ranges that slice back to the original text", () => {
    const src = "A \\cite{k} boundary word.";
    for (const r of spellcheckRanges(src)) {
      expect(src.slice(r.from, r.to)).toBe(r.word);
    }
  });
});

describe("maskToProse (Harper input)", () => {
  it("collapses masking gaps so there are no multi-space runs", () => {
    // The gaps a masked \command leaves behind are what triggered Harper's
    // 'N spaces where there should be only one' false positives.
    const { prose } = maskToProse("Alpha \\hypersetup{colorlinks=true} Beta \\vspace{2pt} Gamma");
    expect(prose).not.toMatch(/ {2,}/); // no run of 2+ spaces
    expect(prose.split(/\s+/)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("does not leave a space before trailing punctuation", () => {
    // A gap left by an opaque-arg command right before punctuation must not
    // become a stray "word ." (which Harper would flag).
    const { prose } = maskToProse("End of thought\\hspace{2pt}. Next one.");
    expect(prose).toContain("thought.");
    expect(prose).not.toContain("thought .");
  });

  it("maps lint spans back to the exact original word", () => {
    const src = "Senior \\textbf{Softwar} Engineer at \\href{u}{link}.";
    const { prose, map } = maskToProse(src);
    const at = prose.indexOf("Softwar");
    expect(at).toBeGreaterThanOrEqual(0);
    const from = map[at];
    const to = map[at + "Softwar".length - 1] + 1;
    expect(src.slice(from, to)).toBe("Softwar");
  });

  it("map length matches prose length", () => {
    const { prose, map } = maskToProse("one \\cmd{x} two\n\\begin{equation}z\\end{equation} three");
    expect(map).toHaveLength(prose.length);
  });
});

describe("maskLatexForProse (Harper input)", () => {
  const FIXTURES = [
    "Plain prose with no macros.",
    "\\section{Title} body \\cite{key} and $x^2$ done.",
    "\\begin{equation}E = mc^2\\end{equation}\ntext",
    "accented café naïve résumé",
    "We compare $a$ and $b$ in \\cite{x}.",
    "\\begin{tabular}{lc} Model & Result \\\\ Transformer & Best \\end{tabular}",
    "% a comment line\nreal prose after it",
    "\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nBody.\n\\end{document}",
    "🎉 emoji before \\cite{k} and after.",
    "",
  ];

  it("returns a string of exactly the same length for every fixture", () => {
    for (const source of FIXTURES) {
      expect(maskLatexForProse(source), JSON.stringify(source)).toHaveLength(
        source.length,
      );
    }
  });

  it("keeps the line count so document offsets stay line offsets", () => {
    const source = "line one\n\\cite{x}\n\\begin{equation}a\\end{equation}\nline four";
    expect(maskLatexForProse(source).split("\n")).toHaveLength(
      source.split("\n").length,
    );
  });

  it("replaces a citation with a padded placeholder at the same offset", () => {
    const source = "A sentence with \\cite{a} in it.";
    const at = source.indexOf("\\cite{a}");
    const prose = maskLatexForProse(source);
    expect(at).toBe(16);
    expect(prose.slice(at, at + "\\cite{a}".length)).toBe("Dummy   ");
    expect(prose).toBe("A sentence with Dummy    in it.");
  });

  it("keeps the sentence readable around inline math and citations", () => {
    expect(maskLatexForProse("We compare $a$ and $b$ in \\cite{x}.")).toBe(
      "We compare X   and X   in Dummy   .",
    );
  });

  it("blanks block constructs instead of naming them", () => {
    const prose = maskLatexForProse(
      "Before.\n\\begin{equation}\nE = mc^2\n\\end{equation}\nAfter.",
    );
    expect(prose).toContain("Before.");
    expect(prose).toContain("After.");
    expect(prose).not.toContain("Dummy");
    expect(prose).not.toContain("equation");
  });

  it("blanks comments, display math, and preamble commands", () => {
    const prose = maskLatexForProse(
      "\\documentclass{article}\nText $$x+y$$ more. % trailing note\n",
    );
    expect(prose).not.toContain("Dummy");
    expect(prose).not.toContain("article");
    expect(prose).not.toContain("trailing");
    expect(prose).toContain("Text");
    expect(prose).toContain("more.");
  });

  it("keeps the argument of prose-argument commands and blanks the markup", () => {
    const prose = maskLatexForProse(
      "\\section{Results} \\emph{clear} \\textbf{gains} \\caption{A plot} \\footnote{Note} \\item[Label] tail",
    );
    for (const kept of ["Results", "clear", "gains", "A plot", "Note", "Label", "tail"]) {
      expect(prose).toContain(kept);
    }
    for (const gone of ["section", "emph", "textbf", "caption", "footnote", "item", "{", "}", "[", "]"]) {
      expect(prose).not.toContain(gone);
    }
  });

  it("uses the short placeholder when the construct cannot hold the long one", () => {
    expect(maskLatexForProse("Let $n$ be large.")).toBe("Let X   be large.");
  });

  it("never starts a placeholder against an adjacent word character", () => {
    const source = "transformer\\index{transformer} models and word\\cite{k}.";
    const prose = maskLatexForProse(source);
    expect(prose).toContain("transformer ");
    expect(prose).not.toContain("transformerDummy");
    expect(prose).not.toContain("wordDummy");
  });

  it("never writes a placeholder over a newline", () => {
    const source = "A \\(\na\\) tail.";
    const prose = maskLatexForProse(source);
    expect(prose).toHaveLength(source.length);
    expect(prose.split("\n")).toHaveLength(source.split("\n").length);
    expect(prose).not.toContain("Dummy");
  });

  it("keeps every newline inside a multi-line construct", () => {
    const source = "A \\cite{\nkey\n} tail.";
    const prose = maskLatexForProse(source);
    expect(prose).toHaveLength(source.length);
    expect(prose.split("\n")).toHaveLength(source.split("\n").length);
    expect(prose).toContain("Dummy");
    expect(prose).not.toContain("key");
  });

  it("masks a bare URL as a placeholder noun rather than a hole", () => {
    const prose = maskLatexForProse("See https://example.com/page for details.");
    expect(prose).toContain("See Dummy");
    expect(prose).not.toContain("example");
    expect(prose).toContain("for details.");
  });

  it("leaves a pasted block with no wide run of real words", () => {
    const source = String.raw`\begin{table}[t]
\centering
\caption{Results on the benchmark}
\label{tab:results}
\begin{tabular}{lcc}
\toprule
Model & Accuracy & Latency \\
\midrule
Baseline & 81.2 & 14 \\
Ours & 88.7 & 12 \\
\bottomrule
\end{tabular}
\end{table}

\begin{itemize}
  \item First point, see \cite{smith2020}.
  \item Second point with $\alpha = 0.5$ and \ref{tab:results}.
\end{itemize}`;
    const prose = maskLatexForProse(source);
    expect(prose).toHaveLength(source.length);
    expect(prose).not.toContain("tabular");
    expect(prose).not.toContain("toprule");
    expect(prose).not.toContain("smith2020");
    expect(prose).not.toContain("tab:results");
    expect(prose).toContain("First point, see Dummy");
  });

  it("keeps the exact length when the source ends in a backslash", () => {
    for (const source of ["a\\", "trailing backslash \\", "\\"]) {
      expect(maskLatex(source)).toHaveLength(source.length);
      expect(maskLatexForProse(source)).toHaveLength(source.length);
    }
  });

  it("leaves a tab between a command and its argument untouched", () => {
    for (const source of [
      "\\cite\t{key} tail",
      "\\begin\t{itemize}\nbody\n\\end\t{itemize}",
      "\\\\\t[2pt] tail",
      "\\href\t{http://a}{shown}",
      "\\hyperref\t[key]{shown}",
    ]) {
      const masked = maskLatex(source);
      expect(masked).toHaveLength(source.length);
      for (let index = 0; index < source.length; index++) {
        if (source[index] === "\t") expect(masked[index]).toBe("\t");
      }
    }
  });
});

describe("maskLatexForProseRegions", () => {
  it("reports every masked construct as a region", () => {
    const source = "and \\(c+d\\) and";
    const { prose, masked } = maskLatexForProseRegions(source);
    expect(prose).toHaveLength(source.length);
    const math = source.indexOf("\\(");
    expect(
      masked.some(
        (span) => span.from <= math && span.to >= math + 7,
      ),
    ).toBe(true);
  });

  it("reports regions in ascending, non-overlapping order", () => {
    const source = String.raw`\section{Head}
Body with \cite{key} and $x$ and \emph{stress}.`;
    const { masked } = maskLatexForProseRegions(source);
    for (let index = 1; index < masked.length; index++) {
      expect(masked[index].from).toBeGreaterThanOrEqual(
        masked[index - 1].to,
      );
    }
  });

  it("leaves untouched prose out of the region list", () => {
    const source = "We compare the the results here.";
    const { masked } = maskLatexForProseRegions(source);
    expect(masked).toEqual([]);
    expect(
      intersectsMaskedRegion(masked, 0, source.length),
    ).toBe(false);
  });
});

describe("intersectsMaskedRegion", () => {
  const masked = [
    { from: 10, to: 20 },
    { from: 30, to: 40 },
  ];

  it("reports an overlap at either edge and in the middle", () => {
    expect(intersectsMaskedRegion(masked, 5, 11)).toBe(true);
    expect(intersectsMaskedRegion(masked, 19, 25)).toBe(true);
    expect(intersectsMaskedRegion(masked, 12, 15)).toBe(true);
    expect(intersectsMaskedRegion(masked, 5, 45)).toBe(true);
  });

  it("reports no overlap for a span between regions", () => {
    expect(intersectsMaskedRegion(masked, 0, 10)).toBe(false);
    expect(intersectsMaskedRegion(masked, 20, 30)).toBe(false);
    expect(intersectsMaskedRegion(masked, 40, 50)).toBe(false);
    expect(intersectsMaskedRegion([], 0, 10)).toBe(false);
  });
});

describe("command arguments that are not prose", () => {
  const spelled = (tex: string) => spellcheckRanges(tex).map((r) => r.word);

  it("masks the issue #203 preamble and \\includesvg lines", () => {
    const source = String.raw`\documentclass{article}
\usepackage{svg}
\svgsetup{inkscapeexe={env LD_LIBRARY_PATH= inkscape}}\usepackage{graphicx} % Required
\begin{document}
Text \includesvg[width=0.5\linewidth]{imgs/udoliHora.svg} more.
\end{document}`;
    expect(spelled(source)).toEqual(["Text", "more"]);
    const prose = maskLatexForProse(source);
    for (const gone of ["inkscape", "LIBRARY", "width", "imgs", "udoliHora", "svg"]) {
      expect(prose).not.toContain(gone);
    }
    expect(prose).toContain("Text");
    expect(prose).toContain("more.");
  });

  it("masks \\svgsetup options in a fragment without a preamble", () => {
    expect(
      spelled(String.raw`\svgsetup{inkscapeexe={env LD_LIBRARY_PATH= inkscape}} Body`),
    ).toEqual(["Body"]);
  });

  it("keeps a fragment without \\begin{document} as body text", () => {
    expect(spelled(String.raw`\section{Úvod} Text kapitoly.`)).toEqual([
      "Úvod",
      "Text",
      "kapitoly",
    ]);
  });

  it("ignores a commented-out or verbatim \\begin{document}", () => {
    expect(
      spelled(String.raw`Intro text.
% \documentclass{article}\begin{document}
\begin{verbatim}
\documentclass{article}
\begin{document}
\end{verbatim}
Outro text.`),
    ).toEqual(["Intro", "text", "Outro", "text"]);
  });

  it.each([
    [String.raw`\includepdf[pages=-,scale=0.9]{prilohy/zadani_prace}`, []],
    [String.raw`\lstset{language=Python, basicstyle=\ttfamily}`, []],
    [String.raw`\tikzset{uzel/.style={circle, draw}}`, []],
    [String.raw`\captionsetup{font=footnotesize, labelfont=bf}`, []],
    [String.raw`\sisetup{output-decimal-marker={,}}`, []],
    [String.raw`\selectlanguage{czech} Text`, ["Text"]],
    [String.raw`\foreignlanguage{english}{the crease}`, ["the", "crease"]],
    [String.raw`\setmainfont{TeX Gyre Pagella}[Scale=MatchLowercase] Text`, ["Text"]],
    [String.raw`\babelfont{rm}{Linux Libertine O} Text`, ["Text"]],
    [String.raw`\newfontfamily\cyrfont{Times New Roman}[Script=Cyrillic] Text`, ["Text"]],
    [String.raw`\bibitem{novak2020kniha} Novák, J.: Kniha.`, ["Novák", "J", "Kniha"]],
    [String.raw`\bibitem[Nov20]{novak} {\em Kniha}`, ["Kniha"]],
    [String.raw`\hyperlink{sekce-uvod}{Úvod}`, ["Úvod"]],
    [String.raw`\hypertarget{sekce-uvod}{Úvod}`, ["Úvod"]],
    [String.raw`\color{darkgreen} text`, ["text"]],
    [String.raw`\color{red}{text}`, ["text"]],
    [String.raw`\fontsize{12pt}{14pt}\selectfont Text`, ["Text"]],
    [String.raw`\newtheorem{veta}{Věta}`, ["Věta"]],
    [String.raw`\newtheorem{lemma}[theorem]{Lemma}`, ["Lemma"]],
    [String.raw`\crefname{obr}{obrázek}{obrázky}`, ["obrázek", "obrázky"]],
    [String.raw`\newacronym{cnn}{CNN}{convolutional network}`, ["convolutional", "network"]],
    [String.raw`\DeclareMathOperator{\argmax}{argmax}`, []],
    [String.raw`\DeclareMathOperator*\argmin{argmin}`, []],
    [String.raw`\newcommand\foo{bodyword}`, []],
    [String.raw`\subfile{kapitoly/uvod}`, []],
    [String.raw`\import{kapitoly/}{uvod}`, []],
    [String.raw`\externaldocument{prilohy}`, []],
    [String.raw`\addcontentsline{toc}{section}{Úvod}`, ["Úvod"]],
    [String.raw`\setcounter{secnumdepth}{3} Text`, ["Text"]],
    [String.raw`\newcounter{priklad}`, []],
    [String.raw`\renewenvironment{abstract}{a}{b}`, []],
    [String.raw`\newglossaryentry{kornout}{name=kornout, description={tvar}}`, []],
    [String.raw`viz \labelcref{obr:udoli} a \cpageref{obr:hora}`, ["viz", "a"]],
    [String.raw`\custommacro[width=3cm, keepaspectratio]{Visible prose}`, ["Visible", "prose"]],
    [String.raw`\item[Label] tail`, ["Label", "tail"]],
  ])("masks the non-prose arguments of %s", (source, expected) => {
    expect(spelled(source)).toEqual(expected);
  });

  it("keeps prose after an optional argument that never closes", () => {
    expect(
      spelled("Start \\section[Short = x\n\nLater prose with a = b"),
    ).toEqual(["Start", "Short", "x", "Later", "prose", "with", "a", "b"]);
    expect(spelled(String.raw`\mycmd[a=b ${"x ".repeat(600)}`)).toHaveLength(602);
  });

  it("keeps reference placeholders readable for grammar checking", () => {
    const source = String.raw`See \cpageref{fig:a}.`;
    const prose = maskLatexForProse(source);
    expect(prose).toHaveLength(source.length);
    expect(prose.replace(/\s+/gu, " ")).toBe("See Dummy .");
  });
});

describe("accent macros and hyphenation hints", () => {
  const spelled = (tex: string) => spellcheckRanges(tex).map((r) => r.word);

  it.each([
    [String.raw`Antonín Dvo\v{r}\'ak složil`, ["Antonín", "Dvořák", "složil"]],
    [String.raw`Kate\v{r}ina a \v{C}esk\'a republika, p\v{r}\'{\i}klad.`, ["Kateřina", "a", "Česká", "republika", "příklad"]],
    [String.raw`Dvo\v rák`, ["Dvořák"]],
    [String.raw`Schr\"odinger und M\"uller gr\"o\ss er.`, ["Schrödinger", "und", "Müller", "größer"]],
    [String.raw`Sch{\"o}n und {\ss}`, ["Schön", "und", "ß"]],
    [String.raw`Le caf\'e na\"\i f et l'\'el\`eve.`, ["Le", "café", "naïf", "et", "l'élève"]],
    [String.raw`na\"{\i}ve Cr\`eme br\^ul\'ee`, ["naïve", "Crème", "brûlée"]],
    [String.raw`\L\'od\'z i \.Zubr.`, ["Łódź", "i", "Żubr"]],
    [String.raw`Ko\l{}obrzeg, \L{}\'od\'z, \o{}l, \ae{}ther`, ["Kołobrzeg", "Łódź", "øl", "æther"]],
    [String.raw`Erd\H{o}s and Fran\c{c}ais`, ["Erdős", "and", "Français"]],
    [String.raw`hyphen\-ation and Donau\-dampf\-schiff`, ["hyphenation", "and", "Donaudampfschiff"]],
  ])("reads %s as whole words", (source, expected) => {
    expect(spelled(source)).toEqual(expected);
  });

  it("covers the whole source word so a suggestion replaces all of it", () => {
    const source = String.raw`Le caf\'e et Kate\v{r}ina.`;
    const ranges = spellcheckRanges(source);
    expect(ranges.map((r) => source.slice(r.from, r.to))).toEqual([
      "Le",
      String.raw`caf\'e`,
      "et",
      String.raw`Kate\v{r}ina`,
    ]);
  });

  it("never widens a word over the braces of a command argument", () => {
    const source = String.raw`\emph{\'e}tatt \textbf {\ss}e \{\'e} \\{\'e} \textcolor{red}{\'e} x{\"o}y`;
    const ranges = spellcheckRanges(source);
    expect(ranges.map((r) => source.slice(r.from, r.to))).toEqual([
      String.raw`\'e`,
      "tatt",
      String.raw`\ss`,
      "e",
      String.raw`\'e`,
      String.raw`\'e`,
      String.raw`\'e`,
      String.raw`x{\"o}y`,
    ]);
  });

  it("leaves unrelated commands, math and accent macros without a letter alone", () => {
    expect(spelled(String.raw`\label{x}\omega \textbf{x}y $\"o$ \'{} tail`)).toEqual([
      "x",
      "y",
      "tail",
    ]);
    expect(spelled(String.raw`\cite{Dvo\v{r}ak} text`)).toEqual(["text"]);
  });

  it("does not decode accents in the preamble", () => {
    expect(
      spelled(String.raw`\documentclass{article}
\newcommand{\name}{Dvo\v{r}\'ak}
\begin{document}
Body
\end{document}`),
    ).toEqual(["Body"]);
  });

  it("reads German babel shorthands only when German babel is loaded", () => {
    const body = String.raw`Sch"on, gr"o"ser, Stra"se, Donau"=dampf"-schiff`;
    expect(spelled(body)).toContain("Sch");
    const german = String.raw`\documentclass{article}
\usepackage[ngerman]{babel}
\begin{document}
${body}
\end{document}`;
    const ranges = spellcheckRanges(german);
    expect(ranges.map((r) => r.word)).toEqual([
      "Schön",
      "größer",
      "Straße",
      "Donau",
      "dampfschiff",
    ]);
    expect(ranges.at(-1)?.compound?.word).toBe("Donau-dampfschiff");
    const commented = german.replace(
      String.raw`\usepackage[ngerman]{babel}`,
      String.raw`% \usepackage[ngerman]{babel}`,
    );
    expect(spellcheckRanges(commented).map((r) => r.word)).toContain("Sch");
  });

  it("gives the grammar checker whole words at the same offsets", () => {
    const source = String.raw`Antonín Dvo\v{r}\'ak složil symfonii.`;
    const { prose, masked } = maskLatexForProseRegions(source);
    expect(prose).toHaveLength(source.length);
    expect(prose.replace(/\s+/gu, " ")).toBe("Antonín Dvořák složil symfonii.");
    const start = source.indexOf("Dvo");
    expect(intersectsMaskedRegion(masked, start, start + 1)).toBe(true);
    for (let index = 1; index < masked.length; index++) {
      expect(masked[index].from).toBeGreaterThanOrEqual(masked[index - 1].to);
    }
  });

  it("keeps maskToProse offsets one to one", () => {
    const source = String.raw`caf\'e ok`;
    const { prose, map } = maskToProse(source);
    expect(map).toHaveLength(prose.length);
    for (let index = 0; index < prose.length; index++) {
      if (prose[index] !== " ") expect(source[map[index]]).toBe(prose[index]);
    }
  });
});

describe("email addresses", () => {
  it("masks addresses with non-ASCII local parts and domains", () => {
    const source = "Napište na пример@почта.рф nebo ředitel@firma.cz dnes.";
    expect(spellcheckRanges(source).map((r) => r.word)).toEqual([
      "Napište",
      "na",
      "nebo",
      "dnes",
    ]);
    expect(maskLatexForProse(source)).not.toMatch(/ř |пример|почта/u);
  });
});

describe("babel option scanning", () => {
  it("stays linear on unterminated option lists", () => {
    const source = "\\usepackage[\\".repeat(25_000);
    expect(spellcheckRanges(source).length).toBeGreaterThanOrEqual(0);
    expect(maskLatex(source)).toHaveLength(source.length);
  });

  it("reads German shorthands when the class options load German", () => {
    const words = spellcheckRanges(
      String.raw`\documentclass[a4paper,ngerman]{article}
\usepackage{babel}
\begin{document}
Die Stra"se.
\end{document}`,
    ).map((range) => range.word);
    expect(words).toContain("Straße");
  });
});

