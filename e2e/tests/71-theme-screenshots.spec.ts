import { test, expect } from "../fixtures";
import {
  createBlankProject,
  openProject,
  openSettings,
  type Page,
} from "../helpers";

const PROJECT = "E2E Theme Shots";

// Visual-parity record for the design-token migration: full-window captures of
// the main surfaces in both palettes, attached to the test report. Not pixel
// asserted; reviewers diff them between releases.

async function setTheme(page: Page, theme: "light" | "dark") {
  await openSettings(page, "appearance");
  await page.click(`[data-testid="settings-theme-${theme}"]`);
  await expect
    .poll(() =>
      page.evaluate<string>(
        `document.documentElement.getAttribute('data-theme')`,
      ),
    )
    .toBe(theme);
  await page.click('[aria-label="Close settings"]');
}

async function capture(page: Page, name: string) {
  await test.info().attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test("captures home and workspace surfaces in light and dark", async ({
  tauriPage,
}) => {
  const exists = await tauriPage.evaluate<boolean>(
    `Array.from(document.querySelectorAll('button')).some((el) => el.textContent?.includes(${JSON.stringify(PROJECT)}))`,
  );
  if (exists) await openProject(tauriPage, PROJECT);
  else await createBlankProject(tauriPage, PROJECT);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({
    timeout: 20_000,
  });

  const before = await tauriPage.evaluate<string>(
    `document.documentElement.getAttribute('data-theme')`,
  );

  for (const theme of ["light", "dark"] as const) {
    await setTheme(tauriPage, theme);
    await capture(tauriPage, `workspace-${theme}`);
  }

  await tauriPage.click('[title="Back to library"]');
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
  for (const theme of ["light", "dark"] as const) {
    await setTheme(tauriPage, theme);
    await capture(tauriPage, `home-${theme}`);
  }

  await setTheme(tauriPage, before === "light" ? "light" : "dark");
});
