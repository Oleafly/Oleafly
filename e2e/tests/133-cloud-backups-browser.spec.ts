import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

async function openHarness(page: Page, query = "") {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`${BASE_URL}/e2e/cloud-backups-harness.html${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
  await expect(page.getByTestId("cloud-backups-summary")).toBeVisible();
}

function calls(page: Page, command: string) {
  return page.evaluate(
    (name) =>
      ((window as unknown as { __calls: { command: string; args: unknown }[] }).__calls ?? [])
        .filter((call) => call.command === name)
        .map((call) => call.args),
    command,
  );
}

async function expand(page: Page) {
  await page.getByRole("button", { name: /^Backups/ }).click();
  await expect(page.getByTestId("cloud-backups-body")).toBeVisible();
}

test("shows the last backup, saves the schedule and lists the backups of every computer", async ({ page }) => {
  await openHarness(page);
  await expect(page.getByTestId("cloud-backups-summary")).toHaveText(/Last backup 2 hours ago · 24 notes · 3\.\d MB/);
  await expand(page);
  await page.getByTestId("cloud-backups-every-trigger").click();
  await page.getByRole("option", { name: "Every week" }).click();
  await expect.poll(() => calls(page, "cloud_backup_set_settings")).toEqual([
    { settings: { auto: true, everyHours: 168, keep: 30, includeProjects: false } },
  ]);
  const rows = page.getByTestId("cloud-backup-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("This computer");
  await expect(rows.nth(1)).toContainText("By hand");
  await expect(rows.nth(2)).toContainText("Office desktop · 21 notes · 2 projects");
});

test("restores what is missing, then a copy of a note that is still here", async ({ page }) => {
  await openHarness(page);
  await expand(page);
  await page.getByTestId("cloud-backup-row").first().getByRole("button", { name: /Restore the backup from/ }).click();
  const dialog = page.getByTestId("cloud-restore-dialog");
  await expect(dialog.getByTestId("cloud-restore-row")).toHaveCount(4);
  await expect(dialog.getByText("Not on this computer")).toHaveCount(2);

  await dialog.getByRole("button", { name: "Restore the 2 missing" }).click();
  await expect(dialog.getByText("Restored", { exact: true })).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "Nothing is missing" })).toBeDisabled();
  expect((await calls(page, "cloud_backup_restore"))[0]).toMatchObject({ items: null, copyLabel: expect.stringMatching(/^\(restored .+\)$/) });

  await dialog.getByRole("button", { name: "Restore Abstract draft" }).click();
  await expect(dialog.getByText("Restored as a copy")).toBeVisible();
  expect((await calls(page, "cloud_backup_restore"))[1]).toMatchObject({ items: ["abstract"] });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("backs up by hand and says when there is nothing yet", async ({ page }) => {
  await openHarness(page, "?empty=1");
  await expect(page.getByTestId("cloud-backups-summary")).toHaveText("No backups yet");
  await page.getByTestId("cloud-backup-now").click();
  await expect(page.getByTestId("cloud-backup-now")).toBeDisabled();
  await expect(page.getByTestId("cloud-backups-summary")).toHaveText(/Last backup (now|0 seconds ago|just now) · 24 notes/);
  expect(await calls(page, "cloud_backup_run")).toEqual([{ scheduled: false }]);
  await expand(page);
  await expect(page.getByText(/No backups in Dropbox yet\./)).toBeVisible();
});

test("fits a narrow settings pane without sideways scrolling", async ({ page }) => {
  await openHarness(page, "?failed=1");
  await page.setViewportSize({ width: 420, height: 900 });
  await expect(page.getByTestId("cloud-backups-error")).toContainText("The last backup didn't finish.");
  await expand(page);
  await page.getByTestId("cloud-backup-row").first().getByRole("button", { name: /Restore the backup from/ }).click();
  await expect(page.getByTestId("cloud-restore-row")).toHaveCount(4);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});
