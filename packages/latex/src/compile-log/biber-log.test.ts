import { describe, expect, it } from "vitest";
import { parseBiberLog } from "./biber-log";

describe("parseBiberLog", () => {
  it("attributes diagnostics to the most recently announced .bib data source", () => {
    const log = [
      "INFO - This is Biber 2.19",
      "INFO - Reading 'main.bcf'",
      "INFO - Found 2 citekeys in bib section 0",
      "INFO - Found BibTeX data source 'refs.bib'",
      "WARN - year field '2016' in entry 'baez2016' is not an integer - this will probably not sort properly.",
      "INFO - Found BibTeX data source 'extra.bib'",
      "WARN - month field '13' in entry 'doe2020' is not an integer - this will probably not sort properly.",
    ].join("\n");

    const diags = parseBiberLog(log);
    expect(diags).toHaveLength(2);

    expect(diags[0].severity).toBe("warning");
    expect(diags[0].category).toBe("biber");
    expect(diags[0].file).toBe("refs.bib");
    expect(diags[0].line).toBeNull();
    expect(diags[0].message).toBe(
      "year field '2016' in entry 'baez2016' is not an integer - this will probably not sort properly."
    );

    expect(diags[1].file).toBe("extra.bib");
    expect(diags[1].category).toBe("biber");
  });

  it("parses missing database entry warnings as undefined-citation", () => {
    const log = [
      "INFO - Found BibTeX data source 'refs.bib'",
      "WARN - I didn't find a database entry for 'missing2020' (section 0)",
    ].join("\n");

    const diags = parseBiberLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("warning");
    expect(d.category).toBe("undefined-citation");
    expect(d.file).toBe("refs.bib");
    expect(d.line).toBeNull();
    expect(d.message).toBe("I didn't find a database entry for 'missing2020' (section 0)");
  });

  it("parses BibTeX subsystem errors with a line number", () => {
    const log = [
      "INFO - Found BibTeX data source 'refs.bib'",
      'ERROR - BibTeX subsystem: /tmp/biber_tmp/refs.bib_1234.utf8, line 7, syntax error: found "author", expected ","',
      "INFO - ERRORS: 1",
    ].join("\n");

    const diags = parseBiberLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("error");
    expect(d.category).toBe("biber");
    expect(d.file).toBe("refs.bib");
    expect(d.line).toBe(7);
    expect(d.message).toBe('syntax error: found "author", expected ","');
  });

  it("attributes warnings to null when no data source has been announced", () => {
    const log = "WARN - I didn't find a database entry for 'orphan' (section 0)";

    const diags = parseBiberLog(log);
    expect(diags).toHaveLength(1);
    expect(diags[0].file).toBeNull();
    expect(diags[0].category).toBe("undefined-citation");
  });

  it("returns [] for empty input without throwing", () => {
    expect(parseBiberLog("")).toEqual([]);
  });
});
