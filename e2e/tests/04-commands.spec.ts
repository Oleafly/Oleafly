import { test, expect } from "../fixtures";
import { pressGlobal, currentTheme, openProject } from "../helpers";

test("Cmd+K opens the palette and the theme command toggles the real theme", async ({
  tauriPage,
}) => {
  const before = await currentTheme(tauriPage);
  await pressGlobal(tauriPage, "k", { meta: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await tauriPage.fill("[cmdk-input]", "theme");
  await tauriPage.press("[cmdk-input]", "Enter");
  await expect(tauriPage.locator("[cmdk-input]")).toBeHidden();
  expect(await currentTheme(tauriPage)).not.toBe(before);
  await pressGlobal(tauriPage, "k", { meta: true });
  await tauriPage.fill("[cmdk-input]", "theme");
  await tauriPage.press("[cmdk-input]", "Enter");
  expect(await currentTheme(tauriPage)).toBe(before);
});

test("Cmd+Shift+F opens the omnibar with registered commands", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await tauriPage.fill("[cmdk-input]", "diagram");
  await expect(tauriPage.getByText("Insert a diagram (manual)")).toBeVisible();
  await tauriPage.press("[cmdk-input]", "Escape");
  await expect(tauriPage.locator("[cmdk-input]")).toBeHidden();
});
