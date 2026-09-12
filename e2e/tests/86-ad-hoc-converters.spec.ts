import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { test, expect } from "../fixtures";
import { fillCommandPalette, pressGlobal, waitLong, type Page } from "../helpers";
import { scriptValue } from "../script-value";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

const FIXTURES = fileURLToPath(new URL("../../fixtures/conversion-matrix", import.meta.url));
const fixture = (name: string) => readFileSync(join(FIXTURES, name)).toString("base64");

const CONVERTER_IDS = [
  "image-to-latex",
  "pdf-to-latex",
  "visual-typst-editor",
  "arxiv-to-latex",
  "equation-to-latex",
  "excel-to-latex",
  "html-to-latex",
  "image-to-typst",
  "latex-to-html",
  "latex-to-image",
  "latex-to-markdown",
  "latex-to-typst",
  "latex-to-word",
  "markdown-to-latex",
  "markdown-to-typst",
  "mermaid-to-latex",
  "pdf-to-markdown",
  "pdf-to-typst",
  "table-to-latex",
  "typst-editor",
  "typst-to-latex",
  "word-to-latex",
] as const;

const REFERENCE_TOOL_IDS = [
  "literature-search",
  "arxiv-citation-generator",
  "bibliography-generator",
  "citation-generator",
  "citation-styles",
  "doi-to-bibtex",
  "isbn-to-bibtex",
  "pubmed-to-bibtex",
  "url-to-bibtex",
] as const;

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});

test.afterAll(async () => {
  await server?.close();
});

async function atTools(page: Page) {
  await page.evaluate(`(async () => {
    const files = (await import("/src/store/files.ts")).useFilesStore;
    const pdfImport = (await import("/src/store/import.ts")).useImportStore;
    const home = (await import("/src/store/home-view.ts")).useHomeViewStore;
    pdfImport.getState().close();
    if (files.getState().projectId) await files.getState().closeProject();
    home.getState().goTo("tools");
    return true;
  })()`);
  await expect(page.getByTestId("latex-tools-view")).toBeVisible({ timeout: 30_000 });
}

async function openCard(page: Page, id: string) {
  await atTools(page);
  await page.getByTestId(`latex-tool-card-${id}`).click();
}

async function attachFile(
  page: Page,
  selector: string,
  fileName: string,
  mediaType: string,
  base64: string,
) {
  await waitLong(
    page,
    `document.querySelector(${scriptValue(selector)}) instanceof HTMLInputElement`,
    30_000,
  );
  const attached = await page.evaluate<boolean>(`(() => {
    const input = document.querySelector(${scriptValue(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    const bytes = Uint8Array.from(atob(${scriptValue(base64)}), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${scriptValue(fileName)}, { type: ${scriptValue(mediaType)} }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  expect(attached, `file input ${selector} must be available`).toBe(true);
}

async function connectVision(page: Page) {
  const connected = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${scriptValue(server.url)}, "llava") ?? false`,
  );
  expect(connected, "__aiConnect devtools hook must be present").toBe(true);
}

test("the Tools page exposes all 22 converters and the palette opens one directly", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("open-latex-tools")).toBeVisible({ timeout: 30_000 });
  await tauriPage.getByTestId("open-latex-tools").click();
  await expect(tauriPage.getByTestId("latex-tools-view")).toBeVisible({ timeout: 30_000 });
  for (const id of CONVERTER_IDS) {
    await expect(tauriPage.getByTestId(`latex-tool-card-${id}`)).toBeVisible();
  }
  await expect(
    tauriPage.getByTestId("latex-tool-card-arxiv-to-latex").locator('[data-icon="arxiv"]'),
  ).toBeVisible();

  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await fillCommandPalette(tauriPage, "image to typst");
  await expect(tauriPage.getByText("Open Image to Typst", { exact: true })).toBeVisible();
  await tauriPage.keyboard.press("Enter");
  await expect(tauriPage.getByTestId("converter-tool-view")).toBeVisible();
  await expect(tauriPage.getByText("Image to Typst", { exact: true })).toBeVisible();
});

test("the Tools page exposes the complete reference toolkit and the palette opens it directly", async ({
  tauriPage,
}) => {
  await atTools(tauriPage);
  for (const id of REFERENCE_TOOL_IDS) {
    await expect(tauriPage.getByTestId(`latex-tool-card-${id}`)).toBeVisible();
  }
  await expect(
    tauriPage.getByTestId("latex-tool-card-arxiv-citation-generator").locator('[data-icon="arxiv"]'),
  ).toBeVisible();

  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await fillCommandPalette(tauriPage, "doi to bibtex");
  await expect(tauriPage.getByText("Open DOI to BibTeX", { exact: true })).toBeVisible();
  await tauriPage.keyboard.press("Enter");
  await expect(tauriPage.getByTestId("reference-tool-view")).toBeVisible();
  await expect(tauriPage.getByText("DOI to BibTeX", { exact: true })).toBeVisible();
});

test("reference tools format, validate, compare, and export locally without a project", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);

  await openCard(tauriPage, "citation-generator");
  await expect(tauriPage.getByTestId("formatted-citation-output")).toContainText("Vaswani", {
    timeout: 30_000,
  });
  await expect(tauriPage.getByText("Local formatter ready", { exact: true })).toBeVisible();

  const handle = tauriPage.getByRole("separator", { name: "Resize tool panels" });
  await expect(handle).toBeVisible();
  const firstPanel = tauriPage.locator('[data-panel-id="reference-citation-generator-start"]');
  const before = await firstPanel.getAttribute("data-panel-size");
  await handle.focus();
  await tauriPage.keyboard.press(Number.parseFloat(before ?? "50") >= 75 ? "ArrowLeft" : "ArrowRight");
  await expect.poll(() => firstPanel.getAttribute("data-panel-size")).not.toBe(before);

  await openCard(tauriPage, "bibliography-generator");
  await expect(tauriPage.getByText("2 references", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(tauriPage.getByText("2 valid entries", { exact: true })).toBeVisible();

  await openCard(tauriPage, "citation-styles");
  for (const style of ["APA 7", "MLA 9", "Chicago", "IEEE", "Harvard", "Vancouver", "AMA 11", "ACS"]) {
    await expect(tauriPage.getByText(style, { exact: true })).toBeVisible({ timeout: 30_000 });
  }

  await openCard(tauriPage, "url-to-bibtex");
  await tauriPage.getByTestId("reference-lookup-input").fill("https://example.org/research");
  await tauriPage.getByTestId("reference-lookup-button").click();
  await expect(tauriPage.getByLabel("Title")).toHaveValue("Untitled webpage");
  await expect(tauriPage.getByText(
    "Built a private, editable webpage entry locally. Add the page title and author below.",
    { exact: true },
  )).toBeVisible();
  await tauriPage.getByText("BibTeX", { exact: true }).click();
  await expect(tauriPage.getByTestId("reference-bibtex-output")).toContainText(
    "https://example.org/research",
  );
});

test("every text converter runs its built-in example through the real app", async ({
  tauriPage,
}) => {
  test.setTimeout(600_000);
  const cases = [
    ["html-to-latex", "\\documentclass"],
    ["latex-to-html", "<!DOCTYPE html>"],
    ["latex-to-markdown", "A compact example"],
    ["latex-to-typst", "#let horizontalrule"],
    ["markdown-to-latex", "\\documentclass"],
    ["markdown-to-typst", "#let horizontalrule"],
    ["typst-to-latex", "\\documentclass"],
    ["equation-to-latex", "e^{i\\pi}"],
    ["mermaid-to-latex", "\\begin{tikzpicture}"],
  ] as const;

  for (const [id, expected] of cases) {
    await openCard(tauriPage, id);
    await expect(tauriPage.getByTestId("converter-tool-view")).toBeVisible();
    await tauriPage.getByTestId("converter-run").click();
    await expect(tauriPage.getByTestId("converter-output")).toContainText(expected, {
      timeout: 90_000,
    });
  }

  await openCard(tauriPage, "latex-to-word");
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByText("converted.docx is ready", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
});

test("file, archive, PDF, and local-vision converters complete without a project", async ({
  tauriPage,
}) => {
  test.setTimeout(720_000);
  await connectVision(tauriPage);

  const image = fixture("decay.png");
  server.setReply("\\begin{equation}VISIONLATEX=x^2\\end{equation}");
  await openCard(tauriPage, "image-to-latex");
  await attachFile(tauriPage, '[data-testid="converter-file-input"]', "notes.png", "image/png", image);
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByTestId("converter-output")).toContainText("VISIONLATEX", {
    timeout: 90_000,
  });

  server.setReply("= VISIONTYPST");
  await openCard(tauriPage, "image-to-typst");
  await attachFile(tauriPage, '[data-testid="converter-file-input"]', "notes.png", "image/png", image);
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByTestId("converter-output")).toContainText("VISIONTYPST", {
    timeout: 90_000,
  });

  server.setReply("x^2 + y^2 = r^2");
  await openCard(tauriPage, "equation-to-latex");
  await tauriPage.getByTestId("converter-mode-file").click();
  await attachFile(tauriPage, '[data-testid="converter-file-input"]', "equation.png", "image/png", image);
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByTestId("converter-output")).toContainText("x^2 + y^2", {
    timeout: 90_000,
  });

  await openCard(tauriPage, "excel-to-latex");
  await attachFile(
    tauriPage,
    '[data-testid="converter-file-input"]',
    "results.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fixture("messy.xlsx"),
  );
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByTestId("converter-output")).toContainText("\\toprule", {
    timeout: 90_000,
  });

  await openCard(tauriPage, "word-to-latex");
  await attachFile(
    tauriPage,
    '[data-testid="converter-file-input"]',
    "paper.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    fixture("docx-omml.docx"),
  );
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByTestId("converter-output")).toContainText("\\documentclass", {
    timeout: 90_000,
  });

  await openCard(tauriPage, "pdf-to-markdown");
  await attachFile(
    tauriPage,
    '[data-testid="converter-file-input"]',
    "paper.pdf",
    "application/pdf",
    fixture("text-layer.pdf"),
  );
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByTestId("converter-output")).toContainText(
    "Convergence of Iterated Maps",
    { timeout: 120_000 },
  );

  server.setReply("= SCANNEDVISION");
  await openCard(tauriPage, "pdf-to-typst");
  await attachFile(
    tauriPage,
    '[data-testid="converter-file-input"]',
    "scan.pdf",
    "application/pdf",
    fixture("image-only.pdf"),
  );
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByTestId("converter-output")).toContainText("SCANNEDVISION", {
    timeout: 180_000,
  });

  const archivedSource = gzipSync(
    Buffer.from(
      "\\documentclass{article}\\begin{document}OFFLINEARCHIVE\\end{document}",
      "utf8",
    ),
  ).toString("base64");
  await openCard(tauriPage, "arxiv-to-latex");
  await tauriPage.getByTestId("converter-mode-file").click();
  await attachFile(
    tauriPage,
    '[data-testid="converter-file-input"]',
    "paper.tex.gz",
    "application/gzip",
    archivedSource,
  );
  await tauriPage.getByTestId("converter-run").click();
  await expect(tauriPage.getByTestId("converter-output")).toContainText("OFFLINEARCHIVE", {
    timeout: 90_000,
  });
  await expect(
    tauriPage.getByTestId("converter-output").locator(".cm-content"),
  ).toHaveAttribute("contenteditable", "false");
  await expect(
    tauriPage.getByTestId("converter-output").locator(".cm-line span").first(),
  ).toBeVisible();
});

test("the five specialized converter cards open and run their production workflows", async ({
  tauriPage,
}) => {
  test.setTimeout(600_000);

  await openCard(tauriPage, "pdf-to-latex");
  await expect(tauriPage.getByTestId("pdf-dropzone")).toBeVisible();
  await attachFile(
    tauriPage,
    '[data-testid="pdf-dropzone"] input[type="file"]',
    "paper.pdf",
    "application/pdf",
    fixture("text-layer.pdf"),
  );
  await expect(tauriPage.getByTestId("import-stats")).toContainText("1 pages", {
    timeout: 120_000,
  });
  await tauriPage.getByTestId("import-view-source").click();
  await expect(tauriPage.getByTestId("import-source")).toBeVisible();
  const importedSource = await tauriPage.evaluate<string>(
    `import("/src/store/import.ts").then(({ useImportStore }) => useImportStore.getState().result?.tex ?? "")`,
  );
  expect(importedSource).toContain("Convergence of Iterated Maps");

  await openCard(tauriPage, "latex-to-image");
  await expect(tauriPage.getByTestId("equation-tool-view")).toBeVisible();
  await expect(tauriPage.getByText("Rendered", { exact: true })).toBeVisible();
  await expect(tauriPage.getByTestId("equation-latex-field")).toContainText("\\");

  await openCard(tauriPage, "table-to-latex");
  await expect(tauriPage.getByTestId("table-tool-view")).toBeVisible();
  await expect(tauriPage.locator("pre")).toContainText("\\toprule");
  await tauriPage.fill('[aria-label="Row 2 column 1"]', "Runtime verified");
  await expect(tauriPage.locator("pre")).toContainText("Runtime verified");

  await openCard(tauriPage, "visual-typst-editor");
  await waitLong(tauriPage, `!!document.querySelector('[data-tour="project-editor"] .cm-content')`, 90_000);
  let state = await tauriPage.evaluate<{ engine: string; viewMode: string }>(`Promise.all([
    import("/src/store/files.ts"),
    import("/src/store/settings.ts")
  ]).then(([files, settings]) => ({
    engine: files.useFilesStore.getState().engine.id,
    viewMode: settings.useSettingsStore.getState().viewMode,
  }))`);
  expect(state).toEqual({ engine: "typst", viewMode: "split" });

  await openCard(tauriPage, "typst-editor");
  await waitLong(tauriPage, `!!document.querySelector('[data-tour="project-editor"] .cm-content')`, 90_000);
  state = await tauriPage.evaluate<{ engine: string; viewMode: string }>(`Promise.all([
    import("/src/store/files.ts"),
    import("/src/store/settings.ts")
  ]).then(([files, settings]) => ({
    engine: files.useFilesStore.getState().engine.id,
    viewMode: settings.useSettingsStore.getState().viewMode,
  }))`);
  expect(state).toEqual({ engine: "typst", viewMode: "editor" });
});
