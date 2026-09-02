import { test, expect } from "../fixtures";
import {
  createBlankProject,
  ensureGithubConnected,
  openProject,
  openRailTab,
  pressGlobal,
  typeInEditorAfter,
  type Page,
} from "../helpers";

// Only the publish flow needs a real token. Repository initialization,
// staging, diffs, and commits are fully local operations.

const RUN = Date.now().toString(36);

async function initializeRepository(page: Page) {
  await openRailTab(page, "Source Control");
  const initialize = page.getByText("Initialize Repository", { exact: true });
  await expect(initialize).toBeVisible({ timeout: 10_000 });
  await initialize.click();
  await expect(page.getByTestId("source-control-actions")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Initialized Git on")).toBeVisible({ timeout: 15_000 });
}

async function stageAllAndCommit(page: Page, message: string) {
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
  if (!stagedVisible) throw new Error("stageAllAndCommit: staging never became visible");
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

test("git panel shows local status directly, without a GitHub connection gate", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, `Git local ${RUN}`);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Control");
  await expect(tauriPage.getByText("Connect GitHub to continue")).toHaveCount(0);
  await expect(tauriPage.getByText("Source Control is not initialized")).toBeVisible({
    timeout: 10_000,
  });
  await initializeRepository(tauriPage);
  // The Remote section (and Push/Pull) only ever rendered behind the old
  // GitHub-connection gate; their presence here proves the panel now shows
  // local status/diff/commit unconditionally.
  await expect(tauriPage.getByText("Remote", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator('[aria-label="Commit and push to origin"]')).toBeVisible();
  await expect(tauriPage.locator('[aria-label="Pull from origin"]')).toBeVisible();
});

test("a successful compile is committed only through an explicit local action", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, `Git compile ${RUN}`);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await initializeRepository(tauriPage);
  const commitsBeforeCompile = await tauriPage.evaluate<number>(
    `window.__gitCommitCount?.() ?? Promise.resolve(0)`,
  );

  const marker = `explicit${RUN}`;
  const message = `e2e: explicit compile commit ${RUN}`;
  await typeInEditorAfter(tauriPage, "here.", ` ${marker}`);
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });
  expect(
    await tauriPage.evaluate<number>(`window.__gitCommitCount?.() ?? Promise.resolve(0)`),
  ).toBe(commitsBeforeCompile);

  await stageAllAndCommit(tauriPage, message);
  expect(
    await tauriPage.evaluate<number>(`window.__gitCommitCount?.() ?? Promise.resolve(0)`),
  ).toBe(commitsBeforeCompile + 1);
  await tauriPage.click('[aria-label="Versioning"]');
  await tauriPage.click('[data-testid="versioning-tab-git"]');
  await expect(tauriPage.getByTestId("versioning-tab-git")).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 10_000 },
  );
  await expect(tauriPage.getByText(message, { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("stage, diff, and commit without requiring a connected account", async ({ tauriPage }) => {
  await createBlankProject(tauriPage, `Git diff ${RUN}`);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await initializeRepository(tauriPage);
  const marker = `gitmarker${RUN}`;
  await typeInEditorAfter(tauriPage, "here.", ` ${marker}`);

  await openRailTab(tauriPage, "Source Control");
  // The autosave may still be landing and the panel refreshes on mount, not
  // on file saves, so refresh until the change shows.
  for (let i = 0; i < 20; i++) {
    await tauriPage.click('[aria-label="Refresh"]');
    const ready = await tauriPage.evaluate<boolean>(
      `!!document.querySelector('[data-testid="git-change-main.tex"]')`,
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await tauriPage.click('[data-testid="git-change-main.tex"]', { timeout: 5_000 });
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-changedLine, .cm-insertedLine, .cm-deletedChunk, .cm-changedText, .cm-merge-a, .cm-merge-b, .cm-mergeView')`,
    15_000,
  );

  const message = `e2e: commit ${marker}`;
  await stageAllAndCommit(tauriPage, message);
  // The success card proves the real git commit completed. The working tree
  // can legitimately gain a later autosave, so "No changes" is not a stable
  // assertion for the commit operation itself.
  await tauriPage.waitForFunction(
    `document.body.innerText.includes(${JSON.stringify(`Committed: "${message}"`)})`,
    15_000,
  );
});

// Deleting the remote repo needs the delete_repo scope; if the token lacks it
// the test tells you to delete manually. Opt in with E2E_GIT_PUSH=1 alongside
// E2E_GITHUB_TOKEN.
test("publish to GitHub creates a real repo and pushes the project", async ({ tauriPage }) => {
  test.skip(
    process.env.E2E_GIT_PUSH !== "1" || !process.env.E2E_GITHUB_TOKEN,
    "set E2E_GIT_PUSH=1 and E2E_GITHUB_TOKEN to run",
  );
  test.setTimeout(180_000);
  const token = process.env.E2E_GITHUB_TOKEN as string;
  const repoName = `e2e-oleafly-${Date.now().toString(36)}`;
  const gh = (path: string, init?: RequestInit) =>
    fetch(`https://api.github.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });

  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureGithubConnected(tauriPage);

  // A previous run may have left a remote linked; unlink to get the Publish CTA.
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('Publish to GitHub') || Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Unlink')`,
    15_000,
  );
  const linked = await tauriPage.evaluate<boolean>(
    `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Unlink')`,
  );
  if (linked) {
    await tauriPage.getByText("Unlink", { exact: true }).click();
    await expect(tauriPage.getByText("Publish to GitHub")).toBeVisible({ timeout: 10_000 });
  }

  await tauriPage.getByText("Publish to GitHub").click();
  await tauriPage.fill('[aria-label="Repository name"]', repoName);
  await tauriPage.getByText("Create and push").click();
  await expect(tauriPage.getByText("Published to")).toBeVisible({ timeout: 90_000 });

  const me = (await (await gh("/user")).json()) as { login: string };
  expect((await gh(`/repos/${me.login}/${repoName}`)).status).toBe(200);
  expect((await gh(`/repos/${me.login}/${repoName}/contents/main.tex`)).status).toBe(200);

  // Unlink too, so re-runs start from the Publish CTA again.
  const del = await gh(`/repos/${me.login}/${repoName}`, { method: "DELETE" });
  if (del.status !== 204) {
    console.warn(
      `could not delete ${me.login}/${repoName} (HTTP ${del.status}); ` +
        "delete it manually or grant the token the delete_repo scope",
    );
  }
  await openRailTab(tauriPage, "Source Control");
  await tauriPage.getByText("Unlink", { exact: true }).click();
  await expect(tauriPage.getByText("Publish to GitHub")).toBeVisible({ timeout: 10_000 });
});
