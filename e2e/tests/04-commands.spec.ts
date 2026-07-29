import { test, expect } from "../fixtures";
import { pressGlobal, currentTheme, openProject } from "../helpers";

test("Cmd+K opens the palette and the theme command toggles the real theme", async ({
  tauriPage,
}) => {
  const before = await currentTheme(tauriPage);
  await pressGlobal(tauriPage, "k", { meta: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await tauriPage.fill("[cmdk-input]", "theme");
  await expect(
    tauriPage.locator('[cmdk-item][aria-selected="true"]'),
  ).toHaveText(`Switch to ${before === "light" ? "dark" : "light"} theme`);
  await tauriPage.press("[cmdk-input]", "Enter");
  await expect(tauriPage.locator("[cmdk-input]")).toBeHidden();
  await expect
    .poll(() => currentTheme(tauriPage), { timeout: 10_000 })
    .not.toBe(before);
  await pressGlobal(tauriPage, "k", { meta: true });
  await tauriPage.fill("[cmdk-input]", "theme");
  await expect(
    tauriPage.locator('[cmdk-item][aria-selected="true"]'),
  ).toHaveText(`Switch to ${before} theme`);
  await tauriPage.press("[cmdk-input]", "Enter");
  await expect
    .poll(() => currentTheme(tauriPage), { timeout: 10_000 })
    .toBe(before);
});

test("Cmd+Shift+F opens the omnibar with registered commands", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await tauriPage.fill("[cmdk-input]", "diagram");
  await expect(tauriPage.getByText("Open Diagram Composer")).toBeVisible();
  await tauriPage.press("[cmdk-input]", "Escape");
  await expect(tauriPage.locator("[cmdk-input]")).toBeHidden();
});
