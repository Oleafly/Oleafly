import { test, expect } from "../fixtures";
import { openProject, openRailTab, pressGlobal, typeInEditorAfter } from "../helpers";

// Source control. For a fresh (unconnected) setup the panel shows the GitHub
// onboarding gate; the stage/diff/commit and push flows need a real token and
// are opt-in via env vars.

test("git panel shows the GitHub onboarding gate when not connected", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Git");
  await expect(tauriPage.getByText("Connect GitHub to continue")).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.getByText("Use a personal access token instead")).toBeVisible();
});

// Full source-control flow: connect with a PAT, then stage -> diff -> commit.
// Opt in with E2E_GITHUB_TOKEN=<pat>. Nothing is pushed.
test("stage, diff, and commit with a connected account", async ({ tauriPage }) => {
  test.skip(!process.env.E2E_GITHUB_TOKEN, "set E2E_GITHUB_TOKEN to run");
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openRailTab(tauriPage, "Git");
  const gated = await tauriPage.evaluate<boolean>(
    `document.body.innerText.includes('Connect GitHub to continue')`,
  );
  if (gated) {
    await tauriPage.getByText("Use a personal access token instead").click();
    await tauriPage.fill(
      'input[type="password"], input[placeholder*="token" i]',
      process.env.E2E_GITHUB_TOKEN as string,
    );
    await tauriPage.press('input[type="password"], input[placeholder*="token" i]', "Enter");
  }

  // Make a change and persist it (compile saves the active file).
  await typeInEditorAfter(tauriPage, "here.", " gitmarker");
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });

  await openRailTab(tauriPage, "Git");
  await tauriPage.click('[data-testid="git-change-main.tex"]', { timeout: 15_000 });
  await tauriPage.waitForFunction(
    `!!document.querySelector('.cm-changedLine, .cm-insertedLine, .cm-deletedChunk, .cm-changedText, .cm-merge-a, .cm-merge-b, .cm-mergeView')`,
    15_000,
  );

  await openRailTab(tauriPage, "Git");
  await tauriPage.click('[aria-label="Stage all"]');
  await tauriPage.fill('[placeholder="Commit message (required)…"]', "e2e: commit gitmarker");
  await tauriPage.getByText("Commit").click();
  await expect(tauriPage.getByText("Committed:")).toBeVisible({ timeout: 15_000 });
});

// Pushing needs a real remote; opt in with E2E_GIT_PUSH=1 after configuring
// the project's remote (clean up the remote repo yourself afterwards).
test("push to origin", async ({ tauriPage }) => {
  test.skip(process.env.E2E_GIT_PUSH !== "1", "set E2E_GIT_PUSH=1 with a configured remote to run");
  await openProject(tauriPage, "E2E Doc");
  await openRailTab(tauriPage, "Git");
  await tauriPage.click('[aria-label="Commit and push to origin"]');
  await expect(tauriPage.getByText("push", { exact: false })).toBeVisible({ timeout: 60_000 });
});
