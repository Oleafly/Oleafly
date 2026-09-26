import { describe, expect, it } from "vitest";
import { spellcheckRanges } from "./latex-mask";
import { markdownSpellcheckRanges } from "./markdown-mask";
import { typstSpellcheckRanges } from "./typst-mask";
import {
  mapSpellingWords,
  restoreApostrophes,
  spellingLookupForms,
  spellingWordSpans,
} from "./spelling-words";

const words = (text: string) => spellingWordSpans(text).map((span) => span.word);

describe("spelling words across scripts", () => {
  it("keeps Czech words whole instead of splitting at accented letters", () => {
    const source = String.raw`\section{Skladatelnost}
Crease pattern na listu papíru se skládá z vrcholů a hran. Bakalářka, údolí.`;
    expect(spellcheckRanges(source).map((range) => range.word)).toEqual([
      "Skladatelnost",
      "Crease",
      "pattern",
      "na",
      "listu",
      "papíru",
      "se",
      "skládá",
      "z",
      "vrcholů",
      "a",
      "hran",
      "Bakalářka",
      "údolí",
    ]);
  });

  it("maps every range back onto the exact source characters", () => {
    const source = "Příliš žluťoučký kůň úpěl ďábelské ódy.";
    for (const range of spellcheckRanges(source)) {
      expect(source.slice(range.from, range.to)).toBe(range.word);
    }
    expect(spellcheckRanges(source)).toHaveLength(6);
  });

  it("keeps combining marks inside the word", () => {
    expect(words("papi\u0301ru")).toEqual(["papi\u0301ru"]);
    expect(words("हिन्दी भाषा")).toEqual(["हिन्दी", "भाषा"]);
    expect(words("नेपाली शब्दकोश")).toEqual(["नेपाली", "शब्दकोश"]);
  });

  it("joins Persian words across the zero-width non-joiner", () => {
    expect(words("می\u200Cخواهم کتاب\u200Cها")).toEqual([
      "می\u200Cخواهم",
      "کتاب\u200Cها",
    ]);
  });

  it("keeps Hebrew acronyms with gershayim together", () => {
    expect(words("צה״ל")).toEqual(["צה״ל"]);
    expect(words('צה"ל')).toEqual(['צה"ל']);
    expect(words('said "hello"')).toEqual(["said", "hello"]);
  });

  it("keeps the Catalan middle dot inside a word", () => {
    expect(words("la col·lecció")).toEqual(["la", "col·lecció"]);
  });

  it("keeps internal apostrophes and drops quote marks at the edges", () => {
    expect(words("don’t l'homme aujourd’hui м'ясо")).toEqual([
      "don’t",
      "l'homme",
      "aujourd’hui",
      "м'ясо",
    ]);
    expect(words("the students' work")).toEqual(["the", "students", "work"]);
    expect(spellcheckRanges("``quoted'' text").map((range) => range.word)).toEqual([
      "quoted",
      "text",
    ]);
  });

  it("reports hyphenated compounds with their parts", () => {
    const spans = spellingWordSpans("a well-known e-mail");
    expect(spans.map((span) => span.word)).toEqual([
      "a",
      "well",
      "known",
      "e",
      "mail",
    ]);
    expect(spans[1]?.compound).toEqual({ from: 2, to: 12, word: "well-known" });
    expect(spans[2]?.compound).toEqual({ from: 2, to: 12, word: "well-known" });
    expect(spans[0]?.compound).toBeUndefined();
    expect(words("pages 10--20 and word--word")).toEqual([
      "pages",
      "and",
      "word",
      "word",
    ]);
  });

  it("leaves scripts without word spaces to the grammar checker", () => {
    expect(words("中文文本 and Tokyoは東京 ภาษาไทย")).toEqual(["and", "Tokyo"]);
    expect(words("한국어 맞춤법")).toEqual(["한국어", "맞춤법"]);
  });

  it("treats Cyrillic, Greek, Armenian and Georgian as words", () => {
    expect(words("Привет мир")).toEqual(["Привет", "мир"]);
    expect(words("Καλημέρα κόσμε")).toEqual(["Καλημέρα", "κόσμε"]);
    expect(words("Բարեւ աշխարհ")).toEqual(["Բարեւ", "աշխարհ"]);
    expect(words("გამარჯობა")).toEqual(["გამარჯობა"]);
  });
});

describe("format tokenizers share the Unicode rules", () => {
  it("checks accented Markdown words whole", () => {
    expect(
      markdownSpellcheckRanges("# Úvod\n\nSkládání `kódu` a [odkaz](http://x.cz).").map(
        (range) => range.word,
      ),
    ).toEqual(["Úvod", "Skládání", "a", "odkaz"]);
  });

  it("checks accented Typst words whole and still skips single letters", () => {
    expect(
      typstSpellcheckRanges("= Úvod\nSkládání a #strong[papíru].").map(
        (range) => range.word,
      ),
    ).toEqual(["Úvod", "Skládání", "papíru"]);
  });

  it("maps compacted prose offsets back to the source", () => {
    const source = "a  papíru\n\n  skládá";
    const prose = "a papíru skládá";
    const map = [0, 2, 3, 4, 5, 6, 7, 8, 9, 13, 14, 15, 16, 17, 18, 19];
    const mapped = mapSpellingWords(spellingWordSpans(prose), map, source);
    expect(mapped.map((range) => source.slice(range.from, range.to))).toEqual([
      "a",
      "papíru",
      "skládá",
    ]);
  });
});

describe("dictionary lookup forms", () => {
  it("normalizes to NFC and removes soft hyphens", () => {
    expect(spellingLookupForms("papi\u0301ru")).toEqual(["papíru"]);
    expect(spellingLookupForms("Wör\u00ADter")).toEqual(["Wörter"]);
  });

  it("offers an ASCII apostrophe form for typographic apostrophes", () => {
    expect(spellingLookupForms("dell’anno")).toEqual(["dell’anno", "dell'anno"]);
    expect(spellingLookupForms("donʼt")).toEqual(["donʼt", "don't"]);
    expect(spellingLookupForms("צה״ל")).toEqual(["צה״ל", 'צה"ל']);
    expect(spellingLookupForms("plain")).toEqual(["plain"]);
  });

  it("puts the writer's apostrophe back into suggestions", () => {
    expect(restoreApostrophes("dell’ano", "dell'anno")).toBe("dell’anno");
    expect(restoreApostrophes("dell'ano", "dell'anno")).toBe("dell'anno");
    expect(restoreApostrophes("wrod", "word")).toBe("word");
  });
});
