import { describe, it, expect } from "vitest";
import { runSourceRules } from "./source-rules";

const has = (text: string, id: string) => runSourceRules(text).some((f) => f.id === id);

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
});
