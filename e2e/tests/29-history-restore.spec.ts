import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillCommandPalette,
  openRailTab,
  pressGlobal,
  typeInEditorAfter,
} from "../helpers";

// Source Control initialization and commits are local operations. No GitHub
// account or remote is needed for this restore flow.

// Unique per run so re-runs against a live app never collide.
const RUN = Date.now().toString(36);
const BASE = `histbase${RUN}`;
const EDIT = `histedit${RUN}`;

async function initializeRepository(page: import("../helpers").Page) {
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

async function commitAll(page: import("../helpers").Page, message: string) {
  await openRailTab(page, "Source Control");
  // Stage all is hover-revealed (opacity-0): the plugin's own click waits for
  // visibility and never fires, so click the real button via the DOM. Keep
  // refreshing + staging until the STAGED section is actually visible.
  let stagedVisible = false;
  for (let i = 0; i < 25 && !stagedVisible; i++) {
    await page.evaluate(
      `(() => {
        const b = document.querySelector('[aria-label="Stage all"]');
        if (b) b.click();
        return 1;
      })()`,
    );
    await new Promise((r) => setTimeout(r, 800));
    stagedVisible = await page.evaluate<boolean>(
      `!!document.querySelector('[aria-label="Unstage all"]')`,
    );
    if (!stagedVisible) await page.click('[aria-label="Refresh"]');
  }
  if (!stagedVisible) throw new Error("commitAll: staging never became visible");
  await expect(page.locator('[data-testid="commit-title"]')).toBeVisible({ timeout: 10_000 });
  await page.fill('[data-testid="commit-title"]', message);
  const commit = page.getByText("Commit", { exact: true });
  await expect(commit).toBeEnabled({ timeout: 5_000 });
  await commit.click();
  // Assert the completed git operation itself. A later autosave may
  // legitimately dirty the working tree again after this commit succeeds.
  await page.waitForFunction(
    `document.body.innerText.includes(${JSON.stringify(`Committed: "${message}"`)})`,
    15_000,
  );
}

async function openHistory(page: import("../helpers").Page) {
  await pressGlobal(page, "k", { meta: true });
  await fillCommandPalette(page, "history");
  await page.press("[cmdk-input]", "Enter");
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some(h => h.textContent.trim() === 'Versioning')`,
    10_000,
  );
  await page.waitForFunction(
    `document.querySelector('[data-testid="versioning-tab-git"]')?.getAttribute('aria-selected') === 'true'`,
    10_000,
  );
}

async function restoreCommit(page: import("../helpers").Page, message: string) {
  await expect(page.getByText(message, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  const clicked = await page.evaluate<boolean>(
    `(() => {
      const titles = Array.from(document.querySelectorAll('[data-testid="history-commit-title"]'))
        .filter((d) => d.textContent.trim() === ${JSON.stringify(message)});
      if (!titles.length) return false;
      const row = titles[0].closest('[data-testid="history-commit"]');
      const btn = row && Array.from(row.querySelectorAll('button'))
        .find((b) => (b.getAttribute('title') || '').startsWith('Restore'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
  if (!clicked) throw new Error(`no Restore button for commit "${message}"`);
  await page.getByText("Overwrite all").click();
  // The modal closes itself once the restore lands.
  await page.waitForFunction(
    `!Array.from(document.querySelectorAll('h2')).some(h => h.textContent.trim() === 'Versioning')`,
    15_000,
  );
}

test("commit twice, restore the first commit, then roll forward again", async ({ tauriPage }) => {
  test.setTimeout(300_000);
  await createBlankProject(tauriPage, `Git restore ${RUN}`);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await initializeRepository(tauriPage);

  await typeInEditorAfter(tauriPage, "here.", ` ${BASE}`);
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
  await commitAll(tauriPage, `e2e history base ${RUN}`);

  await typeInEditorAfter(tauriPage, BASE, ` ${EDIT}`);
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
  await commitAll(tauriPage, `e2e history edit ${RUN}`);

  await openHistory(tauriPage);
  await expect(tauriPage.getByText(`e2e history base ${RUN}`)).toBeVisible();
  await expect(tauriPage.getByText(`e2e history edit ${RUN}`)).toBeVisible();

  // Restore reloads every buffer from the restored working tree.
  await restoreCommit(tauriPage, `e2e history base ${RUN}`);
  await tauriPage.waitForFunction(
    `(() => {
      const t = document.querySelector('.cm-content')?.textContent || '';
      return t.includes(${JSON.stringify(BASE)}) && !t.includes(${JSON.stringify(EDIT)});
    })()`,
    20_000,
  );

  await openHistory(tauriPage);
  await restoreCommit(tauriPage, `e2e history edit ${RUN}`);
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-content')?.textContent || '').includes(${JSON.stringify(EDIT)})`,
    20_000,
  );

  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
});
