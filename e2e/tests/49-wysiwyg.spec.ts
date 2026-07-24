import { test, expect } from "../fixtures";
import { openGallery, openProject } from "../helpers";

test("toggling into WYSIWYG shows parsed content, editing round-trips back to source", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.getByText("Introduction")).toBeVisible({ timeout: 10_000 });

  await tauriPage.click('[aria-label="Switch to source view"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator(".cm-content")).toContainText("Introduction");
});

test("toggling into WYSIWYG shows parsed markdown content, editing round-trips back to source", async ({
  tauriPage,
}) => {
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank-markdown"]');
  await tauriPage.fill("#new-project-name", "E2E MD Doc");
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await tauriPage.click('[aria-label="Switch to WYSIWYG view"]');
  await expect(tauriPage.getByText("Untitled Markdown Document")).toBeVisible({ timeout: 10_000 });

  await tauriPage.click('[aria-label="Switch to source view"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator(".cm-content")).toContainText("Untitled Markdown Document");
});
