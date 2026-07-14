import { test, expect } from "../fixtures";
import { openGallery, pressGlobal, typeInEditorAfter, type Page } from "../helpers";

// Local git history with NO GitHub token: a successful compile auto-commits, so
// we compile twice (base, then an edit), then restore each snapshot from the
// History modal and verify the document rolls back and forward on disk and in
// the editor. Uses a FRESH project so its history holds only these two commits
// (the auto-commit messages are identical, so we restore by position).
// Complements 29, whose custom-message commits go through the token-gated panel.

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

/** Restore the commit at `index` (0 = newest) via its Restore button, confirm. */
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
  await page.click('[aria-label="Recompile"]');
  await expect(page.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
}

/** Poll the History modal until it shows at least `atLeast` restorable commits.
 *  Leaves History OPEN once the condition is met. */
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

/** Wait until at least `atLeast` auto-commits have actually landed in the current
 *  project. The compile auto-commit is fire-and-forget (kicked off after the
 *  compile status flips to ok), so it can run late; if the next edit is saved to
 *  disk before it runs, `git add -A` folds both edits into a single commit and one
 *  snapshot is lost. This reads the count via the __gitCommitCount devtools hook
 *  (no UI) so it does NOT open any modal between the two editor edits, which would
 *  swallow the second edit. */
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

  // Fresh project so History holds only our two auto-commits.
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank"]');
  await tauriPage.fill("#new-project-name", NAME);
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Two successful compiles => two immediate auto-commits. Keep the edits/
  // compiles free of any modal interaction so each edit persists cleanly.
  await typeInEditorAfter(tauriPage, "here.", ` ${BASE}`);
  await compileOk(tauriPage);
  // Wait for commit 1 to actually land before editing again. The auto-commit is
  // fire-and-forget after the compile status flips to ok, so a fixed settle
  // races it: if the EDIT reaches disk first, `git add -A` folds both edits into
  // one commit and a snapshot is lost.
  await waitForCommitsLanded(tauriPage, 1);

  await typeInEditorAfter(tauriPage, BASE, ` ${EDIT}`);
  await compileOk(tauriPage);
  // Wait for the second auto-commit to land (fire-and-forget), then open History.
  await waitForCommitsLanded(tauriPage, 2);
  await waitForRestoreButtons(tauriPage, 2);

  // History is open with >= 2 commits. Restore the OLDEST (last button): the edit
  // marker must vanish (restore reloads every buffer from the restored tree).
  const n = await tauriPage.evaluate<number>(restoreCount);
  await restoreByIndex(tauriPage, n - 1);
  await tauriPage.waitForFunction(
    `(() => {
      const t = document.querySelector('.cm-content')?.textContent || '';
      return t.includes(${JSON.stringify(BASE)}) && !t.includes(${JSON.stringify(EDIT)});
    })()`,
    20_000,
  );

  // Roll forward: restore the NEWEST commit -> the edit marker returns.
  await openHistory(tauriPage);
  await restoreByIndex(tauriPage, 0);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-content')?.textContent || '').includes(${JSON.stringify(EDIT)})`,
    20_000,
  );
});
