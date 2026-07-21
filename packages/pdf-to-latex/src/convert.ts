import { figureBlock, PREAMBLE, SECTION_CMD } from "./assemble";
import { orderByColumns } from "./columns";
import { escapeLatex, restoreUrlsInTex } from "./escape";
import { classifyHeadings } from "./headings";
import { buildLines, buildParas, type Para } from "./lines";
import { isDisplayMathLine, mathifyText, stripMathDelimiters } from "./math";
import { renderLineText } from "./styles";
import { stripRepeatedFurniture } from "./strip";
import type {
  ConversionReport,
  ConvertOptions,
  ConvertResult,
  PageInput,
  ReportNote,
} from "./types";

export function convertPages(pages: PageInput[], options: ConvertOptions = {}): ConvertResult {
  const [lo, hi] = options.pageRange ?? [1, pages.length];
  const selected = pages.slice(Math.max(0, lo - 1), hi);
  const notes: ReportNote[] = [];

  const pageLines = selected.map((p) =>
    buildLines(orderByColumns(p.items, p.width, options.columns ?? "auto")),
  );
  const stripped = stripRepeatedFurniture(
    pageLines,
    selected.map((p) => p.height),
  );

  selected.forEach((p, i) => {
    if (p.items.length === 0) {
      notes.push({ page: lo + i, kind: "no-text-layer", detail: "no selectable text on this page" });
    }
    for (const name of p.figureNames) {
      notes.push({ page: lo + i, kind: "figure-extracted", detail: name });
    }
  });
  const likelyScanned = selected.length > 0 && selected.every((p) => p.items.length === 0);

  const allParas: { para: Para; page: number }[] = [];
  stripped.forEach((lines, i) => {
    for (const para of buildParas(lines)) allParas.push({ para, page: i });
  });
  const paras = allParas.map((e) => e.para);
  const headings = classifyHeadings(paras, options.headingSensitivity ?? 0.5);

  let title: Para | null = null;
  for (const { para, page } of allParas) {
    if (page === 0 && headings.get(para) === 1) {
      title = para;
      break;
    }
  }

  let headingCount = 0;
  let paragraphCount = 0;
  let equationCount = 0;
  const body: string[] = [];
  const emittedFigures = new Set<string>();

  const lastParaOfPage = new Map<number, Para>();
  for (const { para, page } of allParas) lastParaOfPage.set(page, para);

  for (const { para, page } of allParas) {
    if (para === title) continue;
    const lvl = headings.get(para);
    if (lvl) {
      // the title consumed level 1, so remaining levels shift up
      const eff = (title ? Math.max(1, lvl - 1) : lvl) as 1 | 2 | 3;
      body.push(`${SECTION_CMD[eff]}{${escapeLatex(para.text)}}`);
      headingCount++;
    } else if (para.lines.length === 1 && isDisplayMathLine(para.text)) {
      const { text } = mathifyText(escapeLatex(para.text));
      body.push(`\\[ ${stripMathDelimiters(text)} \\]`);
      equationCount++;
    } else {
      const rendered = para.lines.map((l) => {
        const raw = renderLineText(l, escapeLatex);
        const withMath = mathifyText(raw);
        equationCount += withMath.inlineCount;
        return restoreUrlsInTex(withMath.text);
      });
      body.push(rendered.join("\n"));
      paragraphCount++;
    }
    if (lastParaOfPage.get(page) === para) {
      for (const name of selected[page].figureNames) {
        if (!emittedFigures.has(name)) {
          body.push(figureBlock(name));
          emittedFigures.add(name);
        }
      }
    }
  }
  selected.forEach((p) => {
    for (const name of p.figureNames) {
      if (!emittedFigures.has(name)) {
        body.push(figureBlock(name));
        emittedFigures.add(name);
      }
    }
  });

  const report: ConversionReport = {
    pages: selected.length,
    headings: headingCount,
    paragraphs: paragraphCount,
    equations: equationCount,
    figures: emittedFigures.size,
    likelyScanned,
    notes,
  };

  const tex = [
    PREAMBLE,
    "",
    `\\title{${title ? escapeLatex(title.text) : ""}}`,
    "\\author{}",
    "\\date{}",
    "\\begin{document}",
    ...(title ? ["\\maketitle"] : []),
    "",
    body.join("\n\n"),
    "",
    "\\end{document}",
    "",
  ].join("\n");

  return { tex, report };
}
