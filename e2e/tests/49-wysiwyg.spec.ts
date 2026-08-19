import { test, expect } from "../fixtures";
import { createBlankProject, createProjectFromTemplate } from "../helpers";

test("toggling into WYSIWYG shows parsed content, editing round-trips back to source", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, "E2E WYSIWYG LaTeX");

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.getByText("Introduction")).toBeVisible({ timeout: 10_000 });

  await tauriPage.click('[aria-label="Switch to source view"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator(".cm-content")).toContainText("Introduction");
});

test("toggling into WYSIWYG shows parsed markdown content, editing round-trips back to source", async ({
  tauriPage,
}) => {
  await createProjectFromTemplate(tauriPage, "blank-markdown", "E2E MD Doc");

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.getByText("Untitled Markdown Document")).toBeVisible({ timeout: 10_000 });

  await tauriPage.click('[aria-label="Switch to source view"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator(".cm-content")).toContainText("Untitled Markdown Document");
});
