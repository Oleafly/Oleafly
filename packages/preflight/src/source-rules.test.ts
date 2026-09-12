import { describe, it, expect } from "vitest";
import { runSourceRules } from "./source-rules";

import type { PreflightEngine } from "./types";

const has = (text: string, id: string, engine?: PreflightEngine) =>
  runSourceRules(text, engine ? { engine } : undefined).some((f) => f.id === id);
const find = (text: string, id: string, engine?: PreflightEngine) =>
  runSourceRules(text, engine ? { engine } : undefined).find((f) => f.id === id);

describe("multi-column", () => {
  it("flags a twocolumn documentclass", () => {
    expect(has("\\documentclass[twocolumn]{article}", "multi-column")).toBe(true);
  });
  it("flags the multicol package", () => {
    expect(has("\\usepackage{multicol}", "multi-column")).toBe(true);
  });
  it("flags known two-column resume classes", () => {
    expect(has("\\documentclass{altacv}", "multi-column")).toBe(true);
  });
  it("does not flag a plain single-column article", () => {
    expect(has("\\documentclass{article}", "multi-column")).toBe(false);
  });
});

describe("no-glyphtounicode", () => {
  it("warns when a real document sets no unicode map", () => {
    expect(has("\\documentclass{article}\n\\begin{document}hi\\end{document}", "no-glyphtounicode")).toBe(true);
  });
  it("is satisfied by glyphtounicode + pdfgentounicode", () => {
    const t = "\\documentclass{article}\n\\input{glyphtounicode}\n\\pdfgentounicode=1\n\\begin{document}hi\\end{document}";
    expect(has(t, "no-glyphtounicode")).toBe(false);
  });
  it("is satisfied by the cmap package", () => {
    expect(has("\\documentclass{article}\\usepackage{cmap}", "no-glyphtounicode")).toBe(false);
  });
});

describe("no-glyphtounicode severity", () => {
  const DOC = "\\documentclass{article}\n\\begin{document}hi\\end{document}";
  it("stays a note on engines that build the map automatically", () => {
    expect(find(DOC, "no-glyphtounicode", "pdflatex")?.severity).toBe("info");
    expect(find(DOC, "no-glyphtounicode", "lualatex")?.detail).toContain("2021-06-01");
  });
  it("is a warning on XeTeX and the bundled engine", () => {
    expect(find(DOC, "no-glyphtounicode", "xelatex")?.severity).toBe("warning");
    expect(find(DOC, "no-glyphtounicode", "bundled")?.severity).toBe("warning");
  });
});

describe("ua-standard-without-title", () => {
  it("flags a PDF/UA declaration with no title", () => {
    expect(has("\\DocumentMetadata{pdfstandard=ua-2,tagging=on}\\documentclass{article}", "ua-standard-without-title")).toBe(true);
  });
  it("names what is missing", () => {
    const finding = find("\\DocumentMetadata{pdfstandard=ua-2}\\documentclass{article}\\hypersetup{pdftitle={A paper}}", "ua-standard-without-title");
    expect(finding?.detail).toContain("pdfdisplaydoctitle=true");
    expect(finding?.detail).not.toContain("pdftitle and");
  });
  it("is satisfied by a title the reader displays", () => {
    const src = "\\DocumentMetadata{pdfstandard=ua-2}\\documentclass{article}\\hypersetup{pdftitle={A paper},pdfdisplaydoctitle=true}";
    expect(has(src, "ua-standard-without-title")).toBe(false);
  });
  it("does not fire without a PDF/UA declaration", () => {
    expect(has("\\DocumentMetadata{tagging=on}\\documentclass{article}", "ua-standard-without-title")).toBe(false);
  });

  it("reads a declaration that sits behind a nested key group", () => {
    const src = "\\DocumentMetadata{tagging-setup={table/header-rows={1}},pdfstandard=ua-2}\\documentclass{article}";
    expect(has(src, "ua-standard-without-title")).toBe(true);
  });

  it("reads a declaration whose value is wrapped in braces", () => {
    const src = "\\DocumentMetadata{lang=en-US,pdfstandard={ua-2}}\\documentclass{article}";
    expect(has(src, "ua-standard-without-title")).toBe(true);
  });

  it("covers the whole declaration with the reported source range", () => {
    const src = "\\DocumentMetadata{tagging-setup={table/header-rows={1}},pdfstandard=ua-2}\\documentclass{article}";
    const finding = find(src, "ua-standard-without-title");
    expect(src.slice(finding?.from, finding?.to)).toBe(
      "\\DocumentMetadata{tagging-setup={table/header-rows={1}},pdfstandard=ua-2}",
    );
  });
});

describe("ua-standard-on-tectonic", () => {
  const SRC = "\\DocumentMetadata{pdfstandard=ua-2,tagging=on}\\documentclass{article}";
  it("is an error when the bundled engine would compile it", () => {
    expect(find(SRC, "ua-standard-on-tectonic", "bundled")?.severity).toBe("error");
  });
  it("does not fire on an engine that can tag", () => {
    expect(has(SRC, "ua-standard-on-tectonic", "lualatex")).toBe(false);
    expect(has(SRC, "ua-standard-on-tectonic", "pdflatex")).toBe(false);
  });
  it("does not fire when the engine is not known", () => {
    expect(has(SRC, "ua-standard-on-tectonic")).toBe(false);
  });
  it("still sees the declaration when the keys are nested and reordered", () => {
    const nested = "\\DocumentMetadata{tagging-setup={table/header-rows={1}},pdfstandard=ua-2}\\documentclass{article}";
    expect(has(nested, "ua-standard-on-tectonic", "bundled")).toBe(true);
  });
});

describe("table-header-rows", () => {
  const TABLE = "\\begin{tabular}{ll}Name & Score \\\\\\hline Ada & 1\\end{tabular}";
  it("flags a ruled header row that is not declared as one", () => {
    expect(has(TABLE, "table-header-rows")).toBe(true);
  });
  it("is satisfied by a declared header row", () => {
    expect(has(`\\DocumentMetadata{tagging-setup={table/header-rows={1}}}${TABLE}`, "table-header-rows")).toBe(false);
  });
  it("does not fire on a table with no rule under its first row", () => {
    expect(has("\\begin{tabular}{ll}a & b \\\\ c & d\\end{tabular}", "table-header-rows")).toBe(false);
  });
  it("does not mistake a bottom rule for a header separator", () => {
    expect(has("\\begin{tabular}{ll}a & b \\\\ c & d \\\\ \\hline\\end{tabular}", "table-header-rows")).toBe(false);
  });
  it("accepts a booktabs midrule under the first row", () => {
    expect(has("\\begin{tabular}{ll}Name & Score \\\\\\midrule Ada & 1\\end{tabular}", "table-header-rows")).toBe(true);
  });
  it("reads a rule that follows a spaced row terminator", () => {
    expect(has("\\begin{tabular}{ll}Name & Score \\\\[2pt]\n\\hline\nAda & 1\\end{tabular}", "table-header-rows")).toBe(true);
  });
  it("is satisfied by a header row declared through a nested metadata key", () => {
    const src = "\\DocumentMetadata{tagging-setup={table/header-rows={1}},pdfstandard=ua-2}\\begin{tabular}{ll}Name & Score \\\\\\hline Ada & 1\\end{tabular}";
    expect(has(src, "table-header-rows")).toBe(false);
  });
  it("reports once for a document with several tables", () => {
    expect(runSourceRules(`${TABLE}${TABLE}`).filter((f) => f.id === "table-header-rows")).toHaveLength(1);
  });
});

describe("icon-near-contact", () => {
  it("flags a fontawesome icon next to an email", () => {
    expect(has("\\faEnvelope\\ jane@doe.com", "icon-near-contact")).toBe(true);
  });
  it("does not flag an icon with no contact info", () => {
    expect(has("\\faStar\\ rating", "icon-near-contact")).toBe(false);
  });
  it("does not flag a plain email with no icon", () => {
    expect(has("jane@doe.com", "icon-near-contact")).toBe(false);
  });
});

describe("layout-table", () => {
  it("flags a tabular used for layout", () => {
    expect(has("\\begin{tabular}{ll}a&b\\end{tabular}", "layout-table")).toBe(true);
  });
  it("flags a tikzpicture", () => {
    expect(has("\\begin{tikzpicture}\\end{tikzpicture}", "layout-table")).toBe(true);
  });
  it("does not flag prose", () => {
    expect(has("just some text", "layout-table")).toBe(false);
  });
});

describe("contact-in-header", () => {
  it("flags contact info inside a fancyhdr header", () => {
    expect(has("\\lhead{jane@doe.com}", "contact-in-header")).toBe(true);
  });
  it("does not flag a plain header title", () => {
    expect(has("\\lhead{Resume}", "contact-in-header")).toBe(false);
  });
});

describe("figure-alt", () => {
  it("flags includegraphics with no alt", () => {
    expect(has("\\includegraphics{photo.png}", "figure-alt")).toBe(true);
  });
  it("flags includegraphics with options but no alt", () => {
    expect(has("\\includegraphics[width=2cm]{photo.png}", "figure-alt")).toBe(true);
  });
  it("flags alt that just repeats the filename", () => {
    expect(has("\\includegraphics[alt=photo.png]{photo.png}", "figure-alt")).toBe(true);
  });
  it("accepts a descriptive alt", () => {
    expect(has("\\includegraphics[alt={A headshot of Jane Doe}]{photo.png}", "figure-alt")).toBe(false);
  });
});

describe("link-text", () => {
  it("flags 'click here' link text", () => {
    expect(has("\\href{https://x.com}{click here}", "link-text")).toBe(true);
  });
  it("flags a bare-URL link text", () => {
    expect(has("\\href{https://x.com}{https://x.com}", "link-text")).toBe(true);
  });
  it("accepts descriptive link text", () => {
    expect(has("\\href{https://x.com}{my portfolio}", "link-text")).toBe(false);
  });
});

describe("no-lang", () => {
  it("warns when no document language is set", () => {
    expect(has("\\documentclass{article}\\begin{document}hi\\end{document}", "no-lang")).toBe(true);
  });
  it("is satisfied by babel", () => {
    expect(has("\\documentclass{article}\\usepackage[english]{babel}", "no-lang")).toBe(false);
  });
  it("is satisfied by hyperref pdflang", () => {
    expect(has("\\documentclass{article}\\hypersetup{pdflang=en-US}", "no-lang")).toBe(false);
  });
});

describe("no-title", () => {
  it("notes when no PDF title metadata is set", () => {
    expect(has("\\documentclass{article}\\begin{document}hi\\end{document}", "no-title")).toBe(true);
  });
  it("is satisfied by hyperref pdftitle", () => {
    expect(has("\\documentclass{article}\\hypersetup{pdftitle={Jane Doe CV}}", "no-title")).toBe(false);
  });
});

describe("heading-skip", () => {
  it("flags a section that jumps straight to subsubsection", () => {
    expect(has("\\section{A}\\subsubsection{B}", "heading-skip")).toBe(true);
  });
  it("accepts a well-nested heading sequence", () => {
    expect(has("\\section{A}\\subsection{B}\\subsubsection{C}", "heading-skip")).toBe(false);
  });
});

describe("nonstandard-headings", () => {
  it("flags a nonstandard heading when standard resume headings are present", () => {
    expect(has("\\section{Experience}\\section{My Journey}", "nonstandard-headings")).toBe(true);
  });
  it("does not fire on a research paper (no resume headings present)", () => {
    expect(has("\\section{Introduction}\\section{Methods}", "nonstandard-headings")).toBe(false);
  });
  it("does not flag all-standard resume headings", () => {
    expect(has("\\section{Experience}\\section{Education}", "nonstandard-headings")).toBe(false);
  });
});

describe("color-only", () => {
  it("notes textcolor usage", () => {
    expect(has("\\textcolor{red}{Important}", "color-only")).toBe(true);
  });
  it("does not fire without color", () => {
    expect(has("Important", "color-only")).toBe(false);
  });
});

describe("reading-order-risk", () => {
  it("notes marginpar", () => {
    expect(has("\\marginpar{a note}", "reading-order-risk")).toBe(true);
  });
  it("notes wrapfigure", () => {
    expect(has("\\begin{wrapfigure}{r}{4cm}x\\end{wrapfigure}", "reading-order-risk")).toBe(true);
  });
  it("does not fire on plain prose", () => {
    expect(has("plain prose", "reading-order-risk")).toBe(false);
  });
});

describe("comment masking", () => {
  it("does not flag a commented-out multicol package", () => {
    expect(has("% \\usepackage{multicol}", "multi-column")).toBe(false);
  });
  it("still flags an uncommented multicol package on a later line", () => {
    expect(has("% a note\n\\usepackage{multicol}", "multi-column")).toBe(true);
  });
  it("treats an escaped percent as literal text, not a comment", () => {
    // `\%` is a literal percent, so the multicol after it is NOT commented out.
    expect(has("\\documentclass{article} \\% literal percent \\usepackage{multicol}", "multi-column")).toBe(
      true,
    );
  });
  it("keeps source offsets stable after masking", () => {
    const src = "% comment\n\\includegraphics{photo.png}";
    const f = runSourceRules(src).find((x) => x.id === "figure-alt");
    expect(f).toBeDefined();
    expect(src.slice(f!.from, f!.to)).toBe("\\includegraphics{photo.png}");
  });
});

describe("mathml export hint", () => {
  it("suggests the HTML MathML export for documents with math", () => {
    const src = "\\documentclass{article}\n\\begin{document}\n\\begin{equation}\n  E = mc^2\n\\end{equation}\n\\end{document}\n";
    const findings = runSourceRules(src).filter((f) => f.id === "mathml-export-hint");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.lens).toBe("a11y");
    expect(findings[0]!.certainty).toBe("advisory");
    expect(findings[0]!.detail).toContain("--mathml");
  });
  it("stays quiet for prose without math", () => {
    const findings = runSourceRules("\\documentclass{article}\nPlain prose only.\n").filter(
      (f) => f.id === "mathml-export-hint",
    );
    expect(findings).toHaveLength(0);
  });
});

describe("finding shape", () => {
  it("gives match-based findings a source range", () => {
    const f = runSourceRules("\\includegraphics{photo.png}").find((x) => x.id === "figure-alt");
    expect(f).toBeDefined();
    expect(typeof f!.from).toBe("number");
    expect(f!.to).toBeGreaterThan(f!.from!);
  });
  it("tags every finding with a lens and severity", () => {
    for (const f of runSourceRules("\\documentclass[twocolumn]{article}\\includegraphics{p.png}")) {
      expect(["ats", "a11y", "both"]).toContain(f.lens);
      expect(["error", "warning", "info"]).toContain(f.severity);
    }
  });
  it("records that source findings are predictions, not readings of the PDF", () => {
    for (const f of runSourceRules("\\documentclass[twocolumn]{article}\\includegraphics{p.png}")) {
      expect(f.method).toBe("source-heuristic");
    }
  });
});
