import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { test, expect } from "../fixtures";
import { expectCompiledPdfContains } from "../helpers";
import {
  expectFolderUnchanged,
  expectMainDocument,
  expectNoOleaflyFootprint,
  folderFixtures,
  goToLibrary,
  injectOpenRequest,
  openFolder,
  openedState,
  showSplitView,
  snapshotFolder,
  waitForCompileSuccess,
  waitForPdfPage,
} from "../open-folder";

const fixtures = folderFixtures("root-main");

test.afterAll(() => fixtures.remove());

const ARTICLE = String.raw`\documentclass{article}
\begin{document}
Opened in place from the root folder.
\end{document}
`;

test("a folder with a root main.tex opens in the editor, compiles and stays untouched", async ({ tauriPage: page }) => {
  const folder = fixtures.make("Root Paper", {
    "main.tex": ARTICLE,
    "notes.txt": "Plain notes.\n",
    "figures/readme.txt": "Figures go here.\n",
  });
  const before = snapshotFolder(folder);

  const opened = await openFolder(page, folder);
  expect(opened.projectId).toMatch(/^linked-[0-9a-f]{32}$/);
  expect(opened.projectName).toBe("Root Paper");
  expect(opened.mainDoc).toBe("main.tex");
  expect(opened.engine).toBe("latex");
  await expectMainDocument(page, "main.tex");
  await expect(page.locator('[data-testid="main-document-picker"]')).toHaveCount(0);

  await showSplitView(page);
  await waitForCompileSuccess(page);
  await waitForPdfPage(page);
  await expectCompiledPdfContains(page, "Opened in place from the root folder.");

  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});

async function projectCount(page: Parameters<typeof openFolder>[0]): Promise<number> {
  return page.evaluate<number>(
    `import("/src/store/files.ts").then(({ useFilesStore }) => useFilesStore.getState().refreshProjects().then(() => useFilesStore.getState().projects.length))`,
  );
}

test("a folder that holds too much is refused with Choose a subfolder", async ({ tauriPage: page }) => {
  await expect(page.locator('[data-testid="library"][data-projects-loaded="true"]')).toBeVisible({ timeout: 60_000 });
  const projects = await projectCount(page);
  const notice = page.locator('[data-testid="open-folder-notice"]');

  for (const broad of [realpathSync(tmpdir()), realpathSync(homedir())]) {
    await injectOpenRequest(page, broad);
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText("holds too much to open as one project. Choose a folder inside it.");
    expect(await page.evaluate<string[]>(
      `Array.from(document.querySelectorAll('[data-testid="open-folder-notice"] button')).map((button) => button.textContent?.trim() ?? "")`,
    )).toContain("Choose a subfolder");
    expect((await openedState(page)).projectId).toBeNull();
    await page.click('[data-testid="open-folder-notice"] button[aria-label="Dismiss"]');
    await expect(notice).toHaveCount(0);
  }
  expect(await projectCount(page)).toBe(projects);

  const folder = fixtures.make("Open Before Refusal", { "main.tex": ARTICLE });
  const before = snapshotFolder(folder);
  const opened = await openFolder(page, folder);
  await injectOpenRequest(page, realpathSync(homedir()));
  await expect.poll(async () => page.evaluate<string[]>(`(() => {
    const toast = Array.from(document.querySelectorAll('[data-sonner-toast]')).find((node) => node.textContent?.includes("holds too much to open as one project"));
    return toast ? Array.from(toast.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? "") : [];
  })()`), { timeout: 30_000 }).toContain("Choose a subfolder");
  expect((await openedState(page)).projectId).toBe(opened.projectId);
  expect(await projectCount(page)).toBe(projects + 1);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);

  await goToLibrary(page);
  expectFolderUnchanged(folder, before);
  expectNoOleaflyFootprint(folder);
});
