import { readFileSync } from "node:fs";
import { test, expect } from "../fixtures";
import {
  clickToolbarControl,
  compileAndProbe,
  createBlankProject,
  editorSource,
  readProjectText,
  replaceEditorLiteral,
  replaceEditorSelection,
  replaceEditorSource,
  selectEditorText,
  setEditorCaretAfter,
  writeProjectBinary,
  type Page,
} from "../helpers";
import type {
  E2ePdfProbe,
  E2ePdfTextItem,
} from "../../src/lib/e2e-probe";

const RUN = Date.now().toString(36);
const FIXTURE_PNG = readFileSync(
  new URL(
    "../../src-tauri/resources/templates/blank/preview.png",
    import.meta.url,
  ),
).toString("base64");

interface SymbolFixtureItem {
  char: string;
  latex: string;
  name: string;
}

interface SymbolFixtureCategory {
  id: string;
  label: string;
  items: SymbolFixtureItem[];
}

async function freshLatex(page: Page, suffix: string, source: string) {
  await createBlankProject(page, `E2E Semantic ${suffix} ${RUN}`);
  await replaceEditorSource(page, source);
}

async function chooseHeading(page: Page, label: string) {
  await clickToolbarControl(page, '[aria-label="Heading level"]', "Heading");
  await page.getByText(label, { exact: true }).click();
}

async function clickLiveToolbarPopoverTrigger(page: Page, ariaLabel: string) {
  const encodedLabel = JSON.stringify(ariaLabel);
  const directSelector = `button[aria-label=${encodedLabel}].size-7`;
  const menuSelector =
    `[data-radix-popper-content-wrapper] [data-state="open"] ` +
    `button[aria-label=${encodedLabel}].w-full`;
  // Probe and click in the SAME browser task: a ResizeObserver relayout or
  // Radix remount between a readiness probe and a separate click call leaves
  // the click targeting a node that no longer exists (the race class
  // clickToolbarControl in helpers.ts fixed).
  const directClicked = await page.evaluate<boolean>(
    `(() => {
      const element = document.querySelector(${JSON.stringify(directSelector)});
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.display === "none" ||
        style.visibility === "hidden"
      ) {
        return false;
      }
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      if (!hit || (hit !== element && !element.contains(hit))) return false;
      element.click();
      return true;
    })()`,
  );
  if (directClicked) return;

  const moreSelector = 'button[aria-label="More formatting options"]';
  const moreExpanded = await page.evaluate<boolean>(
    `document.querySelector(${JSON.stringify(moreSelector)})?.getAttribute("aria-expanded") === "true"`,
  );
  if (!moreExpanded) {
    await page.click(moreSelector, { timeout: 3_000 });
  }
  const deadline = Date.now() + 3_000;
  for (;;) {
    const menuClicked = await page.evaluate<boolean>(
      `(() => {
        const elements = Array.from(
          document.querySelectorAll(${JSON.stringify(menuSelector)})
        );
        if (elements.length !== 1) return false;
        const element = elements[0];
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        if (!hit || (hit !== element && !element.contains(hit))) return false;
        element.click();
        return true;
      })()`,
    );
    if (menuClicked) return;
    if (Date.now() > deadline) {
      throw new Error(`${ariaLabel} popover trigger never became clickable`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function chooseList(page: Page, label: "Bulleted list" | "Numbered list") {
  for (let attempt = 0; attempt < 8; attempt++) {
    // Radix keeps the closing portal mounted for its exit animation. A global
    // text locator can otherwise resolve that stale item, report it visible for
    // one frame, and then wait forever after it disappears. Always open the
    // current list popover first, then require one exact item in the live portal
    // before creating the locator that clicks it.
    const triggerClicked = await clickLiveToolbarPopoverTrigger(page, "Insert list")
      .then(() => true)
      .catch(() => false);
    if (!triggerClicked) {
      await page.press("body", "Escape").catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    const live = await page
      .waitForFunction(
        `(() => {
          const label = ${JSON.stringify(label)};
          const triggers = Array.from(
            document.querySelectorAll('button[aria-label="Insert list"]')
          );
          const expanded = triggers.some(
            (trigger) => trigger.getAttribute("aria-expanded") === "true"
          );
          const items = Array.from(
            document.querySelectorAll('[data-radix-popper-content-wrapper] button')
          ).filter((button) => button.textContent?.trim() === label);
          return (
            expanded &&
            items.length === 1 &&
            Boolean(items[0].closest('[data-state="open"]'))
          );
        })()`,
        3_000,
      )
      .then(() => true)
      .catch(() => false);
    if (live) {
      const item = page.getByText(label, { exact: true });
      await expect(item).toBeVisible({ timeout: 3_000 });
      await item.click();
      return;
    }
    await page.press("body", "Escape").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} never opened from the toolbar list picker`);
}

async function insertTable2By2(page: Page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await clickToolbarControl(page, '[aria-label="Insert table"]', "Table");
    const available = await page
      .waitForFunction(`!!document.querySelector('[aria-label="2 by 2 table"]')`, 3_000)
      .then(() => true)
      .catch(() => false);
    if (!available) continue;
    await page.click('[aria-label="2 by 2 table"]');
    if ((await editorSource(page)).includes("\\begin{tabular}{ll}")) return;
  }
  throw new Error("2 by 2 toolbar table picker never inserted a table");
}

async function insertSymbol(page: Page, category: string, name: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const triggerClicked = await clickLiveToolbarPopoverTrigger(page, "Insert symbol")
      .then(() => true)
      .catch(() => false);
    if (!triggerClicked) {
      await page.press("body", "Escape").catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    const live = await page
      .waitForFunction(
        `(() => {
          const triggers = Array.from(
            document.querySelectorAll('button[aria-label="Insert symbol"]')
          );
          const expanded = triggers.some(
            (trigger) => trigger.getAttribute("aria-expanded") === "true"
          );
          const searches = Array.from(
            document.querySelectorAll(
              '[data-radix-popper-content-wrapper] input[aria-label="Search symbols"]'
            )
          );
          return (
            expanded &&
            searches.length === 1 &&
            Boolean(searches[0].closest('[data-state="open"]'))
          );
        })()`,
        3_000,
      )
      .then(() => true)
      .catch(() => false);
    if (live) {
      const search = page.locator('[aria-label="Search symbols"]') as unknown as Parameters<
        typeof expect
      >[0];
      await expect(search).toBeVisible({ timeout: 3_000 });
      await page.getByText(category, { exact: true }).click();
      await page.click(`button[title=${JSON.stringify(name)}]`);
      return;
    }
    await page.press("body", "Escape").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${name} never opened from the toolbar symbol picker`);
}

function allItems(probe: E2ePdfProbe): E2ePdfTextItem[] {
  return probe.pages.flatMap((page) => page.items);
}

function itemContaining(probe: E2ePdfProbe, token: string): E2ePdfTextItem {
  const item = allItems(probe).find((candidate) => candidate.str.includes(token));
  if (!item) {
    throw new Error(
      `PDF text item ${JSON.stringify(token)} not found; items=${JSON.stringify(
        allItems(probe).map((candidate) => candidate.str),
      )}`,
    );
  }
  return item;
}

function fontIdentity(item: E2ePdfTextItem): string {
  return item.pdfFontName ?? item.loadedFontName ?? item.fontName;
}

function operatorCount(
  probe: E2ePdfProbe,
  predicate: (name: string) => boolean,
): number {
  return probe.pages.reduce(
    (total, page) =>
      total +
      Object.entries(page.operatorCounts).reduce(
        (pageTotal, [name, count]) =>
          pageTotal + (predicate(name) ? count : 0),
        0,
      ),
    0,
  );
}

test("book heading controls compile Part and Chapter into text and PDF outline", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await freshLatex(
    tauriPage,
    "Book headings",
    String.raw`\documentclass{book}
\usepackage[T1]{fontenc}
\usepackage[hidelinks]{hyperref}
\begin{document}
BOOKPARTSEMANTIC
BOOKCHAPTERSEMANTIC
\end{document}
`,
  );

  await selectEditorText(tauriPage, "BOOKPARTSEMANTIC");
  await chooseHeading(tauriPage, "Part");
  await selectEditorText(tauriPage, "BOOKCHAPTERSEMANTIC");
  await chooseHeading(tauriPage, "Chapter");

  const source = await editorSource(tauriPage);
  expect(source).toContain("\\part{BOOKPARTSEMANTIC}");
  expect(source).toContain("\\chapter{BOOKCHAPTERSEMANTIC}");

  const probe = await compileAndProbe(tauriPage);
  expect(probe.text).toContain("BOOKPARTSEMANTIC");
  expect(probe.text).toContain("BOOKCHAPTERSEMANTIC");
  expect(
    probe.outline.some((title) => title.includes("BOOKPARTSEMANTIC")),
  ).toBe(true);
  expect(
    probe.outline.some((title) => title.includes("BOOKCHAPTERSEMANTIC")),
  ).toBe(true);
});

test("article heading controls compile every article-valid hierarchy level", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await freshLatex(
    tauriPage,
    "Article headings",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[hidelinks]{hyperref}
\begin{document}
SECTIONSEMANTIC
SUBSECTIONSEMANTIC
SUBSUBSECTIONSEMANTIC
PARAGRAPHSEMANTIC
\end{document}
`,
  );

  const levels = [
    ["SECTIONSEMANTIC", "Section", "section"],
    ["SUBSECTIONSEMANTIC", "Subsection", "subsection"],
    ["SUBSUBSECTIONSEMANTIC", "Subsubsection", "subsubsection"],
    ["PARAGRAPHSEMANTIC", "Paragraph", "paragraph"],
  ] as const;
  for (const [token, label, command] of levels) {
    await selectEditorText(tauriPage, token);
    await chooseHeading(tauriPage, label);
    expect(await editorSource(tauriPage)).toContain(`\\${command}{${token}}`);
  }

  const probe = await compileAndProbe(tauriPage);
  for (const [token] of levels) expect(probe.text).toContain(token);
  expect(probe.outline).toEqual(
    expect.arrayContaining([
      "SECTIONSEMANTIC",
      "SUBSECTIONSEMANTIC",
      "SUBSUBSECTIONSEMANTIC",
    ]),
  );
});

test("underline adds isolated PDF rule operators without changing text geometry", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await freshLatex(
    tauriPage,
    "Underline isolation",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\begin{document}
UNDERLINEISOLATEDSEMANTIC
\end{document}
`,
  );

  const baseline = await compileAndProbe(tauriPage);
  const baselineItem = itemContaining(
    baseline,
    "UNDERLINEISOLATEDSEMANTIC",
  );
  const baselinePaths = operatorCount(
    baseline,
    (name) => name === "constructPath",
  );

  await selectEditorText(tauriPage, "UNDERLINEISOLATEDSEMANTIC");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Underline"]',
    "Underline",
  );
  expect(await editorSource(tauriPage)).toContain(
    "\\underline{UNDERLINEISOLATEDSEMANTIC}",
  );

  const underlined = await compileAndProbe(tauriPage);
  const underlinedItem = itemContaining(
    underlined,
    "UNDERLINEISOLATEDSEMANTIC",
  );
  expect(
    operatorCount(underlined, (name) => name === "constructPath"),
  ).toBeGreaterThan(baselinePaths);
  expect(underlinedItem.x).toBeCloseTo(baselineItem.x, 0);
  expect(underlinedItem.y).toBeCloseTo(baselineItem.y, 0);
  expect(underlinedItem.height).toBeCloseTo(baselineItem.height, 0);
});

test("formatting, link, reference, footnote, and quote controls have PDF semantics", async ({
  tauriPage,
}) => {
  test.setTimeout(240_000);
  await freshLatex(
    tauriPage,
    "Inline semantics",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[hidelinks]{hyperref}
\begin{document}
REGULARSEMANTIC

BOLDSEMANTIC

ITALICSEMANTIC

UNDERLINESEMANTIC

CODESEMANTIC

LINKANCHOR

\section{TARGETSECTIONSEMANTIC}\label{sec:semantic-target}
Resolved reference: sec:semantic-target.

Body marker FOOTNOTESEMANTIC

QUOTESEMANTIC
\end{document}
`,
  );

  await selectEditorText(tauriPage, "BOLDSEMANTIC");
  await clickToolbarControl(tauriPage, '[aria-label^="Bold ("]', "Bold");
  await selectEditorText(tauriPage, "ITALICSEMANTIC");
  await clickToolbarControl(tauriPage, '[aria-label^="Italic ("]', "Italic");
  await selectEditorText(tauriPage, "UNDERLINESEMANTIC");
  await clickToolbarControl(tauriPage, '[aria-label="Underline"]', "Underline");
  await selectEditorText(tauriPage, "CODESEMANTIC");
  await clickToolbarControl(tauriPage, '[aria-label="Inline code"]', "Inline code");

  await selectEditorText(tauriPage, "LINKANCHOR");
  await clickToolbarControl(tauriPage, '[aria-label="Insert link"]', "Insert link");
  await replaceEditorLiteral(
    tauriPage,
    String.raw`\href{url}{link text}`,
    String.raw`\href{https://example.com/e2e-toolbar}{LINKSEMANTIC}`,
  );

  await selectEditorText(tauriPage, "sec:semantic-target", 2);
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert cross-reference"]',
    "Insert cross-reference",
  );
  await selectEditorText(tauriPage, "FOOTNOTESEMANTIC");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert footnote"]',
    "Insert footnote",
  );
  await selectEditorText(tauriPage, "QUOTESEMANTIC");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert blockquote"]',
    "Insert blockquote",
  );

  const source = await editorSource(tauriPage);
  expect(source).toContain("\\textbf{BOLDSEMANTIC}");
  expect(source).toContain("\\textit{ITALICSEMANTIC}");
  expect(source).toContain("\\underline{UNDERLINESEMANTIC}");
  expect(source).toContain("\\texttt{CODESEMANTIC}");
  expect(source).toContain(
    "\\href{https://example.com/e2e-toolbar}{LINKSEMANTIC}",
  );
  expect(source).toContain("\\ref{sec:semantic-target}");
  expect(source).toContain("\\footnote{FOOTNOTESEMANTIC}");
  expect(source).toContain("\\begin{quote}");

  const probe = await compileAndProbe(tauriPage);
  for (const token of [
    "REGULARSEMANTIC",
    "BOLDSEMANTIC",
    "ITALICSEMANTIC",
    "UNDERLINESEMANTIC",
    "CODESEMANTIC",
    "LINKSEMANTIC",
    "TARGETSECTIONSEMANTIC",
    "FOOTNOTESEMANTIC",
    "QUOTESEMANTIC",
  ]) {
    expect(probe.text).toContain(token);
  }
  expect(probe.text).not.toContain("??");

  const regular = itemContaining(probe, "REGULARSEMANTIC");
  const bold = itemContaining(probe, "BOLDSEMANTIC");
  const italic = itemContaining(probe, "ITALICSEMANTIC");
  const code = itemContaining(probe, "CODESEMANTIC");
  const footnote = itemContaining(probe, "FOOTNOTESEMANTIC");
  const quote = itemContaining(probe, "QUOTESEMANTIC");
  expect(fontIdentity(bold)).not.toBe(fontIdentity(regular));
  expect(fontIdentity(italic)).not.toBe(fontIdentity(regular));
  expect(fontIdentity(code)).not.toBe(fontIdentity(regular));
  expect(footnote.height).toBeLessThan(regular.height);
  expect(quote.x).toBeGreaterThan(regular.x + 5);

  const annotations = probe.pages.flatMap((page) => page.annotations);
  expect(
    annotations.some(
      (annotation) =>
        annotation.url?.startsWith("https://example.com/e2e-toolbar") ||
        annotation.unsafeUrl?.startsWith("https://example.com/e2e-toolbar"),
    ),
  ).toBe(true);
  expect(
    annotations.some(
      (annotation) =>
        annotation.subtype === "Link" &&
        annotation.destination !== null &&
        annotation.url === null,
    ),
  ).toBe(true);
});

test("undo and redo change the next compiled PDF from absence to presence", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await freshLatex(
    tauriPage,
    "Undo redo",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\begin{document}
UNDOANCHOR
\end{document}
`,
  );
  await setEditorCaretAfter(tauriPage, "UNDOANCHOR");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert footnote"]',
    "Insert footnote",
  );
  expect((await compileAndProbe(tauriPage)).text).toContain("note text");

  await tauriPage.click('[aria-label^="Undo ("]');
  expect((await compileAndProbe(tauriPage)).text).not.toContain("note text");

  await tauriPage.click('[aria-label^="Redo ("]');
  expect((await compileAndProbe(tauriPage)).text).toContain("note text");
});

test("citation toolbar activation uses production addCitation and renders its bibliography", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await freshLatex(
    tauriPage,
    "Citation",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[hidelinks]{hyperref}
\begin{document}
CITATIONANCHOR
\bibliographystyle{plain}
\bibliography{references}
\end{document}
`,
  );
  await setEditorCaretAfter(tauriPage, "CITATIONANCHOR");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Add citation (DOI, arXiv, or title)"]',
    "Add citation",
  );
  await expect(
    tauriPage.locator(
      'input[placeholder="DOI, arXiv id, URL, or a paper title…"]',
    ),
  ).toBeVisible({ timeout: 5_000 });

  const citation = await tauriPage.evaluate<{ key?: string; error?: string }>(
    `Promise.all([
      import("/src/features/citation.ts"),
      import("/src/store/citation.ts"),
    ]).then(async ([{ addCitation }, { useCitationStore }]) => {
      const result = await addCitation(${JSON.stringify(String.raw`@article{fixture,
  author = {Lovelace, Ada and Turing, Alan},
  title = {{CITATIONSEMANTICEVIDENCE}},
  journal = {Deterministic E2E Journal},
  year = {2026},
  doi = {10.4242/e2e.semantic}
}`)});
      useCitationStore.getState().setOpen(false);
      return result;
    })`,
  );
  expect(citation.error).toBeUndefined();
  expect(citation.key).toBeTruthy();

  const source = await editorSource(tauriPage);
  expect(source).toContain(`\\cite{${citation.key}}`);
  const bibliography = await readProjectText(tauriPage, "references.bib");
  expect(bibliography).toContain("CITATIONSEMANTICEVIDENCE");
  expect(bibliography).toContain("10.4242/e2e.semantic");

  const probe = await compileAndProbe(tauriPage);
  expect(probe.text).toContain("CITATIONSEMANTICEVIDENCE");
  expect(probe.text).toContain("References");
  expect(probe.text).not.toContain("?");
});

test("figure and generated-table controls render a real image, captions, cells, and table geometry", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await freshLatex(
    tauriPage,
    "Figure table",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{graphicx}
\begin{document}
FIGUREANCHOR
TABLEANCHOR
\end{document}
`,
  );
  await writeProjectBinary(tauriPage, "semantic.png", FIXTURE_PNG);

  await selectEditorText(tauriPage, "FIGUREANCHOR");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert figure"]',
    "Insert figure",
  );
  await replaceEditorSelection(tauriPage, "semantic.png");
  await replaceEditorLiteral(
    tauriPage,
    "Caption text",
    "FIGURECAPTIONSEMANTIC",
  );

  await selectEditorText(tauriPage, "TABLEANCHOR");
  await insertTable2By2(tauriPage);
  await replaceEditorSelection(tauriPage, "TABLECAPTIONSEMANTIC");
  const generated = await editorSource(tauriPage);
  expect(generated).toContain("\\begin{tabular}{ll}");
  const generatedBody = generated.match(
    /\\begin\{tabular\}\{ll\}\n([\s\S]*?)\n  \\end\{tabular\}/,
  )?.[1];
  expect(generatedBody).toBeTruthy();
  expect(generatedBody?.split("\n")).toHaveLength(2);
  await replaceEditorLiteral(
    tauriPage,
    generatedBody ?? "",
    String.raw`    TABLECELLONE & TABLECELLTWO \\
    TABLECELLTHREE & TABLECELLFOUR \\`,
  );

  const probe = await compileAndProbe(tauriPage);
  for (const token of [
    "FIGURECAPTIONSEMANTIC",
    "TABLECAPTIONSEMANTIC",
    "TABLECELLONE",
    "TABLECELLTWO",
    "TABLECELLTHREE",
    "TABLECELLFOUR",
  ]) {
    expect(probe.text).toContain(token);
  }
  expect(
    operatorCount(probe, (name) => name.toLowerCase().includes("paintimage")),
  ).toBeGreaterThan(0);
  const cellOne = itemContaining(probe, "TABLECELLONE");
  const cellTwo = itemContaining(probe, "TABLECELLTWO");
  const cellThree = itemContaining(probe, "TABLECELLTHREE");
  const cellFour = itemContaining(probe, "TABLECELLFOUR");
  expect(Math.abs(cellOne.y - cellTwo.y)).toBeLessThan(1);
  expect(Math.abs(cellThree.y - cellFour.y)).toBeLessThan(1);
  expect(cellTwo.x).toBeGreaterThan(cellOne.x);
  expect(cellFour.x).toBeGreaterThan(cellThree.x);
  expect(Math.abs(cellOne.y - cellThree.y)).toBeGreaterThan(2);
});

test("lists, align, equation, fraction, and every symbol category render", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  await freshLatex(
    tauriPage,
    "Lists math symbols",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\begin{document}
BULLETANCHOR
NUMBERANCHOR
ALIGNSEMANTIC &= 4
EQUATIONSEMANTIC = 42
FRACTIONANCHOR
$SYMBOLANCHOR$
\end{document}
`,
  );

  await selectEditorText(tauriPage, "BULLETANCHOR");
  await chooseList(tauriPage, "Bulleted list");
  await replaceEditorSelection(tauriPage, "BULLETLISTSEMANTIC");
  await selectEditorText(tauriPage, "NUMBERANCHOR");
  await chooseList(tauriPage, "Numbered list");
  await replaceEditorSelection(tauriPage, "NUMBERLISTSEMANTIC");

  await selectEditorText(tauriPage, "ALIGNSEMANTIC &= 4");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert align environment"]',
    "Align environment",
  );
  await selectEditorText(tauriPage, "EQUATIONSEMANTIC = 42");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert equation environment"]',
    "Equation environment",
  );

  await selectEditorText(tauriPage, "FRACTIONANCHOR");
  await clickToolbarControl(
    tauriPage,
    '[aria-label="Insert fraction"]',
    "Fraction",
  );
  await replaceEditorSelection(tauriPage, "NUMERATORSEMANTIC");
  await replaceEditorLiteral(
    tauriPage,
    "denominator",
    "DENOMINATORSEMANTIC",
  );
  await replaceEditorLiteral(
    tauriPage,
    String.raw`\frac{NUMERATORSEMANTIC}{DENOMINATORSEMANTIC}`,
    String.raw`$\frac{\mathrm{NUMERATORSEMANTIC}}{\mathrm{DENOMINATORSEMANTIC}}$`,
  );

  await selectEditorText(tauriPage, "SYMBOLANCHOR");
  await insertSymbol(tauriPage, "Greek", "alpha");
  await insertSymbol(tauriPage, "Arrows", "rightarrow");
  await insertSymbol(tauriPage, "Operators", "times");
  await insertSymbol(tauriPage, "Relations", "leq");
  await insertSymbol(tauriPage, "Misc", "infty");

  const source = await editorSource(tauriPage);
  expect(source).toContain("\\begin{itemize}");
  expect(source).toContain("\\begin{enumerate}");
  expect(source).toContain("\\begin{align}");
  expect(source).toContain("\\begin{equation}");
  expect(source).toContain(
    String.raw`$\frac{\mathrm{NUMERATORSEMANTIC}}{\mathrm{DENOMINATORSEMANTIC}}$`,
  );
  for (const command of [
    "\\alpha",
    "\\rightarrow",
    "\\times",
    "\\leq",
    "\\infty",
  ]) {
    expect(source).toContain(command);
  }

  const probe = await compileAndProbe(tauriPage);
  // TeX math alphabets can expose one PDF text item per glyph; compare the
  // semantic tokens after removing pdf.js inter-item whitespace.
  const compactText = probe.text.replace(/\s+/g, "");
  for (const token of [
    "BULLETLISTSEMANTIC",
    "NUMBERLISTSEMANTIC",
    "ALIGNSEMANTIC",
    "EQUATIONSEMANTIC",
    "NUMERATORSEMANTIC",
    "DENOMINATORSEMANTIC",
  ]) {
    expect(compactText).toContain(token);
  }
  for (const renderedSymbol of ["α", "→", "×", "≤", "∞"]) {
    expect(probe.text).toContain(renderedSymbol);
  }
});

test("every symbol inventory macro compiles and exposes its deterministic PDF marker", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  const categories = await tauriPage.evaluate<SymbolFixtureCategory[]>(
    `import("/src/components/editor/SymbolPicker.tsx").then(
      ({ SYMBOL_CATEGORIES }) => SYMBOL_CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        items: category.items.map(({ char, latex, name }) => ({ char, latex, name })),
      }))
    )`,
  );
  expect(categories).toHaveLength(5);

  const groups = categories.map((category, categoryIndex) => {
    const entries = category.items.map((symbol, symbolIndex) => ({
      ...symbol,
      marker: `SYMBOL${categoryIndex}ITEM${symbolIndex}`,
    }));
    const rows = entries
      .map(
        ({ marker, latex }) =>
          String.raw`\noindent ${marker}: $${latex}$\par`,
      )
      .join("\n");
    return {
      category,
      entries,
      source: String.raw`\section*{${category.label}}
${rows}`,
    };
  });
  await freshLatex(
    tauriPage,
    "All symbols",
    String.raw`\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{amssymb}
\begin{document}
${groups.map((group) => group.source).join("\n")}
\end{document}
`,
  );
  const probe = await compileAndProbe(tauriPage);
  const compactText = probe.text.replace(/\s+/g, "");
  for (const { category, entries } of groups) {
    for (const { marker } of entries) {
      expect(compactText, `${category.label} marker ${marker}`).toContain(
        marker,
      );
    }
  }
});
