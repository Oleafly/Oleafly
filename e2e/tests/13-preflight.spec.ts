import { test, expect } from "../fixtures";
import { openProject, openRailTab } from "../helpers";

test("preflight categories render and a single check runs independently", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Preflight's PDF checks need a compiled PDF.
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 30_000 });

  await openRailTab(tauriPage, "Preflight (ATS + accessibility)");
  const runButton = tauriPage.locator('[aria-label^="Run "]:not(:disabled)').first();
  await expect(runButton).toBeVisible();

  await runButton.click();
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-running",
    "false",
    { timeout: 60_000 },
  );
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-error",
    "",
  );
  await expect(tauriPage.getByTestId("preflight-panel")).toHaveAttribute(
    "data-report",
    "true",
    { timeout: 60_000 },
  );
  await expect(tauriPage.getByText("No document language set")).toBeVisible();
  await expect(tauriPage.getByText("Accessible export")).toBeVisible();
});
