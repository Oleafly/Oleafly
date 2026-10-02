import { describe, expect, it } from "vitest";
import { parseEntry } from "./bibtex";
import {
  appendHayagrivaEntries,
  bibtexToHayagriva,
  findHayagrivaKeyByDoi,
  hayagrivaEntries,
  hayagrivaKeys,
  isHayagrivaPath,
  looksLikeHayagriva,
  yamlQuote,
} from "./hayagriva";

function convert(bibtex: string): string {
  const parsed = parseEntry(bibtex);
  if (!parsed) throw new Error("test BibTeX did not parse");
  return bibtexToHayagriva(parsed);
}

describe("isHayagrivaPath", () => {
  it("accepts .yml and .yaml only", () => {
    expect(isHayagrivaPath("refs.yml")).toBe(true);
    expect(isHayagrivaPath("lib/Refs.YAML")).toBe(true);
    expect(isHayagrivaPath("refs.bib")).toBe(false);
    expect(isHayagrivaPath("refs.yml.bak")).toBe(false);
  });
});

describe("bibtexToHayagriva", () => {
  it("maps a journal article onto an entry with a periodical parent", () => {
    expect(convert(String.raw`@article{lovelace2024edge,
  title = {{Edge} Sensing with M\"uller--Lyer Cues},
  author = {Ada Lovelace and Babbage, Charles and Ludwig van Beethoven and {World Health Organization}},
  journal = {Journal of Things},
  year = {2024},
  month = mar,
  volume = {7},
  number = {2},
  pages = {12--15},
  publisher = {ACM},
  doi = {10.1000/edge\_1},
  issn = {1234-5678},
  url = {https://example.com/a_b}
}`)).toBe([
      "lovelace2024edge:",
      "  type: article",
      '  title: "Edge Sensing with Müller\u2013Lyer Cues"',
      "  author:",
      '    - "Lovelace, Ada"',
      '    - "Babbage, Charles"',
      '    - "van Beethoven, Ludwig"',
      '    - "World Health Organization"',
      '  date: "2024-03"',
      '  page-range: "12-15"',
      '  url: "https://example.com/a_b"',
      "  serial-number:",
      '    doi: "10.1000/edge_1"',
      "  parent:",
      "    type: periodical",
      '    title: "Journal of Things"',
      '    volume: "7"',
      '    issue: "2"',
      '    publisher: "ACM"',
      "    serial-number:",
      '      issn: "1234-5678"',
    ].join("\n"));
  });

  it("puts proceedings details on a proceedings parent", () => {
    const yaml = convert(`@inproceedings{doe2023proc,
  title = {Proc Paper}, author = {Doe, Jane}, booktitle = {Proceedings of Conf},
  editor = {Eve Editor}, publisher = {IEEE}, address = {New York}, organization = {ACM SIG},
  year = 2023, pages = {1-10}
}`);
    expect(yaml).toContain("  type: article\n");
    expect(yaml).toContain([
      "  parent:",
      "    type: proceedings",
      '    title: "Proceedings of Conf"',
      "    editor:",
      '      - "Editor, Eve"',
      "    publisher:",
      '      name: "IEEE"',
      '      location: "New York"',
      '    organization: "ACM SIG"',
    ].join("\n"));
  });

  it.each([
    ["@conference{c, title = {T}, booktitle = {B}}", "article", "proceedings"],
    ["@incollection{c, title = {T}, booktitle = {Collected}}", "anthos", "anthology"],
    ["@inbook{c, title = {T}, booktitle = {Whole Book}}", "chapter", "book"],
  ])("maps %s to a %s inside a %s", (bibtex, type, parentType) => {
    const yaml = convert(bibtex);
    expect(yaml).toContain(`  type: ${type}\n`);
    expect(yaml).toContain(`  parent:\n    type: ${parentType}\n`);
  });

  it("maps books with an ISBN, edition and publisher location", () => {
    expect(convert(`@book{knuth1997art,
  title = {The Art of Computer Programming}, author = {Donald E. Knuth}, editor = {Ed Itor},
  publisher = {Addison-Wesley}, address = {Reading, MA}, year = {1997}, edition = {3},
  volume = {1}, isbn = {978-0201896831}
}`)).toBe([
      "knuth1997art:",
      "  type: book",
      '  title: "The Art of Computer Programming"',
      "  author:",
      '    - "Knuth, Donald E."',
      "  editor:",
      '    - "Itor, Ed"',
      '  date: "1997"',
      '  edition: "3"',
      '  volume: "1"',
      "  publisher:",
      '    name: "Addison-Wesley"',
      '    location: "Reading, MA"',
      "  serial-number:",
      '    isbn: "978-0201896831"',
    ].join("\n"));
  });

  it.each([
    ["phdthesis", "Doctoral dissertation"],
    ["mastersthesis", "Master's thesis"],
  ])("maps a %s to a thesis published by its school", (type, genre) => {
    const yaml = convert(`@${type}{t, title = {My Thesis}, author = {Sam Student}, school = {MIT}, year = {2019}}`);
    expect(yaml).toContain("  type: thesis\n");
    expect(yaml).toContain('  publisher: "MIT"\n');
    expect(yaml).toContain(`  genre: "${genre}"`);
  });

  it("maps a tech report with its institution and number", () => {
    const yaml = convert(`@techreport{r, title = {Report}, author = {Cal Coder}, institution = {Bell Labs},
  number = {TR-42}, type = {Technical Report}, year = {2018}, doi = {10.1/x}}`);
    expect(yaml).toContain("  type: report\n");
    expect(yaml).toContain('  publisher: "Bell Labs"\n');
    expect(yaml).toContain('  genre: "Technical Report"\n');
    expect(yaml).toContain('  serial-number:\n    doi: "10.1/x"\n    serial: "TR-42"');
    expect(yaml).not.toContain("issue:");
  });

  it.each([
    ["@misc{m, title = {Site}, url = {https://example.com}}", "web"],
    ["@online{m, title = {Site}}", "web"],
    ["@misc{m, title = {Note}, howpublished = {Talk}}", "misc"],
    ["@unpublished{m, title = {Draft}}", "manuscript"],
    ["@software{m, title = {Tool}}", "misc"],
  ])("maps %s to %s", (bibtex, type) => {
    expect(convert(bibtex)).toContain(`  type: ${type}\n`);
  });

  it("leaves out a parent that would carry only its type", () => {
    const yaml = convert("@article{a, title = {T}, author = {Ada Lovelace}, year = {2024}}");
    expect(yaml).toBe('a:\n  type: article\n  title: "T"\n  author:\n    - "Lovelace, Ada"\n  date: "2024"');
  });

  it("drops dates and URLs that Hayagriva would reject", () => {
    const yaml = convert("@misc{m, title = {T}, year = {in press}, month = {13}, url = {www.example.com}}");
    expect(yaml).not.toContain("date:");
    expect(yaml).not.toContain("url:");
    expect(convert("@misc{m, title = {T}, year = {2020}, month = {13}}")).toContain('  date: "2020"');
    expect(convert("@misc{m, title = {T}, date = {2021-02-30}}")).toContain('  date: "2021-02-30"');
    expect(convert("@misc{m, title = {T}, year = {2021b}, month = {December}, day = {9}}")).toContain(
      '  date: "2021-12-09"',
    );
  });

  it("escapes Hayagriva formatting and YAML quoting in text fields", () => {
    const yaml = convert(String.raw`@misc{m, title = {Cost \$5 \& a "quote" in $x^2$ with \emph{em}}, note = {Line~two}}`);
    expect(yaml).toContain(String.raw`  title: "Cost \\$5 & a \"quote\" in \\$x^2\\$ with \\\\emph\\{em\\}"`);
    expect(yaml).toContain('  note: "Line two"');
  });

  it("keeps a corporate name with a comma whole and skips others", () => {
    const yaml = convert("@misc{m, title = {T}, author = {{Smith, Jones and Co.} and others}}");
    expect(yaml).toContain('  author:\n    - name: "Smith, Jones and Co."');
    expect(yaml).not.toContain("others");
  });

  it("orders three-part names the way Hayagriva reads them", () => {
    expect(convert("@misc{m, title = {T}, author = {van Beethoven, Jr., Ludwig}}")).toContain(
      '    - "van Beethoven, Jr., Ludwig"',
    );
  });

  it("quotes keys that are not plain YAML identifiers", () => {
    expect(convert("@misc{smith:2020, title = {T}}").startsWith('"smith:2020":\n')).toBe(true);
    expect(convert("@misc{2020a, title = {T}}").startsWith('"2020a":\n')).toBe(true);
    expect(convert("@misc{yes, title = {T}}").startsWith('"yes":\n')).toBe(true);
    expect(convert("@misc{doe_2020-x, title = {T}}").startsWith("doe_2020-x:\n")).toBe(true);
  });

  it("reads back what it writes", () => {
    const yaml = convert(String.raw`@article{lovelace2024edge,
  title = {Edge "Sensing": a \# study}, author = {Ada Lovelace and Charles Babbage},
  journal = {J}, year = {2024}, doi = {10.1000/EDGE}
}`);
    const [entry] = hayagrivaEntries(yaml);
    expect(entry).toMatchObject({
      key: "lovelace2024edge",
      isEntry: true,
      type: "article",
      authors: ["Lovelace, Ada", "Babbage, Charles"],
      doi: "10.1000/EDGE",
    });
    expect(entry.title?.value).toBe('Edge "Sensing": a # study');
    expect(entry.date?.value).toBe("2024");
  });
});

describe("yamlQuote", () => {
  it("escapes characters YAML cannot hold raw", () => {
    expect(yamlQuote('a\\b"c\nd\te\u0007\u0085\u2028')).toBe(String.raw`"a\\b\"c\nd\te\u0007\u0085\u2028"`);
  });
});

const HAND_WRITTEN = `# Library
---
harry:
    type: Book
    title: Harry Potter and the Order of the Phoenix # inline comment
    author: Rowling, J. K.
    date: 2003-06-21
    serial-number: {isbn: "978-0747551003", doi: "10.1/harry"}

"quoted:key":
  type: web
  title:
    value: Ishkur's Guide
    short: Guide
  author: ["Ishkur", 'O''Brien, Pat']
  doi: 10.2/legacy

electronic:
  title: |
    A block
    title
  author:
  - name: Smith, Jones and Co.
  - name: Doe
    given-name: Jane
  - Roe, Richard

inline: {type: article, title: "Flow entry"}
settings:
  theme: dark
version: 2
`;

describe("hayagrivaEntries", () => {
  const entries = hayagrivaEntries(HAND_WRITTEN);

  it("lists every top-level key and marks Hayagriva entries", () => {
    expect(entries.map((entry) => [entry.key, entry.isEntry])).toEqual([
      ["harry", true],
      ["quoted:key", true],
      ["electronic", true],
      ["inline", true],
      ["settings", false],
      ["version", false],
    ]);
    expect(hayagrivaKeys(HAND_WRITTEN).has("settings")).toBe(true);
  });

  it("reads titles, people, dates and DOIs in their common shapes", () => {
    const [harry, quoted, electronic, inline] = entries;
    expect(harry).toMatchObject({ type: "Book", authors: ["Rowling, J. K."], doi: "10.1/harry" });
    expect(harry.title?.value).toBe("Harry Potter and the Order of the Phoenix");
    expect(harry.date?.value).toBe("2003-06-21");
    expect(quoted.title?.value).toBe("Ishkur's Guide");
    expect(quoted.authors).toEqual(["Ishkur", "O'Brien, Pat"]);
    expect(quoted.doi).toBe("10.2/legacy");
    expect(electronic.title?.value).toBe("A block title");
    expect(electronic.authors).toEqual(["Smith, Jones and Co.", "Doe, Jane", "Roe, Richard"]);
    expect(inline.title?.value).toBe("Flow entry");
  });

  it("reports key offsets inside the source", () => {
    for (const entry of entries) {
      expect(HAND_WRITTEN.slice(entry.keyFrom, entry.keyTo)).toBe(entry.key);
    }
    const harry = entries[0];
    expect(HAND_WRITTEN.slice(harry.from, harry.to).endsWith('doi: "10.1/harry"}')).toBe(true);
  });

  it("finds a key by DOI", () => {
    expect(findHayagrivaKeyByDoi(HAND_WRITTEN, "https://doi.org/10.1/HARRY")).toBe("harry");
    expect(findHayagrivaKeyByDoi(HAND_WRITTEN, "10.2/legacy")).toBe("quoted:key");
    expect(findHayagrivaKeyByDoi(HAND_WRITTEN, "10.9/none")).toBeNull();
  });

  it("returns nothing for an empty or non-mapping document", () => {
    expect(hayagrivaEntries("")).toEqual([]);
    expect(hayagrivaEntries("- a\n- b\n")).toEqual([]);
  });
});

describe("appendHayagrivaEntries", () => {
  const block = 'b:\n  type: misc\n  title: "B"';

  it("separates a new entry from existing ones by a blank line", () => {
    expect(appendHayagrivaEntries('a:\n  type: misc\n  title: "A"\n\n\n', [block])).toBe(
      `a:\n  type: misc\n  title: "A"\n\n${block}\n`,
    );
  });

  it("writes into an empty file or an empty flow mapping", () => {
    expect(appendHayagrivaEntries("", [block])).toBe(`${block}\n`);
    expect(appendHayagrivaEntries("{}\n", [block])).toBe(`${block}\n`);
  });

  it("keeps a document end marker last", () => {
    expect(appendHayagrivaEntries('---\na:\n  title: "A"\n...\n', [block])).toBe(
      `---\na:\n  title: "A"\n\n${block}\n...\n`,
    );
  });
});

describe("looksLikeHayagriva", () => {
  it.each([
    ["a block entry", 'harry:\n  type: Book\n  title: "Harry"\n'],
    ["a title-only entry after comments and a document marker", '# refs\n---\n\nharry:\n    author: Rowling\n    title: Harry\n'],
    ["a quoted key", '"smith:2020":\n  type: article\n'],
    ["a flow entry", "harry: {type: book, title: Harry}\n"],
  ])("accepts %s", (_name, text) => {
    expect(looksLikeHayagriva(text)).toBe(true);
  });

  it.each([
    ["an empty file", ""],
    ["a list of records", "- name: a\n  value: 1\n- name: b\n  value: 2\n"],
    ["a config map", "name: CI\non:\n  push:\n    branches: [main]\n"],
    ["a scalar first key", "version: 2\nharry:\n  type: book\n"],
    ["a nested type below the entry level", "data:\n  rows:\n    type: table\n"],
    ["an entry whose type sits past the first few kilobytes", `first:\n${"  note: padding\n".repeat(600)}  type: book\n`],
  ])("rejects %s", (_name, text) => {
    expect(looksLikeHayagriva(text)).toBe(false);
  });

  it("decides from the first entry of a large file", () => {
    expect(looksLikeHayagriva(`harry:\n  type: book\n${"- [unterminated\n".repeat(400_000)}`)).toBe(true);
    expect(looksLikeHayagriva(`- row\n${"harry:\n  type: book\n".repeat(100_000)}`)).toBe(false);
  });
});
