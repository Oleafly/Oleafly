import { describe, expect, it } from "vitest";
import {
  findHandBibliographies,
  handBibEntries,
  handBibEntry,
  handListDeclaration,
  maskComments,
  replaceHandBibliography,
} from "./hand-bibliography";

const ACADEMIC = [
  "\\section{Conclusion}",
  "Recap the contribution and point to future work.",
  "",
  "\\begin{thebibliography}{9}",
  "\\bibitem{knuth1984} D.~E. Knuth, \\emph{The \\TeX book}. Addison-Wesley, 1984.",
  "\\end{thebibliography}",
  "",
  "\\end{document}",
  "",
].join("\n");

describe("finding a hand-written reference list", () => {
  it("reads the Academic Article list", () => {
    const [list, ...rest] = findHandBibliographies(ACADEMIC);
    expect(rest).toEqual([]);
    expect(list).toMatchObject({ closed: true, convertible: true });
    expect(list.items).toEqual([{ key: "knuth1984", text: "D.~E. Knuth, \\emph{The \\TeX book}. Addison-Wesley, 1984." }]);
    expect(ACADEMIC.slice(list.from, list.to)).toBe(
      "\\begin{thebibliography}{9}\n\\bibitem{knuth1984} D.~E. Knuth, \\emph{The \\TeX book}. Addison-Wesley, 1984.\n\\end{thebibliography}",
    );
  });

  it("handles optional labels, multi-line text, odd keys and comments", () => {
    const source = [
      "\\begin{thebibliography}{99}",
      "% Books first",
      "\\bibitem[{Knuth(1984)}]{knuth:1984-tex}",
      "  D.~E. Knuth.   \\newblock \\emph{The {\\TeX}book}.%",
      "    \\newblock Addison-Wesley, 1984.",
      "",
      "\\bibitem [Lamport et~al.(1994)] { lamport_94.latex }  L. Lamport, % trailing note",
      "  \\emph{\\LaTeX: A Document Preparation System}, 50\\% off.",
      "% \\bibitem{ghost} Commented out.",
      "\\bibitem{empty}",
      "\\end{thebibliography}",
    ].join("\n");
    const [list] = findHandBibliographies(source);
    expect(list.convertible).toBe(true);
    expect(list.items).toEqual([
      { key: "knuth:1984-tex", text: "D.~E. Knuth. \\newblock \\emph{The {\\TeX}book}.\\newblock Addison-Wesley, 1984." },
      { key: "lamport_94.latex", text: "L. Lamport, \\emph{\\LaTeX: A Document Preparation System}, 50\\% off." },
      { key: "empty", text: "" },
    ]);
  });

  it("ignores text before the first item and a widest label with braces", () => {
    const source = "\\begin{thebibliography}{{[}99{]}}\n\\providecommand{\\natexlab}[1]{#1}\n\\bibitem{a} A.\n\\end{thebibliography}";
    const [list] = findHandBibliographies(source);
    expect(list.items).toEqual([{ key: "a", text: "A." }]);
  });

  it("works without the widest label argument", () => {
    const [list] = findHandBibliographies("\\begin{thebibliography}\n\\bibitem{a} A.\n\\end{thebibliography}");
    expect(list.items).toEqual([{ key: "a", text: "A." }]);
  });

  it("does not see an environment that is commented out", () => {
    expect(findHandBibliographies("% \\begin{thebibliography}{9}\n% \\bibitem{a} A.\n% \\end{thebibliography}\n")).toEqual([]);
  });

  it("reports every environment and an unclosed one", () => {
    const two = "\\begin{thebibliography}{1}\\bibitem{a} A.\\end{thebibliography}\n\\begin{thebibliography}{1}\\bibitem{b} B.\\end{thebibliography}";
    expect(findHandBibliographies(two).map((list) => list.items.map((item) => item.key))).toEqual([["a"], ["b"]]);
    const [open] = findHandBibliographies("\\begin{thebibliography}{1}\n\\bibitem{a} A.\n");
    expect(open).toMatchObject({ closed: false, convertible: false });
  });

  it("refuses items it cannot turn into BibTeX", () => {
    const unbalanced = "\\begin{thebibliography}{1}\n\\bibitem{a} Braces \\{ left open.\n\\end{thebibliography}";
    expect(findHandBibliographies(unbalanced)[0]).toMatchObject({ closed: true, convertible: false, items: [] });
    const spaced = "\\begin{thebibliography}{1}\n\\bibitem{two words} A.\n\\end{thebibliography}";
    expect(findHandBibliographies(spaced)[0].convertible).toBe(false);
    const keyless = "\\begin{thebibliography}{1}\n\\bibitem A.\n\\end{thebibliography}";
    expect(findHandBibliographies(keyless)[0].convertible).toBe(false);
  });

  it("does not take \\bibitemsep for an item", () => {
    const source = "\\begin{thebibliography}{1}\n\\setlength{\\bibitemsep}{0pt}\n\\bibitem{a} A.\n\\end{thebibliography}";
    expect(findHandBibliographies(source)[0].items).toEqual([{ key: "a", text: "A." }]);
  });
});

describe("turning items into BibTeX", () => {
  it("writes a @misc entry with the text as a note", () => {
    expect(handBibEntry({ key: "knuth:1984-tex", text: "D.~E. Knuth, \\emph{The \\TeX book}." })).toBe(
      "@misc{knuth:1984-tex,\n  note = {D.~E. Knuth, \\emph{The \\TeX book}.}\n}",
    );
  });

  it("skips keys the .bib already has and repeated keys", () => {
    const items = [
      { key: "a", text: "A." },
      { key: "b", text: "B." },
      { key: "a", text: "A again." },
      { key: "c", text: "C." },
    ];
    expect(handBibEntries(items, new Set(["b"]))).toEqual([
      "@misc{a,\n  note = {A.}\n}",
      "@misc{c,\n  note = {C.}\n}",
    ]);
  });
});

describe("replacing the list", () => {
  it("puts the BibTeX lines where the environment was", () => {
    const [list] = findHandBibliographies(ACADEMIC);
    const next = replaceHandBibliography(ACADEMIC, list, handListDeclaration("references.bib", [ACADEMIC]));
    expect(next).toBe(
      "\\section{Conclusion}\nRecap the contribution and point to future work.\n\n\\bibliographystyle{unsrt}\n\\bibliography{references}\n\n\\end{document}\n",
    );
  });

  it("uses unsrtnat with natbib and keeps a style the paper already sets", () => {
    expect(handListDeclaration("refs/main.bib", ["\\usepackage[numbers]{natbib}"])).toBe(
      "\\bibliographystyle{unsrtnat}\n\\bibliography{refs/main}",
    );
    expect(handListDeclaration("../references.bib", ["% \\usepackage{natbib}"])).toBe(
      "\\bibliographystyle{unsrt}\n\\bibliography{../references}",
    );
    expect(handListDeclaration("refs\\x.bib", ["\\bibliographystyle{abbrv}"])).toBe("\\bibliography{refs/x}");
  });

  it("masks comments without moving text", () => {
    const source = "a % note\n\\% kept \\\\% gone\n";
    expect(maskComments(source)).toBe("a       \n\\% kept \\\\      \n");
    expect(maskComments(source)).toHaveLength(source.length);
  });
});
