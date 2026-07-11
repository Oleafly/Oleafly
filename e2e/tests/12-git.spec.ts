import { test, expect } from "../fixtures";
import {
  ensureGithubConnected,
  openProject,
  openRailTab,
  openSettings,
  pressGlobal,
  typeInEditorAfter,
} from "../helpers";

// Source control. For a fresh (unconnected) setup the panel shows the GitHub
// onboarding gate; the stage/diff/commit and push flows need a real token and
// are opt-in via env vars.

test("git panel shows the GitHub onboarding gate when not connected", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Git");
  // A previous token-gated run may have left the account connected on this
  // data dir; disconnect through settings first (real user flow) so the gate
  // is actually asserted every run.
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

// Full source-control flow: connect with a PAT, then stage -> diff -> commit.
// Opt in with E2E_GITHUB_TOKEN=<pat>. Nothing is pushed.
test("stage, diff, and commit with a connected account", async ({ tauriPage }) => {
  test.skip(!process.env.E2E_GITHUB_TOKEN, "set E2E_GITHUB_TOKEN to run");
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await ensureGithubConnected(tauriPage);

  // Make a change and persist it (compile saves the active file).
  await typeInEditorAfter(tauriPage, "here.", " gitmarker");
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });

  await openRailTab(tauriPage, "Git");
  // Surface the fresh edit: the save-on-compile may still be landing and the
  // panel refreshes on mount, not on file saves - refresh until it shows.
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
  // Stage all is hover-revealed (opacity-0): the plugin's click waits for
  // visibility and never fires - click the real button via the DOM instead.
  // Keep refreshing + staging until the STAGED section is actually visible -
  // the commit button reads that React state, and both the save-on-compile
  // and the panel refresh land asynchronously.
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
  // The commit box is a TEXTAREA; the plugin's fill only drives inputs.
  await tauriPage.evaluate(
    `(() => {
      const t = document.querySelector('[placeholder="Commit message (required)…"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(t, "e2e: commit gitmarker");
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    })()`,
  );
  await tauriPage.getByText("Commit").click();
  // Success signal that doesn't vanish: the working tree is clean again.
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('No changes')`,
    15_000,
  );
});

// The full publish flow, against real GitHub: create a repo through the
// dialog, push the project, verify the file landed on the remote over the
// API, then delete the remote repo (needs the delete_repo scope; if the
// token lacks it the test tells you to delete manually). Opt in with
// E2E_GIT_PUSH=1 alongside E2E_GITHUB_TOKEN.
test("publish to GitHub creates a real repo and pushes the project", async ({ tauriPage }) => {
  test.skip(
    process.env.E2E_GIT_PUSH !== "1" || !process.env.E2E_GITHUB_TOKEN,
    "set E2E_GIT_PUSH=1 and E2E_GITHUB_TOKEN to run",
  );
  test.setTimeout(180_000);
  const token = process.env.E2E_GITHUB_TOKEN as string;
  const repoName = `e2e-openleaf-${Date.now().toString(36)}`;
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

  // The repo really exists and the push landed main.tex on the remote.
  const me = (await (await gh("/user")).json()) as { login: string };
  expect((await gh(`/repos/${me.login}/${repoName}`)).status).toBe(200);
  expect((await gh(`/repos/${me.login}/${repoName}/contents/main.tex`)).status).toBe(200);

  // Clean up: delete the remote repo, and unlink the project so re-runs
  // start from the Publish CTA again.
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
