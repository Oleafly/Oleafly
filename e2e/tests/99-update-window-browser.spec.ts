import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

const SKIPPED = ["0.4.2", "0.4.1", "0.4.0", "0.3.13", "0.3.12", "0.3.11", "0.3.10", "0.3.9", "0.3.8", "0.3.7", "0.3.6", "0.3.5", "0.3.4", "0.3.3", "0.3.2"];

async function openHarness(page: Page, query: string, surface = "update-dialog") {
  await page.setViewportSize({ width: 760, height: 800 });
  await page.goto(`${BASE_URL}/e2e/update-window-harness.html?${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
  await expect(page.getByTestId(surface)).toBeVisible();
}

async function timelineVersions(page: Page): Promise<string[]> {
  return page
    .getByTestId("release-timeline-item")
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.version ?? ""));
}

test("lists every skipped release newest first, one more each time the reader nears the end", async ({ page }) => {
  await openHarness(page, "state=available&notes=real&installed=0.3.1");
  const header = page.getByRole("banner");
  await expect(header.getByRole("heading", { name: "Update available" })).toBeVisible();
  await expect(header.getByText("You're on v0.3.1")).toBeVisible();
  await expect(header.getByText("Released yesterday")).toBeVisible();

  const scroll = page.getByTestId("update-notes-scroll");
  await expect.poll(() => timelineVersions(page)).toEqual(["0.4.3", "0.4.2"]);

  const counts: number[] = [];
  for (let step = 0; step < 40; step += 1) {
    if (await page.getByTestId("release-history-end").isVisible()) break;
    const before = (await timelineVersions(page)).length;
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(async () => {
        const after = (await timelineVersions(page)).length;
        return after > before || (await page.getByTestId("release-history-end").isVisible());
      })
      .toBe(true);
    counts.push((await timelineVersions(page)).length - before);
  }

  expect(await timelineVersions(page)).toEqual(["0.4.3", ...SKIPPED]);
  expect(counts.every((added) => added <= 1)).toBe(true);
  await expect(page.getByTestId("release-history-end")).toHaveText("You're on v0.3.1");
});

test("opens links through the app instead of navigating the update window", async ({ page }) => {
  await openHarness(page, "state=available&notes=rich&installed=0.4.2");
  const url = page.url();
  await page.getByRole("link", { name: "architecture notes" }).click();
  await expect(page.getByTestId("harness-events")).toContainText(
    "link https://github.com/Oleafly/Oleafly/blob/main/docs/architecture.md",
  );
  expect(page.url()).toBe(url);
  await page.getByRole("banner").getByRole("button", { name: /v0\.4\.3/ }).click();
  await expect(page.getByTestId("harness-events")).toContainText("release");
});

test("takes the accent colour from the user's setting", async ({ page }) => {
  await openHarness(page, "state=available&notes=real&installed=0.4.2&accent=purple");
  await expect(page.getByRole("button", { name: "Update now" })).toHaveCSS("background-color", "rgb(124, 58, 237)");
  await page.getByRole("button", { name: "accent orange" }).click();
  await expect(page.getByRole("button", { name: "Update now" })).toHaveCSS("background-color", "rgb(234, 88, 12)");
  await page.getByRole("button", { name: "Update now" }).click();
  const indicator = page.getByRole("progressbar").locator(":scope > div");
  await expect(indicator).toHaveCSS("background-color", "rgb(234, 88, 12)");
  await expect(page.getByText("Installing…")).toBeVisible();
});

test("offers a way forward when the install or the earlier notes fail", async ({ page }) => {
  await openHarness(page, "state=error&notes=real&installed=0.4.2");
  await expect(page.getByRole("alert")).toContainText("The update could not finish");
  await expect(page.getByTestId("update-error-details")).toContainText("connection reset by peer");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("update-dialog")).toHaveAttribute("data-phase", "available");

  await openHarness(page, "state=available&notes=none&installed=0.3.1&history=fail");
  await expect(page.getByText("Couldn't load earlier release notes.")).toBeVisible();
  await page.getByRole("button", { name: "history fails" }).click();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => timelineVersions(page)).toContain("0.4.2");
});

test("the changelog shows every release newest first and says where the user is", async ({ page }) => {
  await openHarness(page, "view=changelog&installed=0.4.2", "changelog");
  const status = page.getByTestId("changelog-status");
  await expect(status).toContainText("You're on v0.4.2");
  await expect(status).toContainText("Update available");
  await expect(status).toContainText("v0.4.3");
  await expect(page.getByTestId("installed-release")).toHaveCount(1);
  await expect(page.locator('[data-testid="release-timeline-item"][data-installed="true"]')).toHaveAttribute(
    "data-version",
    "0.4.2",
  );
  await page.getByRole("button", { name: "Update now" }).click();
  await expect(page.getByTestId("harness-events")).toContainText("update");

  const scroll = page.getByTestId("changelog-scroll");
  for (let step = 0; step < 40; step += 1) {
    const versions = await timelineVersions(page);
    if (versions.at(-1) === "0.3.2") break;
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(async () => {
        const after = await timelineVersions(page);
        return after.length > versions.length || after.at(-1) === "0.3.2";
      })
      .toBe(true);
  }
  expect(await timelineVersions(page)).toEqual(["0.4.3", ...SKIPPED]);

  await page.getByRole("button", { name: "installed 0.4.3" }).click();
  await expect(status).toContainText("You're up to date");
  await expect(page.getByRole("button", { name: "Update now" })).toHaveCount(0);
});
