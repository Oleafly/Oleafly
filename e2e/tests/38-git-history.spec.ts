import { test, expect } from "../fixtures";
import {
  compileAndWait,
  createBlankProject,
  fillCommandPalette,
  openRailTab,
  pressGlobal,
  typeInEditorAfter,
  type Page,
} from "../helpers";

// Local Git history needs neither a GitHub token nor a remote. Every history
// entry in this spec is created through an explicit Source Control action.

const RUN = Date.now().toString(36);
const NAME = `GitHist ${RUN}`;
const BASE = `gbase${RUN}`;
const EDIT = `gedit${RUN}`;
const BASE_COMMIT = `e2e git history base ${RUN}`;
const EDIT_COMMIT = `e2e git history edit ${RUN}`;

async function initializeRepository(page: Page) {
  await openRailTab(page, "Source Control");
  await page.waitForFunction(
    `!!document.querySelector('[data-testid="source-control-actions"]') ||
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent.trim() === "Initialize Repository",
      )`,
    15_000,
  );
  const needsInitialize = await page.evaluate<boolean>(
    `!document.querySelector('[data-testid="source-control-actions"]')`,
  );
  if (needsInitialize) {
    await page.getByText("Initialize Repository", { exact: true }).click();
  }
  await expect(page.getByTestId("source-control-actions")).toBeVisible({ timeout: 15_000 });
}

async function commitAll(page: Page, message: string) {
  await openRailTab(page, "Source Control");
  let stagedVisible = false;
  for (let i = 0; i < 25 && !stagedVisible; i++) {
    await page.evaluate(
      `(() => {
        const b = document.querySelector('[aria-label="Stage all"]');
        if (b) b.click();
        return 1;
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    stagedVisible = await page.evaluate<boolean>(
      `!!document.querySelector('[aria-label="Unstage all"]')`,
    );
    if (!stagedVisible) await page.click('[aria-label="Refresh"]');
  }
  if (!stagedVisible) throw new Error("commitAll: staging never became visible");
  await expect(page.locator('[data-testid="commit-title"]')).toBeVisible({ timeout: 10_000 });
  await page.fill('[data-testid="commit-title"]', message);
  const commit = page.locator('[data-testid="commit-button"]');
  await expect(commit).toBeEnabled({ timeout: 5_000 });
  await commit.click();
  try {
    await page.waitForFunction(
      `(document.querySelector('[data-testid="source-control-status"]')?.textContent ?? "").includes(${JSON.stringify(`Committed: "${message}"`)})`,
      15_000,
    );
  } catch (error) {
    const snapshot = await page.evaluate<string>(
      `(() => {
        const title = document.querySelector('[data-testid="commit-title"]');
        const button = document.querySelector('[data-testid="commit-button"]');
        const status = document.querySelector('[data-testid="source-control-status"]');
        const actions = document.querySelector('[data-testid="source-control-actions"]');
        return JSON.stringify({
          titleValue: title ? title.value : null,
          buttonDisabled: button ? button.disabled : null,
          buttonText: button ? button.textContent : null,
          status: status ? status.textContent : null,
          actions: actions ? actions.innerText.slice(0, 600) : null,
        });
      })()`,
    );
    throw new Error(`commit notice never appeared: ${snapshot}`, { cause: error });
  }
}

async function openHistory(page: Page) {
  await pressGlobal(page, "k", { meta: true });
  await fillCommandPalette(page, "history");
  await page.press("[cmdk-input]", "Enter");
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Versioning')`,
    10_000,
  );
  await page.waitForFunction(
    `document.querySelector('[data-testid="versioning-tab-git"]')?.getAttribute('aria-selected') === 'true'`,
    10_000,
  );
}

async function restoreCommit(page: Page, message: string) {
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('[data-testid="history-commit-title"]'))
      .some((d) => d.textContent.trim() === ${JSON.stringify(message)})`,
    15_000,
  );
  const clicked = await page.evaluate<boolean>(
    `(() => {
      const title = Array.from(document.querySelectorAll('[data-testid="history-commit-title"]'))
        .find((d) => d.textContent.trim() === ${JSON.stringify(message)});
      const row = title && title.closest('[data-testid="history-commit"]');
      const btn = row && Array.from(row.querySelectorAll('button'))
        .find((b) => (b.getAttribute('title') || '').startsWith('Restore'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
  if (!clicked) throw new Error(`no Restore button for commit "${message}"`);
  await page.getByText("Overwrite all").click();
  await page.waitForFunction(
    `!Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Versioning')`,
    15_000,
  );
}

test("explicit local Git history restores the document backward and forward", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);

  await createBlankProject(tauriPage, NAME);
  await initializeRepository(tauriPage);

  await typeInEditorAfter(tauriPage, "here.", ` ${BASE}`);
  await compileAndWait(tauriPage);
  await commitAll(tauriPage, BASE_COMMIT);

  await typeInEditorAfter(tauriPage, BASE, ` ${EDIT}`);
  await compileAndWait(tauriPage);
  await commitAll(tauriPage, EDIT_COMMIT);

  await openHistory(tauriPage);
  await expect(tauriPage.getByText(BASE_COMMIT, { exact: true })).toBeVisible();
  await expect(tauriPage.getByText(EDIT_COMMIT, { exact: true })).toBeVisible();
  await restoreCommit(tauriPage, BASE_COMMIT);
  await tauriPage.waitForFunction(
    `(() => {
      const t = document.querySelector('.cm-content')?.textContent || '';
      return t.includes(${JSON.stringify(BASE)}) && !t.includes(${JSON.stringify(EDIT)});
    })()`,
    20_000,
  );

  // Roll forward to the newest commit.
  await openHistory(tauriPage);
  await restoreCommit(tauriPage, EDIT_COMMIT);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-content')?.textContent || '').includes(${JSON.stringify(EDIT)})`,
    20_000,
  );
});
