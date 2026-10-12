import { describe, it, expect } from "vitest";
import { runPreflight } from "./engine";
import { runRefsRules, type RefsContext } from "./refs-rules";

const ctx = (over: Partial<RefsContext> = {}): RefsContext => ({
  definedLabels: [],
  bibKeys: [],
  bibLoaded: true,
  projectFiles: [],
  duplicateDois: [],
  ...over,
});

const has = (src: string, c: RefsContext, id: string) => runRefsRules(src, c).some((f) => f.id === id);

describe("undefined citations", () => {
  it("flags a \\cite whose key is in no .bib", () => {
    expect(has("\\cite{smith21}", ctx({ bibKeys: [] }), "refs-undefined-cite")).toBe(true);
  });
  it("accepts a \\cite whose key exists", () => {
    expect(has("\\cite{smith21}", ctx({ bibKeys: ["smith21"] }), "refs-undefined-cite")).toBe(false);
  });
  it("flags the missing key in a multi-key cite", () => {
    const out = runRefsRules("\\cite{a,b}", ctx({ bibKeys: ["a"] }));
    expect(out.filter((f) => f.id === "refs-undefined-cite")).toHaveLength(1);
    expect(out.find((f) => f.id === "refs-undefined-cite")?.title).toEqual({
      key: "rules.refs-undefined-cite.title",
      params: { key: "b" },
    });
  });
  it("does not check citations when no .bib is loaded (avoids false positives)", () => {
    expect(has("\\cite{smith21}", ctx({ bibLoaded: false }), "refs-undefined-cite")).toBe(false);
  });
  it("ignores \\nocite{*}", () => {
    expect(has("\\nocite{*}", ctx(), "refs-undefined-cite")).toBe(false);
  });
});

describe("undefined references", () => {
  it("flags a \\ref with no matching \\label", () => {
    expect(has("\\ref{fig:2}", ctx(), "refs-undefined-ref")).toBe(true);
  });
  it("accepts a \\ref whose label is defined in the corpus", () => {
    expect(has("\\ref{fig:2}", ctx({ definedLabels: ["fig:2"] }), "refs-undefined-ref")).toBe(false);
  });
  it("accepts a label defined in the same source", () => {
    expect(has("\\label{fig:1}\\ref{fig:1}", ctx(), "refs-undefined-ref")).toBe(false);
  });
  it("handles \\cref with multiple labels", () => {
    const out = runRefsRules("\\cref{a,b}", ctx({ definedLabels: ["a"] }));
    expect(out.filter((f) => f.id === "refs-undefined-ref")).toHaveLength(1);
  });
});

describe("duplicate labels", () => {
  it("flags a label defined twice in the source", () => {
    expect(has("\\label{x}\\label{x}", ctx(), "refs-duplicate-label")).toBe(true);
  });
  it("does not flag distinct labels", () => {
    expect(has("\\label{a}\\label{b}", ctx(), "refs-duplicate-label")).toBe(false);
  });
  it("reports labels duplicated across project files", () => {
    const out = runRefsRules("", ctx({
      duplicateLabels: [{ label: "fig:result", files: ["a.tex", "b.tex"] }],
    }));
    expect(out).toContainEqual(expect.objectContaining({ id: "refs-project-duplicate-label", severity: "error" }));
  });

  it("reports unreferenced numbered objects as advisory", () => {
    const out = runRefsRules("", ctx({
      unreferencedLabels: [{ label: "fig:unused", file: "main.tex" }],
    }));
    expect(out).toContainEqual(expect.objectContaining({ id: "refs-unreferenced-floats", certainty: "advisory" }));
  });
});

describe("duplicate bib entries", () => {
  it("flags two entries that share a DOI", () => {
    const out = runRefsRules("", ctx({ duplicateDois: [{ doi: "10.1/x", keys: ["smith21", "smithdup"] }] }));
    const f = out.find((x) => x.id === "refs-duplicate-bib");
    expect(f).toBeDefined();
    expect(f!.title).toEqual({
      key: "rules.refs-duplicate-bib.title",
      params: { keys: "smith21, smithdup" },
    });
  });
  it("does not fire when there are no duplicates", () => {
    expect(runRefsRules("", ctx()).some((x) => x.id === "refs-duplicate-bib")).toBe(false);
  });
  it("leaves one key defined twice with the same DOI to the repeated-key finding", () => {
    const out = runRefsRules("", ctx({
      duplicateDois: [{ doi: "10.1/x", keys: ["same", "same"] }],
      bibKeyDefinitions: [
        { key: "same", file: "refs.bib", line: 1, from: 0, to: 14 },
        { key: "same", file: "extra.bib", line: 1, from: 0, to: 14 },
      ],
    }));
    expect(out.map((x) => x.id).filter((id) => id.startsWith("refs-duplicate-bib"))).toEqual(["refs-duplicate-bib-key"]);
  });
  it("counts keys that differ only in letter case as one key, as BibTeX does", () => {
    const out = runRefsRules("", ctx({ duplicateDois: [{ doi: "10.1/x", keys: ["smith2020", "Smith2020"] }] }));
    expect(out.some((x) => x.id === "refs-duplicate-bib")).toBe(false);
  });
  it("names each distinct key once when a repeated key also shares a DOI with another", () => {
    const out = runRefsRules("", ctx({ duplicateDois: [{ doi: "10.1/x", keys: ["same", "same", "other"] }] }));
    expect(out.find((x) => x.id === "refs-duplicate-bib")?.title).toEqual({
      key: "rules.refs-duplicate-bib.title",
      params: { keys: "same, other" },
    });
  });
});

const definition = (key: string, file: string, line: number, from: number) => ({
  key,
  file,
  line,
  from,
  to: from + key.length + 10,
});

const repeatedKeys = (c: RefsContext) => runRefsRules("", c).filter((f) => f.id === "refs-duplicate-bib-key");

describe("bibliography keys defined more than once", () => {
  it("reports a key defined in two .bib files and jumps to the first definition", () => {
    const out = repeatedKeys(ctx({
      bibKeyDefinitions: [
        definition("smith2020", "refs.bib", 3, 40),
        definition("jones2019", "refs.bib", 9, 200),
        definition("smith2020", "extra.bib", 1, 0),
      ],
    }));
    expect(out).toEqual([
      {
        id: "refs-duplicate-bib-key",
        lens: "refs",
        severity: "warning",
        certainty: "verified",
        title: { key: "rules.refs-duplicate-bib-key.title", params: { key: "smith2020" } },
        detail: { key: "rules.refs-duplicate-bib-key.detail", params: { places: "refs.bib:3, extra.bib:1" } },
        file: "refs.bib",
        from: 40,
        to: 59,
      },
    ]);
  });

  it("reports a key defined twice in one file with both lines", () => {
    const [finding] = repeatedKeys(ctx({
      bibKeyDefinitions: [
        definition("same", "refs.bib", 2, 10),
        definition("same", "refs.bib", 14, 300),
      ],
    }));
    expect(finding.detail).toEqual({
      key: "rules.refs-duplicate-bib-key.detail",
      params: { places: "refs.bib:2, refs.bib:14" },
    });
    expect(finding).toMatchObject({ file: "refs.bib", from: 10 });
  });

  it("treats keys that differ only in letter case as one key, the way BibTeX does", () => {
    const out = repeatedKeys(ctx({
      bibKeyDefinitions: [
        definition("smith2020", "refs.bib", 1, 0),
        definition("Smith2020", "refs.bib", 5, 90),
      ],
    }));
    expect(out).toHaveLength(1);
    expect(out[0].title).toEqual({ key: "rules.refs-duplicate-bib-key.title", params: { key: "smith2020" } });
    expect(out[0].detail.params).toEqual({ places: "refs.bib:1, refs.bib:5 (Smith2020)" });
  });

  it("stays quiet when every key is defined once", () => {
    expect(repeatedKeys(ctx({
      bibKeyDefinitions: [
        definition("alpha", "refs.bib", 1, 0),
        definition("beta", "refs.bib", 4, 60),
        definition("gamma", "extra.bib", 1, 0),
      ],
    }))).toEqual([]);
    expect(repeatedKeys(ctx())).toEqual([]);
  });

  it("reports each repeated key once even when the project has several LaTeX files", () => {
    const report = runPreflight({
      source: "",
      project: {
        mainFile: "main.tex",
        files: [
          { path: "main.tex", content: "\\cite{smith2020}" },
          { path: "chapter.tex", content: "\\cite{smith2020}" },
        ],
      },
      refs: ctx({
        bibKeys: ["smith2020"],
        bibKeyDefinitions: [
          definition("smith2020", "refs.bib", 1, 0),
          definition("smith2020", "extra.bib", 7, 120),
        ],
      }),
    });
    const findings = report.findings.filter((f) => f.id === "refs-duplicate-bib-key");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: "refs.bib", from: 0 });
  });
});

describe("bibliography quality", () => {
  it("summarizes incomplete required fields by entry type", () => {
    const out = runRefsRules("", ctx({
      bibEntries: [{ key: "paper", type: "article", fields: { title: "A useful paper", year: "2026" } }],
    }));
    expect(out).toContainEqual(expect.objectContaining({ id: "refs-incomplete-metadata", severity: "warning" }));
  });

  it("accepts an entry whose required fields use the biblatex spelling", () => {
    const out = runRefsRules("", ctx({
      bibEntries: [{
        key: "paper",
        type: "article",
        fields: { author: "A", title: "A useful paper", journaltitle: "J", date: "2026-02-01" },
      }],
    }));
    expect(out.some((finding) => finding.id === "refs-incomplete-metadata")).toBe(false);
  });

  it("still expects a title and a year on a free-form entry", () => {
    const out = runRefsRules("", ctx({
      bibEntries: [{ key: "note", type: "misc", fields: { author: "A" } }],
    }));
    expect(out.some((finding) => finding.id === "refs-incomplete-metadata")).toBe(true);
  });

  it("detects malformed DOIs and title duplicates", () => {
    const out = runRefsRules("", ctx({
      bibEntries: [
        { key: "a", type: "misc", fields: { title: "A sufficiently long duplicate research title", year: "2026", doi: "not-a-doi" } },
        { key: "b", type: "misc", fields: { title: "A sufficiently long duplicate research title", year: "2026" } },
      ],
    }));
    expect(out.map((finding) => finding.id)).toContain("refs-malformed-doi");
    expect(out.map((finding) => finding.id)).toContain("refs-duplicate-title");
  });

  it("reports uncited entries only when whole-project citation data is available", () => {
    const entry = { key: "unused", type: "misc", fields: { title: "Unused source", year: "2026" } };
    expect(runRefsRules("", ctx({ bibEntries: [entry] })).some((finding) => finding.id === "refs-uncited-entries")).toBe(false);
    expect(runRefsRules("", ctx({ bibEntries: [entry], allCitedKeys: [] })).some((finding) => finding.id === "refs-uncited-entries")).toBe(true);
    expect(runRefsRules("", ctx({ bibEntries: [entry], allCitedKeys: ["*"] })).some((finding) => finding.id === "refs-uncited-entries")).toBe(false);
  });
});

describe("missing assets", () => {
  it("flags an \\includegraphics whose file is not in the project", () => {
    expect(has("\\includegraphics{fig.png}", ctx({ projectFiles: [] }), "refs-missing-asset")).toBe(true);
  });
  it("accepts an image that exists", () => {
    expect(has("\\includegraphics{fig.png}", ctx({ projectFiles: ["fig.png"] }), "refs-missing-asset")).toBe(false);
  });
  it("resolves an extensionless image against a real file", () => {
    expect(has("\\includegraphics{fig}", ctx({ projectFiles: ["fig.pdf"] }), "refs-missing-asset")).toBe(false);
  });
  it("resolves an image in a subfolder by path suffix", () => {
    expect(has("\\includegraphics{fig.png}", ctx({ projectFiles: ["images/fig.png"] }), "refs-missing-asset")).toBe(false);
  });
  it("flags a missing \\input", () => {
    expect(has("\\input{sec1}", ctx({ projectFiles: [] }), "refs-missing-asset")).toBe(true);
  });
  it("accepts an \\input that resolves to a .tex", () => {
    expect(has("\\input{sec1}", ctx({ projectFiles: ["sec1.tex"] }), "refs-missing-asset")).toBe(false);
  });
});

describe("comment masking", () => {
  it("does not flag a commented-out undefined citation", () => {
    expect(has("% \\cite{smith21}", ctx({ bibKeys: [] }), "refs-undefined-cite")).toBe(false);
  });
  it("does not flag a commented-out undefined reference", () => {
    expect(has("% \\ref{fig:2}", ctx(), "refs-undefined-ref")).toBe(false);
  });
  it("treats an escaped percent as literal, so a later cite is still checked", () => {
    expect(has("\\% literal \\cite{smith21}", ctx({ bibKeys: [] }), "refs-undefined-cite")).toBe(true);
  });
  it("keeps source offsets stable after masking", () => {
    const out = runRefsRules("% note\n\\ref{missing}", ctx());
    const f = out.find((x) => x.id === "refs-undefined-ref");
    expect(f).toBeDefined();
    expect("% note\n\\ref{missing}".slice(f!.from, f!.to)).toBe("\\ref{missing}");
  });
});

describe("finding shape", () => {
  it("tags findings with the refs lens and a source range", () => {
    const out = runRefsRules("\\ref{missing}", ctx());
    const f = out.find((x) => x.id === "refs-undefined-ref");
    expect(f?.lens).toBe("refs");
    expect(typeof f?.from).toBe("number");
  });
});

describe("declared bibliography files", () => {
  it("flags an \\addbibresource the project does not contain", () => {
    const out = runRefsRules(
      "\\addbibresource{references.bib}",
      ctx({ projectFiles: ["main.tex"] }),
    );
    const finding = out.find((f) => f.id === "refs-bib-missing");
    expect(finding?.severity).toBe("error");
    expect(finding?.title.params?.file).toBe("references.bib");
  });

  it("accepts a resource that exists at the project root", () => {
    expect(
      has(
        "\\addbibresource{references.bib}",
        ctx({ projectFiles: ["main.tex", "references.bib"] }),
        "refs-bib-missing",
      ),
    ).toBe(false);
  });

  it("supplies the .bib extension a natbib declaration omits", () => {
    expect(
      has(
        "\\bibliography{refs}",
        ctx({ projectFiles: ["main.tex", "refs.bib"] }),
        "refs-bib-missing",
      ),
    ).toBe(false);
  });

  it("reports each missing file of a comma list", () => {
    const out = runRefsRules(
      "\\bibliography{present,absent}",
      ctx({ projectFiles: ["main.tex", "present.bib"] }),
    );
    const findings = out.filter((f) => f.id === "refs-bib-missing");
    expect(findings).toHaveLength(1);
    expect(findings[0].title.params?.file).toBe("absent.bib");
  });

  it("ignores a remote resource and a commented declaration", () => {
    expect(
      has(
        "\\addbibresource[location=remote]{https://example.org/refs.bib}",
        ctx({ projectFiles: ["main.tex"] }),
        "refs-bib-missing",
      ),
    ).toBe(false);
    expect(
      has(
        "% \\addbibresource{references.bib}",
        ctx({ projectFiles: ["main.tex"] }),
        "refs-bib-missing",
      ),
    ).toBe(false);
  });

  it("stays quiet when the project file list is unavailable", () => {
    expect(
      has("\\addbibresource{references.bib}", ctx(), "refs-bib-missing"),
    ).toBe(false);
  });

  it("refuses a file that only shares the basename of the declared path", () => {
    expect(
      has(
        "\\addbibresource{missing/refs.bib}",
        ctx({ projectFiles: ["main.tex", "other/refs.bib"] }),
        "refs-bib-missing",
      ),
    ).toBe(true);
  });

  it("resolves against the declaring file when the root has no copy", () => {
    const out = runRefsRules(
      "\\addbibresource{local.bib}",
      ctx({ projectFiles: ["chapters/one.tex", "chapters/local.bib"] }),
      { file: "chapters/one.tex" },
    );
    expect(out.some((f) => f.id === "refs-bib-missing")).toBe(false);
  });

  it("takes the caller's unresolved list over its own lookup", () => {
    const files = ["main.tex", "references.bib"];
    expect(
      runRefsRules(
        "\\addbibresource{references.bib}",
        ctx({
          projectFiles: files,
          unresolvedBibliographies: [{ file: "main.tex", name: "references.bib" }],
        }),
        { file: "main.tex" },
      ).some((f) => f.id === "refs-bib-missing"),
    ).toBe(true);
    expect(
      runRefsRules(
        "\\addbibresource{gone.bib}",
        ctx({ projectFiles: files, unresolvedBibliographies: [] }),
        { file: "main.tex" },
      ).some((f) => f.id === "refs-bib-missing"),
    ).toBe(false);
  });

  it("blames only the declaring file whose copy is missing", () => {
    const source = "\\addbibresource{local.bib}";
    const context = ctx({
      projectFiles: ["chapters/good.tex", "chapters/local.bib", "appendix/bad.tex"],
      unresolvedBibliographies: [{ file: "appendix/bad.tex", name: "local.bib" }],
    });

    expect(
      runRefsRules(source, context, { file: "chapters/good.tex" }).some(
        (f) => f.id === "refs-bib-missing",
      ),
    ).toBe(false);
    expect(
      runRefsRules(source, context, { file: "appendix/bad.tex" }).some(
        (f) => f.id === "refs-bib-missing",
      ),
    ).toBe(true);
  });

  it("stays quiet about a name another file resolved when the declaring file is unknown", () => {
    const source = "\\addbibresource{local.bib}";
    const context = ctx({
      projectFiles: ["chapters/good.tex", "chapters/local.bib", "appendix/bad.tex"],
      unresolvedBibliographies: [{ file: "appendix/bad.tex", name: "local.bib" }],
    });

    expect(runRefsRules(source, context).some((f) => f.id === "refs-bib-missing")).toBe(
      false,
    );
  });

  it("reports a name no declaring file resolved even without the declaring file", () => {
    const context = ctx({
      projectFiles: ["main.tex", "other/refs.bib"],
      unresolvedBibliographies: [{ file: "main.tex", name: "gone.bib" }],
    });

    expect(
      runRefsRules("\\addbibresource{gone.bib}", context).some(
        (f) => f.id === "refs-bib-missing",
      ),
    ).toBe(true);
  });

  it("resolves a dotted declaration against its .bib file", () => {
    expect(
      has(
        "\\bibliography{refs.v1}",
        ctx({ projectFiles: ["main.tex", "refs.v1.bib"] }),
        "refs-bib-missing",
      ),
    ).toBe(false);
  });

  it("reports a dotted \\addbibresource that names no file in the project", () => {
    const out = runRefsRules(
      "\\addbibresource{refs.v1}",
      ctx({ projectFiles: ["main.tex", "refs.v1.bib"] }),
    );
    const finding = out.find((f) => f.id === "refs-bib-missing");
    expect(finding?.severity).toBe("error");
    expect(finding?.title).toEqual({
      key: "rules.refs-bib-missing.title",
      params: { file: "refs.v1" },
    });
  });

  it("reports a bare \\addbibresource name even when its .bib file exists", () => {
    const out = runRefsRules(
      "\\addbibresource{refs}",
      ctx({ projectFiles: ["main.tex", "refs.bib"] }),
    );
    expect(out.find((f) => f.id === "refs-bib-missing")?.title).toEqual({
      key: "rules.refs-bib-missing.title",
      params: { file: "refs" },
    });
  });

  it("accepts an \\addbibresource that spells the whole file name", () => {
    expect(
      has(
        "\\addbibresource{refs.v1.bib}",
        ctx({ projectFiles: ["main.tex", "refs.v1.bib"] }),
        "refs-bib-missing",
      ),
    ).toBe(false);
  });
});
