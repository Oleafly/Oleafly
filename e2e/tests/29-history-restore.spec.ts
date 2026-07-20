import { test, expect } from "../fixtures";
import {
  ensureGithubConnected,
  openProject,
  openRailTab,
  pressGlobal,
  typeInEditorAfter,
} from "../helpers";

// Commits need a connected GitHub account (the panel is gated), so this is
// opt-in like spec 12.

const TOKEN = process.env.E2E_GITHUB_TOKEN;
// Unique per run so re-runs against a live app never collide.
const RUN = Date.now().toString(36);
const BASE = `histbase${RUN}`;
const EDIT = `histedit${RUN}`;

// Caller must already have the Git rail open so compile auto-commit is
// suspended (see auto-commit.ts `sourceControlOpen`).
async function commitAll(page: import("../helpers").Page, message: string) {
  await openRailTab(page, "Git");
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
  // The commit box is a TEXTAREA; the plugin's fill only drives inputs.
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
  // Assert the completed git operation itself. A later autosave may
  // legitimately dirty the working tree again after this commit succeeds.
  await page.waitForFunction(
    `document.body.innerText.includes(${JSON.stringify(`Committed: "${message}"`)})`,
    15_000,
  );
}

async function openHistory(page: import("../helpers").Page) {
  await pressGlobal(page, "k", { meta: true });
  await page.fill("[cmdk-input]", "history");
  await page.press("[cmdk-input]", "Enter");
  await page.waitForFunction(
    `Array.from(document.querySelectorAll('h2')).some(h => h.textContent.trim() === 'History')`,
    10_000,
  );
}

async function restoreCommit(page: import("../helpers").Page, message: string) {
  const clicked = await page.evaluate<boolean>(
    `(() => {
      const rows = Array.from(document.querySelectorAll('div.truncate'))
        .filter((d) => d.textContent.trim() === ${JSON.stringify(message)});
      if (!rows.length) return false;
      const row = rows[0].closest('div.flex');
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
    `!Array.from(document.querySelectorAll('h2')).some(h => h.textContent.trim() === 'History')`,
    15_000,
  );
}

test("commit twice, restore the first commit, then roll forward again", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_GITHUB_TOKEN to run");
  test.setTimeout(300_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Open Git first so compile auto-commit is suspended (auto-commit.ts skips
  // while the source-control rail is active). Otherwise a successful compile
  // races ahead and leaves nothing for us to stage.
  await ensureGithubConnected(tauriPage);

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
