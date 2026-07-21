import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import { expectCompiledPdfContains, waitEditorContains, waitLong, type Page } from "../helpers";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, "..", "fixture-files", name)).toString("base64");

async function importFixture(page: Page, name: string) {
  await expect(
    page.locator('[data-testid="library"][data-projects-loaded="true"]') as Parameters<
      typeof expect
    >[0],
  ).toBeVisible({ timeout: 30_000 });
  const ok = await page.evaluate<boolean>(
    `typeof window.__importFile === "function" ? (window.__importFile(${JSON.stringify(
      name,
    )}, ${JSON.stringify(fixture(name))}), true) : false`,
  );
  expect(ok, "__importFile devtools hook must be present").toBe(true);
}

test("PDF converts locally in the converter view", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await importFixture(tauriPage, "tiny.pdf");
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeVisible({
    timeout: 20_000,
  });
  await waitLong(
    tauriPage,
    `(document.querySelector('[data-testid="import-source"]')?.textContent ?? "").includes("documentclass")`,
    30_000,
  );
  const source = await tauriPage.evaluate<string>(
    `document.querySelector('[data-testid="import-source"]')?.textContent ?? ""`,
  );
  expect(source).toContain("\\documentclass[11pt]{article}");
  expect(source).toContain("Deterministic import fixture body text");
  expect(source).toContain("\\title{Fixture Title}");
  expect(source).toContain("\\section{Introduction}");
  expect(source).toContain("\\includegraphics[width=\\linewidth]{assets/figure_p1_1.png}");
  const stats = await tauriPage.evaluate<string>(
    `document.querySelector('[data-testid="import-stats"]')?.textContent ?? ""`,
  );
  expect(stats).toContain("1 pages");
  expect(stats).toContain("1 figures");
  await expect(tauriPage.locator('[data-testid="import-figure-figure_p1_1.png"]')).toBeVisible();
});

test("created project compiles and round-trips the source text", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await importFixture(tauriPage, "tiny.pdf");
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeVisible({
    timeout: 20_000,
  });
  await waitLong(
    tauriPage,
    `(document.querySelector('[data-testid="import-source"]')?.textContent ?? "").includes("documentclass")`,
    30_000,
  );
  await tauriPage.click('[data-testid="import-create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expectCompiledPdfContains(tauriPage, "Fixture Title", 120_000);
  await expectCompiledPdfContains(tauriPage, "Deterministic import fixture body text", 30_000);
});

test("DOCX imports through pandoc into a project", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]') as Parameters<
      typeof expect
    >[0],
  ).toBeVisible({ timeout: 30_000 });
  // the bridge's evaluate does not await promises, so stash the result and poll
  await tauriPage.evaluate(
    `(window.__pandocProbe = null, window.__hasPandoc().then((v) => { window.__pandocProbe = v; }), true)`,
  );
  await waitLong(tauriPage, `typeof window.__pandocProbe === "boolean"`, 15_000);
  const pandoc = await tauriPage.evaluate<boolean>(`window.__pandocProbe === true`);
  test.skip(!pandoc, "pandoc is not installed in this environment");
  await importFixture(tauriPage, "tiny.docx");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 60_000 });
  await waitEditorContains(tauriPage, "Docx fixture paragraph", 30_000);
});
