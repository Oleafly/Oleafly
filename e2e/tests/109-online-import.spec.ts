import { test, expect } from "../fixtures";
import { chooseProjectKind, openNewProject, waitLong, type Page } from "../helpers";
import { startOverleafFixtureServer } from "../overleaf-fixture-server";

let server: Awaited<ReturnType<typeof startOverleafFixtureServer>>;

test.beforeAll(async () => {
  server = await startOverleafFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});

async function projectState(page: Page) {
  return page.evaluate<{ main: string; name: string; engineId: string }>(
    `import("/src/store/files.ts").then((m) => {
      const s = m.useFilesStore.getState();
      return { main: s.mainDoc, name: s.projectName, engineId: s.engine.id };
    })`,
  );
}

test("signs in to an Overleaf server, lists its projects and imports them with their settings", async ({
  tauriPage,
}) => {
  test.setTimeout(180_000);
  await openNewProject(tauriPage);
  await chooseProjectKind(tauriPage, "import");
  await tauriPage.click('[data-testid="project-import-overleaf"]');
  await expect(tauriPage.locator('[data-testid="overleaf-sign-in-panel"]')).toBeVisible({ timeout: 20_000 });

  await tauriPage.click('[data-testid="overleaf-change-server"]');
  await tauriPage.fill('[data-testid="overleaf-server-input"]', server.base);
  await tauriPage.click('[data-testid="overleaf-save-server"]');
  await expect(tauriPage.locator('[data-testid="overleaf-sign-in-panel"]')).toContainText(
    server.base.replace("http://", ""),
    { timeout: 20_000 },
  );

  await tauriPage.click('[data-testid="overleaf-sign-in"]');
  await expect(tauriPage.locator('[data-testid="overleaf-import-view"]')).toBeVisible({ timeout: 60_000 });
  await expect(tauriPage.locator('[data-testid="overleaf-project-e2e-thesis"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="overleaf-project-e2e-paper"]')).toBeVisible();

  await tauriPage.click('[data-testid="overleaf-select-all"]');
  await expect(tauriPage.locator('[data-testid="overleaf-import-selected"]')).toContainText("Import 2 projects");
  await tauriPage.click('[data-testid="overleaf-import-selected"]');
  for (const id of ["e2e-thesis", "e2e-paper"]) {
    await expect(tauriPage.locator(`[data-testid="overleaf-status-${id}"]`)).toContainText("Imported", {
      timeout: 90_000,
    });
  }
  await expect(tauriPage.locator('[data-testid="overleaf-selection-summary"]')).toContainText(
    "Imported 2 projects.",
  );

  await tauriPage.click('[data-testid="overleaf-status-e2e-thesis"] button');
  await waitLong(tauriPage, `!!document.querySelector('[data-tour="project-editor"] .cm-content')`, 45_000);
  const state = await projectState(tauriPage);
  expect(state.name).toBe("Fixture Thesis");
  expect(state.main).toBe("thesis/main.tex");
  expect(state.engineId).toBe("latexmk");
});
