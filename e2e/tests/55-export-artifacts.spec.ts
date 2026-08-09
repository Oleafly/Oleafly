import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";
import { test, expect } from "../fixtures";
import {
  compileAndProbe,
  createBlankProject,
  createProjectFromTemplate,
  pressGlobal,
  readProjectText,
  replaceEditorSource,
  setNextSavePath,
  writeProjectBinary,
  type Page,
} from "../helpers";

async function persistSource(page: Page, source: string) {
  await replaceEditorSource(page, source);
  await pressGlobal(page, "s", { meta: true });
  const deadline = Date.now() + 20_000;
  for (;;) {
    if ((await readProjectText(page, "main.tex")) === source) return;
    if (Date.now() > deadline) throw new Error("main.tex was not persisted");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function waitForArtifact(path: string, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let priorSize = -1;
  let stableReads = 0;
  for (;;) {
    if (existsSync(path)) {
      const size = statSync(path).size;
      if (size > 0 && size === priorSize) {
        stableReads += 1;
        if (stableReads >= 2) return;
      } else {
        stableReads = 0;
      }
      priorSize = size;
    }
    if (Date.now() > deadline) throw new Error(`export did not finish: ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function exportThroughMenu(
  page: Page,
  label: string,
  destination: string,
  timeoutMs = 300_000,
) {
  await setNextSavePath(page, destination);
  await page.evaluate(
    `(() => {
      const button = document.querySelector('[aria-label="Export"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Export control is unavailable");
      }
      button.focus();
      button.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true
      }));
      return true;
    })()`,
  );
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).some(
      item => item.textContent?.trim() === ${JSON.stringify(label)}
    )`,
    10_000,
  );
  await page.getByText(label, { exact: true }).click();
  await waitForArtifact(destination, timeoutMs);
}

function archiveText(entries: Record<string, Uint8Array>, name: string) {
  const entry = entries[name];
  if (!entry) throw new Error(`archive entry missing: ${name}`);
  return new TextDecoder().decode(entry);
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: Uint8Array.from(bytes) });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter((item): item is Extract<typeof item, { str: string }> => "str" in item)
          .map((item) => item.str)
          .join(" "),
      );
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

test("every document export writes a semantic artifact to the selected exact path", async ({
  tauriPage,
}) => {
  test.setTimeout(900_000);
  const run = Date.now().toString(36);
  const marker = `EXPORT ARTIFACT MARKER ${run}`;
  const output = mkdtempSync(join(tmpdir(), "oleafly-export-e2e-"));
  const png = readFileSync(
    new URL("../../src-tauri/resources/templates/blank/preview.png", import.meta.url),
  );
  const source = String.raw`\documentclass{article}
\usepackage{graphicx}
\title{${marker}}
\begin{document}
\maketitle
\section{Artifact evidence}
${marker} body evidence.
Standalone resource evidence.
\includegraphics[width=1cm]{assets/export-marker.png}
\end{document}
`;

  await createBlankProject(tauriPage, `E2E artifacts ${run}`);
  await writeProjectBinary(tauriPage, "assets/export-marker.png", png.toString("base64"));
  await persistSource(tauriPage, source);
  const compiled = await compileAndProbe(tauriPage, 180_000);
  expect(compiled.text).toContain(marker);

  const zipPath = join(output, `source-${run}.zip`);
  await exportThroughMenu(tauriPage, "Export source (.zip)", zipPath);
  const zipBytes = readFileSync(zipPath);
  expect(zipBytes.subarray(0, 2).toString("ascii")).toBe("PK");
  const zip = unzipSync(zipBytes);
  expect(Object.keys(zip)).toEqual(
    expect.arrayContaining(["main.tex", "assets/export-marker.png"]),
  );
  expect(archiveText(zip, "main.tex")).toBe(source);
  expect(Buffer.from(zip["assets/export-marker.png"])).toEqual(png);
  expect(Object.keys(zip).some((name) => name.startsWith(".git/"))).toBe(false);
  expect(Object.keys(zip).some((name) => name.startsWith(".oleafly/"))).toBe(false);

  const pdfPath = join(output, `document-${run}.pdf`);
  await exportThroughMenu(tauriPage, "Export as PDF", pdfPath);
  const exportedPdf = readFileSync(pdfPath);
  expect(exportedPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(await pdfText(exportedPdf)).toContain(marker);

  const docxPath = join(output, `document-${run}.docx`);
  await exportThroughMenu(tauriPage, "Export as Word (.docx)", docxPath);
  const docxBytes = readFileSync(docxPath);
  expect(docxBytes.subarray(0, 2).toString("ascii")).toBe("PK");
  const docx = unzipSync(docxBytes);
  expect(Object.keys(docx)).toContain("[Content_Types].xml");
  expect(archiveText(docx, "word/document.xml")).toContain(marker);

  const htmlPath = join(output, `document-${run}.html`);
  await exportThroughMenu(tauriPage, "Export as HTML (.html)", htmlPath);
  const html = readFileSync(htmlPath, "utf8");
  expect(html.toLowerCase()).toContain("<!doctype html");
  expect(html).toContain(marker);
  expect(html).toMatch(/data:image\/png;base64,/);

  const markdownPath = join(output, `document-${run}.md`);
  await exportThroughMenu(tauriPage, "Export as Markdown (.md)", markdownPath);
  const markdown = readFileSync(markdownPath, "utf8");
  expect(markdown).toContain(marker);
  expect(markdown).toContain("Artifact evidence");
  expect(markdown).toContain("assets/export-marker.png");

  const textPath = join(output, `document-${run}.txt`);
  await exportThroughMenu(tauriPage, "Export as Plain text (.txt)", textPath);
  const text = readFileSync(textPath, "utf8");
  expect(text).toContain(marker);
  expect(text).toMatch(/Standalone resource\s+evidence\./);
  expect(text).not.toContain("\0");

  const beamer = String.raw`\documentclass{beamer}
\title{${marker} PPTX}
\begin{document}
\begin{frame}{Slide artifact}
PowerPoint semantic marker ${run}
\end{frame}
\end{document}
`;
  await persistSource(tauriPage, beamer);
  const pptxPath = join(output, `slides-${run}.pptx`);
  await exportThroughMenu(tauriPage, "Export as PowerPoint (.pptx)", pptxPath);
  const pptx = unzipSync(readFileSync(pptxPath));
  expect(Object.keys(pptx)).toContain("[Content_Types].xml");
  const slideXml = Object.keys(pptx)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .map((name) => archiveText(pptx, name))
    .join("\n");
  expect(slideXml).toContain(`PowerPoint semantic marker ${run}`);

  const book = String.raw`\documentclass{book}
\title{${marker} EPUB}
\begin{document}
\maketitle
\chapter{Book artifact}
EPUB semantic marker ${run}
\end{document}
`;
  await persistSource(tauriPage, book);
  const epubPath = join(output, `book-${run}.epub`);
  await exportThroughMenu(tauriPage, "Export as EPUB (.epub)", epubPath);
  const epubBytes = readFileSync(epubPath);
  expect(epubBytes.subarray(0, 4).toString("hex")).toBe("504b0304");
  const firstCompressionMethod = epubBytes.readUInt16LE(8);
  const firstNameLength = epubBytes.readUInt16LE(26);
  const firstExtraLength = epubBytes.readUInt16LE(28);
  const firstName = epubBytes
    .subarray(30, 30 + firstNameLength)
    .toString("utf8");
  expect(firstName).toBe("mimetype");
  expect(firstCompressionMethod).toBe(0);
  const mimetypeStart = 30 + firstNameLength + firstExtraLength;
  expect(epubBytes.subarray(mimetypeStart, mimetypeStart + 20).toString("utf8")).toBe(
    "application/epub+zip",
  );
  const epub = unzipSync(epubBytes);
  expect(archiveText(epub, "mimetype")).toBe("application/epub+zip");
  expect(Object.keys(epub).some((name) => /content\.opf$/i.test(name))).toBe(true);
  expect(Object.keys(epub).some((name) => /(toc\.ncx|nav\.xhtml)$/i.test(name))).toBe(true);
  const epubContent = Object.entries(epub)
    .filter(([name]) => /\.(xhtml|html)$/i.test(name))
    .map(([, bytes]) => new TextDecoder().decode(bytes))
    .join("\n");
  expect(epubContent).toContain(`EPUB semantic marker ${run}`);

  expect(
    await tauriPage.evaluate<number>(
      `window.__e2eFileDialogState?.saveRequests ?? 0`,
    ),
  ).toBeGreaterThanOrEqual(8);
});

test("image project exports real vector PDF and nonblank raster PNG; SVG stays unsupported", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);
  const run = Date.now().toString(36);
  const marker = `IMAGE EXPORT ${run}`;
  const output = mkdtempSync(join(tmpdir(), "oleafly-image-export-e2e-"));
  await createProjectFromTemplate(tauriPage, "diagram", `E2E image artifacts ${run}`);
  await persistSource(
    tauriPage,
    String.raw`\documentclass[tikz,border=4pt]{standalone}
\begin{document}
\begin{tikzpicture}
\fill[blue] (0,0) rectangle (3,1);
\node[white] at (1.5,.5) {${marker}};
\end{tikzpicture}
\end{document}
`,
  );
  const probe = await compileAndProbe(tauriPage, 180_000);
  expect(probe.text).toContain(marker);

  const pdfPath = join(output, `vector-${run}.pdf`);
  await exportThroughMenu(tauriPage, "Export as PDF (vector image)", pdfPath);
  const pdf = readFileSync(pdfPath);
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(await pdfText(pdf)).toContain(marker);

  const pngPath = join(output, `raster-${run}.png`);
  await exportThroughMenu(tauriPage, "Export as PNG (raster image)", pngPath);
  const png = readFileSync(pngPath);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBeGreaterThan(0);
  expect(png.readUInt32BE(20)).toBeGreaterThan(0);
  const pixels = await tauriPage.evaluate<{ width: number; height: number; nonblank: number }>(
    `(async () => {
      const bytes = Uint8Array.from(
        atob(${JSON.stringify(png.toString("base64"))}),
        char => char.charCodeAt(0)
      );
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonblank = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          data[index + 3] > 0 &&
          (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245)
        ) nonblank += 1;
      }
      bitmap.close();
      return { width: canvas.width, height: canvas.height, nonblank };
    })()`,
  );
  expect(pixels.width).toBe(png.readUInt32BE(16));
  expect(pixels.height).toBe(png.readUInt32BE(20));
  expect(pixels.nonblank).toBeGreaterThan(100);

  await tauriPage.focus('[aria-label="Export"]');
  await tauriPage.press('[aria-label="Export"]', "Enter");
  await tauriPage.waitForFunction(
    `document.body.innerText.includes("Export as PNG (raster image)")`,
    10_000,
  );
  expect(await tauriPage.evaluate<boolean>(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).some(
      item => /SVG/i.test(item.textContent ?? "")
    )`,
  )).toBe(false);
});
