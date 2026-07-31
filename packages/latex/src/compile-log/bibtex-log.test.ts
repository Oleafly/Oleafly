import { describe, expect, it } from "vitest";
import { parseBibtexLog } from "./bibtex-log";

describe("parseBibtexLog", () => {
  it("parses single-line warnings with the entry key folded into the message", () => {
    const log = [
      "This is BibTeX, Version 0.99d (TeX Live 2024)",
      "The top-level auxiliary file: main.aux",
      "The style file: plain.bst",
      "Database file #1: refs.bib",
      "Warning--empty journal in knuth1984",
      "(There was 1 warning)",
    ].join("\n");

    const diags = parseBibtexLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("warning");
    expect(d.category).toBe("bibtex");
    expect(d.file).toBeNull();
    expect(d.line).toBeNull();
    expect(d.message).toBe("empty journal in knuth1984");
  });

  it("parses multi-line warnings with a --line N of file location", () => {
    const log = [
      'Warning--I\'m ignoring urban2010\'s extra "year" field',
      "--line 12 of file refs.bib",
    ].join("\n");

    const diags = parseBibtexLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("warning");
    expect(d.category).toBe("bibtex");
    expect(d.file).toBe("refs.bib");
    expect(d.line).toBe(12);
    expect(d.message).toBe('I\'m ignoring urban2010\'s extra "year" field');
  });

  it("maps .aux to .tex for errors raised while reading the aux file", () => {
    const log = [
      "I found no \\citation commands---while reading file main.aux",
      "I found no \\bibdata command---while reading file main.aux",
      "I found no \\bibstyle command---while reading file main.aux",
      "(There were 3 error messages)",
    ].join("\n");

    const diags = parseBibtexLog(log);
    expect(diags).toHaveLength(3);
    for (const d of diags) {
      expect(d.severity).toBe("error");
      expect(d.category).toBe("bibtex");
      expect(d.file).toBe("main.tex");
      expect(d.line).toBeNull();
    }
    expect(diags[0].message).toBe("I found no \\citation commands");
    expect(diags[1].message).toBe("I found no \\bibdata command");
    expect(diags[2].message).toBe("I found no \\bibstyle command");
  });

  it("categorizes \"didn't find a database entry\" messages as undefined-citation", () => {
    // Synthetic --line continuation: the multi-line warning shape is the only
    // pattern that keeps the "didn't find a database entry" phrase intact in
    // the message, so it is the only route to the undefined-citation category.
    const log = [
      'Warning--I didn\'t find a database entry for "missing2020"',
      "--line 3 of file refs.bib",
    ].join("\n");

    const diags = parseBibtexLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("warning");
    expect(d.category).toBe("undefined-citation");
    expect(d.file).toBe("refs.bib");
    expect(d.line).toBe(3);
    expect(d.message).toBe('I didn\'t find a database entry for "missing2020"');
  });

  it("parses the real-world bare missing-entry warning line", () => {
    // Real BibTeX prints this warning on a single line with no
    // "--line N of file" continuation; upstream becabe2 misses it, so this
    // is an intentional port addition.
    const log = 'Warning--I didn\'t find a database entry for "missing2020"';
    const diags = parseBibtexLog(log);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("warning");
    expect(diags[0].category).toBe("undefined-citation");
    expect(diags[0].message).toBe(
      'I didn\'t find a database entry for "missing2020"',
    );
  });

  it("returns [] for empty input without throwing", () => {
    expect(parseBibtexLog("")).toEqual([]);
  });
});
