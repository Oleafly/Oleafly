import { test, expect } from "../fixtures";
import {
  createBlankProject,
  openProject,
  type Page,
} from "../helpers";

const PROJECT = "E2E Harness";

async function ensureProject(page: Page & { getByText(t: string): { click(): Promise<void> } }) {
  const exists = await page.evaluate<boolean>(
    `Array.from(document.querySelectorAll('button')).some((el) => el.textContent?.includes(${JSON.stringify(PROJECT)}))`,
  );
  if (exists) await openProject(page, PROJECT);
  else await createBlankProject(page, PROJECT);
}

test("composer opens from the home dock and asks for a project first", async ({
  tauriPage,
}) => {
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });

  await tauriPage.click('[data-testid="open-agentic-harness"]');
  await expect(tauriPage.getByTestId("agentic-harness")).toBeVisible();
  // No project open: the center is the chooser, panels stay disabled.
  await expect(
    tauriPage.getByTestId("harness-project-chooser"),
  ).toBeVisible();
  await expect(tauriPage.getByTestId("harness-panel-terminal")).toBeDisabled();

  await tauriPage.click('[aria-label="Back to home"]');
  await expect(tauriPage.getByTestId("agentic-harness")).not.toBeVisible();
});

test("composer runs over an open project with session, workflows, and files panel", async ({
  tauriPage,
}) => {
  await ensureProject(tauriPage);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({
    timeout: 20_000,
  });

  // A connected provider is needed for the workflow handoff to fill the
  // composer; nothing is sent, so a dead endpoint is fine.
  await tauriPage.evaluate<boolean>(
    `window.__aiConnect?.("ollama", "http://127.0.0.1:9", "llama3.2") ?? false`,
  );
  // The composer is its own hub: go home, open it, then pick the project
  // from its chooser (the workspace never shows through).
  await tauriPage.click('[aria-label="Home"]');
  await tauriPage.click('[data-testid="open-agentic-harness"]');
  await expect(tauriPage.getByTestId("agentic-harness")).toBeVisible();
  await tauriPage.getByTestId("harness-project-chooser").getByText(PROJECT).click();
  await expect(
    tauriPage.getByTestId("agentic-harness").locator('[data-tour="ai-input"]'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    tauriPage.getByTestId("harness-session-status"),
  ).toBeVisible();

  // A fresh task opens on research workflows: picking one loads its prompt
  // into the composer without sending.
  await tauriPage
    .getByTestId("composer-workflow-research-citation")
    .click();
  await expect(
    tauriPage.getByTestId("agentic-harness").locator('[data-tour="ai-input"]'),
  ).toHaveValue(/citation/i, { timeout: 10_000 });

  await tauriPage.click('[data-testid="harness-panel-files"]');
  await expect(tauriPage.getByTestId("harness-files")).toBeVisible();

  await tauriPage.click('[aria-label="Back to home"]');
});
