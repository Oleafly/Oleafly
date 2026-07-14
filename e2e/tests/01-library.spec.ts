import { test, expect } from "../fixtures";
import { openGallery } from "../helpers";

test("app launches to the library", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
});

test("template gallery opens with template cards and closes", async ({ tauriPage }) => {
  await openGallery(tauriPage);
  await expect(tauriPage.getByTestId("template-gallery")).toBeVisible();
  await expect(tauriPage.getByTestId("template-card-blank")).toBeVisible();
  await expect(tauriPage.getByTestId("template-card-ieee")).toBeVisible();
  await tauriPage.click('[data-testid="template-gallery"] [aria-label="Close"]');
  await expect(tauriPage.getByTestId("template-gallery")).toBeHidden();
});
