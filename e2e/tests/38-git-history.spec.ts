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
  const initialize = page.getByText("Initialize Repository", { exact: true });
  await expect(initialize).toBeVisible({ timeout: 10_000 });
  await initialize.click();
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
  await page.evaluate(
    `(() => {
      const t = document.querySelector('[placeholder="Commit message (required)…"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(t, ${JSON.stringify(message)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`,
  );
  const commit = page.getByText("Commit", { exact: true });
  await expect(commit).toBeEnabled({ timeout: 5_000 });
  await commit.click();
  await page.waitForFunction(
    `document.body.innerText.includes(${JSON.stringify(`Committed: "${message}"`)})`,
    15_000,
  );
}

async function openHistory(page: Page) {
  await pressGlobal(page, "k", { meta: true });
  await fillCommandPalette(page, "history");
  await page.press("[cmdk-input]", "Enter");
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Version History')`,
    10_000,
  );
}

async function restoreCommit(page: Page, message: string) {
  const clicked = await page.evaluate<boolean>(
    `(() => {
      const rows = Array.from(document.querySelectorAll('div.truncate'))
        .filter((d) => d.textContent.trim() === ${JSON.stringify(message)});
      const row = rows[0]?.closest('div.flex');
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
    `!Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'Version History')`,
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
