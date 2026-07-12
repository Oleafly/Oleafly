import { test, expect } from "../fixtures";
import { openProject, openRailTab, typeInEditorAtStart } from "../helpers";

// Real file management through the tree UI: create, edit, switch, and see the
// document outline - the content must survive round-trips between files.

test("create a new file, edit it, and switch between files", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openRailTab(tauriPage, "Source Tree");
  await tauriPage.click('[title="New file (in the selected folder)"]');
  await tauriPage.fill('input[placeholder="New file name"]', "notes.tex");
  await tauriPage.press('input[placeholder="New file name"]', "Enter");
  await expect(tauriPage.getByText("notes.tex")).toBeVisible();

  // Open the new (empty) file and type into it.
  await tauriPage.getByText("notes.tex").click();
  await tauriPage.waitForFunction(
    `!document.querySelector('.cm-content').textContent.includes('documentclass')`,
    10_000,
  );
  await typeInEditorAtStart(tauriPage, "% scratch notes for e2e");
  await expect(tauriPage.locator(".cm-content")).toContainText("scratch notes");

  // Switch back to main.tex: its content loads.
  await tauriPage.getByText("main.tex").click();
  await expect(tauriPage.locator(".cm-content")).toContainText("documentclass");

  // And notes.tex kept the edit (store round-trip, no clobbering).
  await tauriPage.getByText("notes.tex").click();
  await expect(tauriPage.locator(".cm-content")).toContainText("scratch notes");
});

test("outline shows the document structure", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Source Tree");
  await tauriPage.getByText("main.tex").click();
  // main.tex has \section{Introduction}; the outline panel lists it.
  await expect(tauriPage.getByText("Introduction")).toBeVisible();
});
