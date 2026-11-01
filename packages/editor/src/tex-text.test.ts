import { describe, expect, it } from "vitest";
import { renderedTex, sourceOffset } from "./tex-text";

function spelled(source: string) {
  return renderedTex(source).text;
}

function sourceOf(source: string, word: string) {
  const rendered = renderedTex(source);
  const at = rendered.text.indexOf(word);
  return source.slice(sourceOffset(rendered, at, false), sourceOffset(rendered, at + word.length, true));
}

describe("reading source text the way the PDF shows it", () => {
  it("spells accent macros as the letters they make", () => {
    expect(spelled(String.raw`caf\'e, na\"ive, r\'{e}sum\'{e}, \^{o}te, \`a`)).toBe("café, naïve, résumé, ôte, à");
  });

  it("puts accents on the dotless i and j the way readers see them", () => {
    expect(spelled(String.raw`na\"{\i}ve, Mo\"\i se`)).toBe("naïve, Moïse");
  });

  it("reads letter-named accents and special letters", () => {
    expect(spelled(String.raw`gar\c{c}on, \v{S}koda, Erd\H{o}s, \c c`)).toBe("garçon, Škoda, Erdős, ç");
    expect(spelled(String.raw`Stra\ss e, Bj\o rn, \ae on, \o{} and \L\'od\'z`)).toBe("Straße, Bjørn, æon, ø and Łódź");
  });

  it("maps a rendered word back to the source characters behind it", () => {
    expect(sourceOf(String.raw`The caf\'e and the na\"ive model`, "café")).toBe(String.raw`caf\'e`);
    expect(sourceOf(String.raw`r\'{e}sum\'{e} of the data`, "résumé")).toBe(String.raw`r\'{e}sum\'{e}`);
    expect(sourceOf(String.raw`r\'{e}sum\'{e} of the data`, "data")).toBe("data");
  });

  it("leaves commands that only look like accents alone", () => {
    const source = String.raw`\cite{knuth} \label{sec:1} \ref{x} \vspace{1pt} \usepackage{lmodern} \begin{document} \LaTeX \over`;
    expect(renderedTex(source)).toEqual({ text: source, offsets: null });
  });

  it("composes base letters and combining marks", () => {
    const rendered = renderedTex("café noir");
    expect(rendered.text).toBe("café noir");
    expect(sourceOffset(rendered, rendered.text.indexOf("noir"), false)).toBe(6);
  });
});
