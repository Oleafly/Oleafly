import { figureBlock, PREAMBLE, SECTION_CMD } from "./assemble";
import { orderByColumns } from "./columns";
import { escapeLatex, restoreUrlsInTex } from "./escape";
import { classifyHeadings, type HeadingLevel } from "./headings";
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

interface BodyCounts {
  headings: number;
  paragraphs: number;
  equations: number;
}

function collectPageNotes(selected: PageInput[], lo: number, notes: ReportNote[]): void {
  selected.forEach((p, i) => {
    if (p.items.length === 0) {
      notes.push({ page: lo + i, kind: "no-text-layer", detail: "no selectable text on this page" });
    }
    for (const name of p.figureNames) {
      notes.push({ page: lo + i, kind: "figure-extracted", detail: name });
    }
  });
}

function findTitle(
  allParas: { para: Para; page: number }[],
  headings: Map<Para, HeadingLevel>,
): Para | null {
  for (const { para, page } of allParas) {
    if (page === 0 && headings.get(para) === 1) return para;
  }
  return null;
}

function renderParaBody(
  para: Para,
  level: HeadingLevel | undefined,
  hasTitle: boolean,
  counts: BodyCounts,
): string {
  if (level) {
    // the title consumed level 1, so remaining levels shift up
    const eff = (hasTitle ? Math.max(1, level - 1) : level) as HeadingLevel;
    counts.headings++;
    return `${SECTION_CMD[eff]}{${escapeLatex(para.text)}}`;
  }
  if (para.lines.length === 1 && isDisplayMathLine(para.text)) {
    const { text } = mathifyText(escapeLatex(para.text));
    counts.equations++;
    return String.raw`\[ ${stripMathDelimiters(text)} \]`;
  }
  const rendered = para.lines.map((l) => {
    const raw = renderLineText(l, escapeLatex);
    const withMath = mathifyText(raw);
    counts.equations += withMath.inlineCount;
    return restoreUrlsInTex(withMath.text);
  });
  counts.paragraphs++;
  return rendered.join("\n");
}

function pushFigures(body: string[], names: string[], emitted: Set<string>): void {
  for (const name of names) {
    if (!emitted.has(name)) {
      body.push(figureBlock(name));
      emitted.add(name);
    }
  }
}

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

  collectPageNotes(selected, lo, notes);
  const likelyScanned = selected.length > 0 && selected.every((p) => p.items.length === 0);

  const allParas: { para: Para; page: number }[] = [];
  stripped.forEach((lines, i) => {
    for (const para of buildParas(lines)) allParas.push({ para, page: i });
  });
  const paras = allParas.map((e) => e.para);
  const headings = classifyHeadings(paras, options.headingSensitivity ?? 0.5);

  const title = findTitle(allParas, headings);

  const counts: BodyCounts = { headings: 0, paragraphs: 0, equations: 0 };
  const body: string[] = [];
  const emittedFigures = new Set<string>();

  const lastParaOfPage = new Map<number, Para>();
  for (const { para, page } of allParas) lastParaOfPage.set(page, para);

  for (const { para, page } of allParas) {
    if (para === title) continue;
    body.push(renderParaBody(para, headings.get(para), title !== null, counts));
    if (lastParaOfPage.get(page) === para) {
      pushFigures(body, selected[page].figureNames, emittedFigures);
    }
  }
  selected.forEach((p) => {
    pushFigures(body, p.figureNames, emittedFigures);
  });

  const report: ConversionReport = {
    pages: selected.length,
    headings: counts.headings,
    paragraphs: counts.paragraphs,
    equations: counts.equations,
    figures: emittedFigures.size,
    likelyScanned,
    notes,
  };

  const tex = [
    PREAMBLE,
    "",
    String.raw`\title{${title ? escapeLatex(title.text) : ""}}`,
    String.raw`\author{}`,
    String.raw`\date{}`,
    String.raw`\begin{document}`,
    ...(title ? [String.raw`\maketitle`] : []),
    "",
    body.join("\n\n"),
    "",
    String.raw`\end{document}`,
    "",
  ].join("\n");

  return { tex, report };
}
