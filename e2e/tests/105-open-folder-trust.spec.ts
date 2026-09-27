import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import { openRailTab } from "../helpers";
import {
  ageFolder,
  answerNextConfirmation,
  expectFolderUnchanged,
  expectNoOleaflyFootprint,
  folderFixtures,
  git,
  goToLibrary,
  openFolder,
  showSplitView,
  snapshotFolder,
  trustFromBanner,
  waitForCompileSuccess,
} from "../open-folder";

const fixtures = folderFixtures("trust");

test.afterAll(() => fixtures.remove());

const ARTICLE = "\\documentclass{article}\n\\begin{document}\nTrusted only when asked.\n\\end{document}\n";

async function sourceControlText(page: Parameters<typeof openFolder>[0]): Promise<string> {
  return page.evaluate<string>(
    `(document.querySelector('[data-testid="source-control-restricted"]')?.closest('.bg-sidebar') ?? document.querySelector('[data-testid="source-control-actions"]')?.parentElement)?.textContent ?? ""`,
  );
}

test("a Git repository gets Source Control only after the folder is trusted", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Git Paper", {
    "main.tex": ARTICLE,
    "sections/intro.tex": "Introduction.\n",
  });
  ageFolder(folder);
  git(folder, "init", "--quiet");
  git(folder, "add", "main.tex", "sections/intro.tex");
  git(folder, "commit", "--quiet", "-m", "Fixture commit for trust");
  git(folder, "status", "--porcelain");
  const repository = {
    config: readFileSync(join(folder, ".git", "config"), "utf8"),
    head: readFileSync(join(folder, ".git", "HEAD"), "utf8"),
    main: readFileSync(join(folder, ".git", "refs", "heads", "main"), "utf8"),
  };
  const before = snapshotFolder(folder);

  await openFolder(page, folder);
  const banner = page.locator('[data-testid="folder-trust-banner"]');
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).toContainText("Oleafly limited some features in this folder.");
  await openRailTab(page, "Source Control");
  const restricted = page.locator('[data-testid="source-control-restricted"]');
  await expect(restricted).toBeVisible({ timeout: 20_000 });
  await expect(restricted).toContainText("Trust this folder to use Source Control.");
  await expect(page.locator('[data-testid="source-control-actions"]')).toHaveCount(0);

  await showSplitView(page);
  await waitForCompileSuccess(page);
  expectFolderUnchanged(folder, before);

  await answerNextConfirmation(page, true);
  await page.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('[data-testid="source-control-restricted"] button')).find((candidate) => candidate.textContent?.trim() === "Trust this folder");
    button.click();
    return true;
  })()`);
  await expect(restricted).toHaveCount(0, { timeout: 20_000 });
  await expect(banner).toHaveCount(0);
  await expect(page.locator('[data-testid="source-control-actions"]')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => sourceControlText(page), { timeout: 30_000 }).toContain("Fixture commit for trust");

  await goToLibrary(page);
  expectFolderUnchanged(folder, before, [".git", ".git/index"]);
  expect(readFileSync(join(folder, ".git", "config"), "utf8")).toBe(repository.config);
  expect(readFileSync(join(folder, ".git", "HEAD"), "utf8")).toBe(repository.head);
  expect(readFileSync(join(folder, ".git", "refs", "heads", "main"), "utf8")).toBe(repository.main);
  expect(git(folder, "status", "--porcelain")).toBe("");
});

test("a trusted plain folder still has no Git repository after opening and compiling", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Plain Trusted", { "main.tex": ARTICLE });
  const before = snapshotFolder(folder);

  await openFolder(page, folder);
  await trustFromBanner(page);

  await openRailTab(page, "Source Control");
  await expect.poll(async () => page.evaluate<string>(
    `Array.from(document.querySelectorAll('.bg-sidebar p')).map((node) => node.textContent?.trim()).join("\\n")`,
  ), { timeout: 30_000 }).toContain("Source Control is not initialized");
  await showSplitView(page);
  await waitForCompileSuccess(page);

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});
