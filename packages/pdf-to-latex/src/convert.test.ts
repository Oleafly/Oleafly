import { describe, expect, it } from "vitest";
import { convertPages } from "./convert";
import type { PageInput, TextItem } from "./types";

const item = (
  str: string,
  x: number,
  y: number,
  fontSize = 10,
  fontName = "F+Times",
): TextItem => ({
  str,
  x,
  y,
  width: str.length * fontSize * 0.5,
  height: fontSize,
  fontName,
  fontSize,
});

const pg = (items: TextItem[], figureNames: string[] = []): PageInput => ({
  width: 612,
  height: 792,
  items,
  figureNames,
});

describe("convertPages", () => {
  it("produces a complete compilable document skeleton", () => {
    const r = convertPages([
      pg([item("A Fine Title", 200, 750, 18), item("Some body text here.", 72, 700)]),
    ]);
    expect(r.tex).toContain("\\documentclass[11pt]{article}");
    expect(r.tex).toContain("\\usepackage[margin=1in]{geometry}");
    expect(r.tex).toContain("\\title{A Fine Title}");
    expect(r.tex).toContain("\\maketitle");
    expect(r.tex).toContain("\\begin{document}");
    expect(r.tex).toContain("Some body text here.");
    expect(r.tex).toContain("\\end{document}");
  });

  it("emits sections for heading-sized short lines", () => {
    const r = convertPages([
      pg([
        item("Big Title", 200, 750, 18),
        item("Introduction", 72, 700, 14),
        item("Body text follows the section heading naturally.", 72, 680),
      ]),
    ]);
    expect(r.tex).toContain("\\section{Introduction}");
    expect(r.report.headings).toBeGreaterThanOrEqual(1);
  });

  it("references extracted figures", () => {
    const r = convertPages([pg([item("text", 72, 700)], ["figure_p1_1.png"])]);
    expect(r.tex).toContain("\\includegraphics[width=\\linewidth]{assets/figure_p1_1.png}");
    expect(r.report.figures).toBe(1);
  });

  it("flags a textless document as likely scanned", () => {
    const r = convertPages([pg([])]);
    expect(r.report.likelyScanned).toBe(true);
    expect(r.report.notes.some((n) => n.kind === "no-text-layer")).toBe(true);
  });

  it("text fidelity: every substantial source word survives", () => {
    const words =
      "Gradient descent converges when the learning rate schedule satisfies standard assumptions".split(
        " ",
      );
    const items = words.map((w, i) =>
      item(w, 72 + (i % 6) * 80, 700 - Math.floor(i / 6) * 12),
    );
    const r = convertPages([pg(items)]);
    for (const w of words.filter((w) => w.length >= 4)) expect(r.tex).toContain(w);
  });

  it("respects pageRange option", () => {
    const r = convertPages(
      [pg([item("page one", 72, 700)]), pg([item("page two", 72, 700)])],
      { pageRange: [2, 2] },
    );
    expect(r.tex).not.toContain("page one");
    expect(r.tex).toContain("page two");
  });

  it("wraps urls and counts stats", () => {
    const r = convertPages([
      pg([
        item("Visit https://example.com/a_b for details", 72, 700),
        item("Second paragraph text", 72, 660),
      ]),
    ]);
    expect(r.tex).toContain("\\url{https://example.com/a_b}");
    expect(r.report.paragraphs).toBe(2);
    expect(r.report.pages).toBe(1);
  });
});
