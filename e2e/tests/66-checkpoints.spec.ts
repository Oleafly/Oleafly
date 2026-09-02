import { test, expect } from "../fixtures";
import { createBlankProject, pressGlobal, typeInEditorAfter } from "../helpers";

const RUN = Date.now().toString(36);
const EDIT = `chkedit${RUN}`;

type Page = Parameters<typeof createBlankProject>[0];

async function compileOk(page: Page) {
  await pressGlobal(page, "Enter", { meta: true });
  await expect(page.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });
}

async function openCheckpoints(page: Page) {
  await page.click('[aria-label="Versioning"]');
  await page.click('[data-testid="versioning-tab-checkpoints"]');
  await expect(page.locator('[role="dialog"][aria-labelledby="versioning-title"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("versioning-panel-checkpoints")).toBeVisible({ timeout: 10_000 });
}

async function closeCheckpoints(page: Page) {
  await page.click('[aria-label="Close versioning"]');
  await expect(page.locator('[role="dialog"][aria-labelledby="versioning-title"]')).toHaveCount(0, {
    timeout: 10_000,
  });
}

async function waitForVersion(page: Page, version: string) {
  await expect(
    page.locator(`[data-testid="checkpoint-entry"][data-version="${version}"]`),
  ).toBeVisible({ timeout: 150_000 });
}

async function waitUntilIdle(page: Page) {
  await expect(page.getByTestId("checkpoint-publishing")).toHaveCount(0, { timeout: 150_000 });
}

test("a successful compile stores one checkpoint and unchanged sources add nothing", async ({
  tauriPage,
}) => {
  test.setTimeout(600_000);
  await createBlankProject(tauriPage, `Checkpoints ${RUN}`);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await compileOk(tauriPage);
  await openCheckpoints(tauriPage);
  await waitForVersion(tauriPage, "V1");
  await waitUntilIdle(tauriPage);
  await expect(tauriPage.getByTestId("checkpoint-entry")).toHaveCount(1);
  const firstRoot = await tauriPage.evaluate<string>(
    `document.querySelector('[data-testid="checkpoint-entry"]')?.getAttribute('data-root') || ''`,
  );
  expect(firstRoot).toMatch(/^[0-9a-f]{64}$/);

  const advanced = tauriPage.getByTestId("checkpoints-advanced");
  await expect(advanced).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
  await expect(tauriPage.getByText("Keep latest", { exact: true })).toBeHidden({ timeout: 5_000 });
  await advanced.click();
  await expect(advanced).toHaveAttribute("aria-expanded", "true", { timeout: 10_000 });
  await expect(tauriPage.getByText("Keep latest", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.getByText("Export", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.getByText("Import", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(
    tauriPage.locator('[data-testid="versioning-panel-checkpoints"] code'),
  ).toBeVisible({ timeout: 20_000 });
  await advanced.click();
  await expect(advanced).toHaveAttribute("aria-expanded", "false", { timeout: 10_000 });
  await expect(tauriPage.getByText("Keep latest", { exact: true })).toBeHidden({ timeout: 5_000 });

  await closeCheckpoints(tauriPage);

  await compileOk(tauriPage);
  await openCheckpoints(tauriPage);
  await waitUntilIdle(tauriPage);
  await expect(tauriPage.getByTestId("checkpoint-entry")).toHaveCount(1);
  await closeCheckpoints(tauriPage);

  await typeInEditorAfter(tauriPage, "here.", ` ${EDIT}`);
  await compileOk(tauriPage);
  await openCheckpoints(tauriPage);
  await waitForVersion(tauriPage, "V2");
  await waitUntilIdle(tauriPage);
  await expect(tauriPage.getByTestId("checkpoint-entry")).toHaveCount(2);
  const versions = await tauriPage.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[data-testid="checkpoint-entry"]')).map((row) => row.getAttribute('data-version') || '')`,
  );
  expect(versions).toEqual(["V2", "V1"]);

  await tauriPage.click('[aria-label="Show files for V2"]');
  await expect(
    tauriPage.locator('[data-testid="checkpoint-file"][data-path="project.json"]'),
  ).toBeVisible({ timeout: 15_000 });
  const filePaths = await tauriPage.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[data-testid="checkpoint-file"]')).map((row) => row.getAttribute('data-path') || '')`,
  );

  expect(filePaths.some((path) => /\.(tex|typ|md)$/.test(path))).toBe(true);
  expect(filePaths.some((path) => /\.(log|pdf|aux)$/.test(path))).toBe(false);

  await tauriPage.click('[aria-label="Restore V1"]');
  await tauriPage.getByText("Overwrite all", { exact: true }).click();
  await tauriPage.waitForFunction(
    `(() => {
      const text = document.querySelector('.cm-content')?.textContent || '';
      return text.includes('here.') && !text.includes(${JSON.stringify(EDIT)});
    })()`,
    30_000,
  );
  await expect(tauriPage.locator('[role="dialog"][aria-labelledby="versioning-title"]')).toHaveCount(0, {
    timeout: 10_000,
  });

  await compileOk(tauriPage);
  await openCheckpoints(tauriPage);
  await waitUntilIdle(tauriPage);
  await expect(tauriPage.getByTestId("checkpoint-entry")).toHaveCount(2);
  await closeCheckpoints(tauriPage);
});
