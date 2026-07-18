import { test, expect } from "../fixtures";
import { openGallery, pressGlobal, typeInEditorAfter, type Page } from "../helpers";

// Local git history with NO GitHub token: compile auto-commits, so we compile
// twice and restore each snapshot by position (both auto-commit messages are
// identical). Complements 29, which uses the token-gated custom-message panel.

const RUN = Date.now().toString(36);
const NAME = `GitHist ${RUN}`;
const BASE = `gbase${RUN}`;
const EDIT = `gedit${RUN}`;

const restoreCount = `Array.from(document.querySelectorAll('button')).filter((b) => (b.getAttribute('title') || '').startsWith('Restore')).length`;

async function openHistory(page: Page) {
  await pressGlobal(page, "k", { meta: true });
  await page.fill("[cmdk-input]", "history");
  await page.press("[cmdk-input]", "Enter");
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'History')`,
    10_000,
  );
}

async function restoreByIndex(page: Page, index: number) {
  const clicked = await page.evaluate<boolean>(
    `(() => {
      const btns = Array.from(document.querySelectorAll('button'))
        .filter((b) => (b.getAttribute('title') || '').startsWith('Restore'));
      const btn = btns[${index}];
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
  if (!clicked) throw new Error(`no Restore button at index ${index}`);
  await page.getByText("Overwrite all").click();
  await page.waitForFunction(
    `!Array.from(document.querySelectorAll('h2')).some((h) => h.textContent.trim() === 'History')`,
    15_000,
  );
}

async function compileOk(page: Page) {
  await page.click('[data-testid="compile-button"]');
  await expect(page.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
}

// Leaves the History modal OPEN.
async function waitForRestoreButtons(page: Page, atLeast: number) {
  await expect
    .poll(
      async () => {
        await openHistory(page);
        const n = await page.evaluate<number>(restoreCount);
        if (n < atLeast) await page.press("body", "Escape");
        return n;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(atLeast);
}

// The compile auto-commit is fire-and-forget: it can land after the next edit
// reaches disk, where `git add -A` folds both edits into one commit. Poll via a
// devtools hook, not the History modal, since opening a modal between the two
// edits swallows the second edit.
async function waitForCommitsLanded(page: Page, atLeast: number) {
  await expect
    .poll(
      () => page.evaluate<number>(`window.__gitCommitCount?.() ?? Promise.resolve(0)`),
      { timeout: 30_000 },
    )
    .toBeGreaterThanOrEqual(atLeast);
}

test("auto-commit history: restore rolls the document back and forward (no token)", async ({
  tauriPage,
}) => {
  test.setTimeout(300_000);

  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank"]');
  await tauriPage.fill("#new-project-name", NAME);
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await typeInEditorAfter(tauriPage, "here.", ` ${BASE}`);
  await compileOk(tauriPage);
  await waitForCommitsLanded(tauriPage, 1);

  await typeInEditorAfter(tauriPage, BASE, ` ${EDIT}`);
  await compileOk(tauriPage);
  await waitForCommitsLanded(tauriPage, 2);
  await waitForRestoreButtons(tauriPage, 2);

  // Restore the oldest (last button); the editor reloads from the restored tree.
  const n = await tauriPage.evaluate<number>(restoreCount);
  await restoreByIndex(tauriPage, n - 1);
  await tauriPage.waitForFunction(
    `(() => {
      const t = document.querySelector('.cm-content')?.textContent || '';
      return t.includes(${JSON.stringify(BASE)}) && !t.includes(${JSON.stringify(EDIT)});
    })()`,
    20_000,
  );

  // Roll forward to the newest commit.
  await openHistory(tauriPage);
  await restoreByIndex(tauriPage, 0);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-content')?.textContent || '').includes(${JSON.stringify(EDIT)})`,
    20_000,
  );
});
