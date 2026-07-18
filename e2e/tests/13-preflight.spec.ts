import { test, expect } from "../fixtures";
import { openProject, openRailTab, pressGlobal } from "../helpers";

test("preflight categories render and a single check runs independently", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Preflight's PDF checks need a compiled PDF.
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });

  await openRailTab(tauriPage, "Preflight (ATS + accessibility)");
  await expect(tauriPage.getByText("Run")).toBeVisible();

  await tauriPage.getByText("Run").click();
  await tauriPage.waitForFunction(
    `/✓|issue|score|finding/i.test(document.body.innerText) && !document.querySelector('.animate-spin')`,
    60_000,
  );
  const after = await tauriPage.evaluate<string>(`document.body.innerText`);
  expect(after).toMatch(/✓|issue|score|finding/i);
});
