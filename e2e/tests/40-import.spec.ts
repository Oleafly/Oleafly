import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { test, expect } from "../fixtures";
import {
  compileAndProbe,
  setNextSavePath,
  waitEditorContains,
  waitLong,
  type Page,
} from "../helpers";

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
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeHidden({
    timeout: 30_000,
  });
  await expect(
    tauriPage.locator('[data-tour="project-editor"] .cm-content'),
  ).toBeVisible({ timeout: 30_000 });
  const probe = await compileAndProbe(tauriPage, 150_000);
  expect(probe.text).toContain("Fixture Title");
  expect(probe.text.replaceAll("ﬁ", "fi")).toContain(
    "Deterministic import fixture body text",
  );
});

test("DOCX imports through pandoc into a project", async ({ tauriPage }) => {
  test.setTimeout(600_000);
  await importFixture(tauriPage, "tiny.docx");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 60_000 });
  await waitEditorContains(tauriPage, "Docx fixture paragraph", 30_000);
});

async function waitForDownload(path: string) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (existsSync(path) && statSync(path).size > 0) return;
    if (Date.now() > deadline) throw new Error(`download did not finish: ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test("converter downloads exact .tex, ZIP, and extracted PNG artifacts", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  const output = mkdtempSync(join(tmpdir(), "oleafly-converter-e2e-"));
  await importFixture(tauriPage, "tiny.pdf");
  await waitLong(
    tauriPage,
    `(document.querySelector('[data-testid="import-source"]')?.textContent ?? "")
      .includes("Deterministic import fixture body text")`,
    30_000,
  );
  const texPath = join(output, "converted.tex");
  await setNextSavePath(tauriPage, texPath);
  await tauriPage.getByText(".tex", { exact: true }).click();
  await waitForDownload(texPath);
  const tex = readFileSync(texPath, "utf8");
  expect(tex).toContain("\\documentclass[11pt]{article}");
  expect(tex).toContain("Deterministic import fixture body text");
  expect(tex).toContain("\\includegraphics[width=\\linewidth]{assets/figure_p1_1.png}");

  const zipPath = join(output, "converted.zip");
  await setNextSavePath(tauriPage, zipPath);
  await tauriPage.getByText(".zip", { exact: true }).click();
  await waitForDownload(zipPath);
  const zipBytes = readFileSync(zipPath);
  expect(zipBytes.subarray(0, 2).toString("ascii")).toBe("PK");
  const archive = unzipSync(zipBytes);
  expect(new TextDecoder().decode(archive["main.tex"])).toBe(tex);
  expect(archive["assets/figure_p1_1.png"]).toBeDefined();

  const figurePath = join(output, "figure_p1_1.png");
  await setNextSavePath(tauriPage, figurePath);
  await tauriPage.click('[data-testid="import-figure-figure_p1_1.png"]');
  await waitForDownload(figurePath);
  const figure = readFileSync(figurePath);
  expect(figure.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(figure.readUInt32BE(16)).toBeGreaterThan(0);
  expect(figure.readUInt32BE(20)).toBeGreaterThan(0);
  expect(Buffer.from(archive["assets/figure_p1_1.png"])).toEqual(figure);
  expect(
    await tauriPage.evaluate<number>(
      `window.__e2eFileDialogState?.saveRequests ?? 0`,
    ),
  ).toBeGreaterThanOrEqual(3);
});
