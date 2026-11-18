import { test, expect } from "../fixtures";
import { chooseProjectKind, openNewProject } from "../helpers";
import { startOverleafFixtureServer } from "../overleaf-fixture-server";

const FAKE_BROWSER = process.env.OLEAFLY_E2E_SIGN_IN_BROWSER;

// Ignored on purpose without OLEAFLY_E2E_SIGN_IN_BROWSER, because the sign-in needs the scripted browser.
test.skip(
  !FAKE_BROWSER,
  "Needs OLEAFLY_E2E_SIGN_IN_BROWSER, the scripted browser built with `cargo build -p oleafly-online --example fake_browser`, and an app built with the e2e-testing feature.",
);

let server: Awaited<ReturnType<typeof startOverleafFixtureServer>>;

test.beforeAll(async () => {
  server = await startOverleafFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});

test("signs in through an installed browser picked in the import view", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openNewProject(tauriPage);
  await chooseProjectKind(tauriPage, "import");
  await tauriPage.click('[data-testid="project-import-overleaf"]');
  const panel = tauriPage.locator('[data-testid="overleaf-sign-in-panel"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });

  await tauriPage.click('[data-testid="overleaf-change-server"]');
  await tauriPage.fill('[data-testid="overleaf-server-input"]', server.base);
  await tauriPage.click('[data-testid="overleaf-save-server"]');
  await expect(panel).toContainText(server.base.replace("http://", ""), { timeout: 20_000 });

  await expect(tauriPage.locator('[data-testid="browser-sign-in-picker"]')).toContainText("Google Chrome", {
    timeout: 20_000,
  });
  await tauriPage.click('[data-testid="browser-sign-in"]');
  await expect(tauriPage.locator('[data-testid="overleaf-import-view"]')).toBeVisible({ timeout: 60_000 });
  await expect(tauriPage.locator('[data-testid="overleaf-project-e2e-thesis"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="overleaf-project-e2e-paper"]')).toBeVisible();

  await tauriPage.click('[data-testid="overleaf-sign-out"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });
});
