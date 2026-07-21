import { test, expect } from "../fixtures";
import {
  ensureGithubConnected,
  openProject,
  openRailTab,
  openSettings,
  pressGlobal,
  typeInEditorAfter,
} from "../helpers";

// The stage/diff/commit and push flows below need a real token and are
// opt-in via env vars.

test("git panel shows the GitHub onboarding gate when not connected", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Git");
  // A previous token-gated run may have left the account connected on this
  // data dir; disconnect through settings first so the gate is actually
  // asserted every run.
  const connected = await tauriPage.evaluate<boolean>(
    `!document.body.innerText.includes('Connect GitHub to continue')`,
  );
  if (connected && process.env.E2E_GITHUB_TOKEN) {
    await openSettings(tauriPage, "github");
    await tauriPage.getByText("Disconnect", { exact: true }).click();
    await tauriPage.waitForFunction(
      `document.body.innerText.includes('Disconnected.') || !document.body.innerText.includes('Disconnect')`,
      10_000,
    );
    await tauriPage.click('[aria-label="Close settings"]');
    await openRailTab(tauriPage, "Git");
  }
  await expect(tauriPage.getByText("Connect GitHub to continue")).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.getByText("Use a personal access token instead")).toBeVisible();
});

test("a successful compile auto-commits an Update entry into history", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Auto-commit is suspended while the Source Control panel is open (an
  // earlier test may have left it active), so switch to another rail tab.
  await openRailTab(tauriPage, "Source Tree");

  await typeInEditorAfter(tauriPage, "here.", " autocommit");
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });

  // The commit lands asynchronously after the compile, and the history modal
  // loads its content on open, so poll by reopening it.
  let seen = false;
  for (let i = 0; i < 15 && !seen; i++) {
    await tauriPage.click('[aria-label="History"]');
    seen = await tauriPage.evaluate<boolean>(
      `/Update:[^\\n]*main\\.tex/.test(document.body.innerText)`,
    );
    await tauriPage.getByText("Close", { exact: true }).click();
    if (!seen) await new Promise((r) => setTimeout(r, 1000));
  }
  expect(seen).toBe(true);
});

// Opt in with E2E_GITHUB_TOKEN=<pat>. Nothing is pushed.
test("stage, diff, and commit with a connected account", async ({ tauriPage }) => {
  test.skip(!process.env.E2E_GITHUB_TOKEN, "set E2E_GITHUB_TOKEN to run");
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await ensureGithubConnected(tauriPage);

  // Don't compile here: a successful compile now auto-commits, which would
  // leave nothing to stage.
  await typeInEditorAfter(tauriPage, "here.", " gitmarker");

  await openRailTab(tauriPage, "Git");
  // The autosave may still be landing and the panel refreshes on mount, not
  // on file saves, so refresh until the change shows. (Auto-commit is
  // suspended while this panel is open, so the change stays uncommitted.)
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

  await openRailTab(tauriPage, "Git");
  // "Stage all" is hover-revealed (opacity-0), so Playwright's click waits
  // forever for visibility; click the DOM button directly instead. Keep
  // refreshing + staging until STAGED is visible since the autosave and the
  // panel refresh both land asynchronously.
  let stagedVisible = false;
  for (let i = 0; i < 25 && !stagedVisible; i++) {
    await tauriPage.evaluate(
      `(() => {
        const b = document.querySelector('[aria-label="Stage all"]');
        if (b) b.click();
        return 1;
      })()`,
    );
    await new Promise((r) => setTimeout(r, 800));
    stagedVisible = await tauriPage.evaluate<boolean>(
      `!!document.querySelector('[aria-label="Unstage all"]')`,
    );
    if (!stagedVisible) await tauriPage.click('[aria-label="Refresh"]');
  }
  if (!stagedVisible) throw new Error("staging never became visible");
  // The commit box is a TEXTAREA; Playwright's fill only drives inputs.
  await tauriPage.evaluate(
    `(() => {
      const t = document.querySelector('[placeholder="Commit message (required)…"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(t, "e2e: commit gitmarker");
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`,
  );
  const commit = tauriPage.getByText("Commit", { exact: true });
  await expect(commit).toBeEnabled({ timeout: 5_000 });
  await commit.click();
  // The success card proves the real git commit completed. The working tree
  // can legitimately gain a later autosave, so "No changes" is not a stable
  // assertion for the commit operation itself.
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('Committed: "e2e: commit gitmarker"')`,
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
  await tauriPage.getByText("Create & push").click();
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
  await openRailTab(tauriPage, "Git");
  await tauriPage.getByText("Unlink", { exact: true }).click();
  await expect(tauriPage.getByText("Publish to GitHub")).toBeVisible({ timeout: 10_000 });
});
