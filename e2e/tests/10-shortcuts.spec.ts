import { test, expect } from "../fixtures";
import { openProject, pressGlobal, waitLong } from "../helpers";

// Every global shortcut must reach its real handler. (Cmd+K and Cmd+Shift+F
// are covered in 04-commands; this file covers the rest.)

test("Cmd+Enter compiles and Cmd+Shift+J forward-SyncTeX highlights the PDF", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });

  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await waitLong(
    tauriPage,
    `!document.body.innerText.includes('Compiling your document')`,
    120_000,
  );
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");

  await tauriPage.getByText("Write your").click();
  await pressGlobal(tauriPage, "j", { meta: true, shift: true });
  await expect(tauriPage.locator(".ll-synctex-hl")).toBeVisible({ timeout: 15_000 });
});

test("Cmd+/ opens the keyboard shortcuts reference", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "/", { meta: true });
  await expect(tauriPage.getByText("Keyboard Shortcuts")).toBeVisible();
  await expect(tauriPage.locator('input[placeholder="Search shortcuts…"]')).toBeVisible();
});
