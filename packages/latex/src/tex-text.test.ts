import { describe, expect, it } from "vitest";
import { decodeLatexAccents, foldLatinDiacritics } from "./tex-text";

describe("decodeLatexAccents", () => {
  it("turns braced, bare and spaced accent macros into composed letters", () => {
    expect(decodeLatexAccents(String.raw`\v{C}e\v{s}tina`)).toBe("Čeština");
    expect(decodeLatexAccents(String.raw`Dvo\v{r}\'ak`)).toBe("Dvořák");
    expect(decodeLatexAccents(String.raw`\"Uber die L\"osung`)).toBe("Über die Lösung");
    expect(decodeLatexAccents(String.raw`Nov{\'a}k`)).toBe("Nov{á}k");
    expect(decodeLatexAccents(String.raw`\v C and \c{c} and \H{o} and \k{a}`)).toBe("Č and ç and ő and ą");
    expect(decodeLatexAccents(String.raw`\'{\i} and \^\i`)).toBe("í and î");
  });

  it("decodes letter macros as whole names only", () => {
    expect(decodeLatexAccents(String.raw`Stra\ss e`)).toBe("Straße");
    expect(decodeLatexAccents(String.raw`\L{}ukasiewicz, \O{}rsted, \ae ther`)).toBe("Łukasiewicz, Ørsted, æther");
    expect(decodeLatexAccents(String.raw`\label{x} \oe uvre \vec{v}`)).toBe(String.raw`\label{x} œuvre \vec{v}`);
  });

  it("leaves plain text and line breaks alone", () => {
    expect(decodeLatexAccents("Úvod do češtiny")).toBe("Úvod do češtiny");
    expect(decodeLatexAccents(String.raw`first\\'quoted'`)).toBe(String.raw`first\\'quoted'`);
  });
});

describe("foldLatinDiacritics", () => {
  it("folds Latin letters to ASCII, including letters without a decomposition", () => {
    expect(foldLatinDiacritics("Účinnost údolí Żółw")).toBe("Ucinnost udoli Zolw");
    expect(foldLatinDiacritics("Weiß Łódź Ørsted Đorđe Æsir Œuvre Þór ı")).toBe("Weiss Lodz Orsted Dorde AEsir OEuvre Thor i");
  });

  it("keeps other scripts intact", () => {
    expect(foldLatinDiacritics("Иванов Йошкар")).toBe("Иванов Йошкар");
    expect(foldLatinDiacritics("がくしゅう 한국어 深度学习")).toBe("がくしゅう 한국어 深度学习");
  });
});
