import { test, expect } from "../fixtures";
import { waitLong } from "../helpers";
import { startPackFixtureServer } from "../pack-fixture-server";

let server: Awaited<ReturnType<typeof startPackFixtureServer>>;

test.beforeAll(async () => {
  server = await startPackFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});

test("deadlines view refreshes, counts down, and filters", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]') as Parameters<
      typeof expect
    >[0],
  ).toBeVisible({ timeout: 30_000 });
  await tauriPage.click('[data-testid="open-latex-tools"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await tauriPage.click('[data-testid="latex-tool-card-deadlines"]');
  await expect(tauriPage.locator('[data-testid="deadlines-view"]')).toBeVisible({
    timeout: 20_000,
  });
  await tauriPage.click('[data-testid="deadlines-refresh"]');
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="deadline-card-aaai33"]')`,
    30_000,
  );
  const card = await tauriPage.evaluate<{
    text: string;
    countdown: { unit: string; value: string }[];
  }>(
    `(() => {
      const card = document.querySelector('[data-testid="deadline-card-aaai33"]');
      return {
        text: card?.textContent ?? "",
        countdown: Array.from(
          card?.querySelectorAll("[data-countdown-unit]") ?? [],
        ).map((element) => ({
          unit: element.getAttribute("data-countdown-unit") ?? "",
          value: element.getAttribute("data-countdown-value") ?? "",
        })),
      };
    })()`,
  );
  expect(card.text).toContain("AAAI 2033");
  expect(card.text).toContain("A*");
  expect(card.countdown.map(({ unit }) => unit)).toEqual([
    "days",
    "hours",
    "minutes",
    "seconds",
  ]);
  for (const { value } of card.countdown) {
    expect(value).toMatch(/^\d+$/);
  }
  // sub filter (a Select dropdown, not a toggle button) narrows to the SE venue only
  await tauriPage.click('[aria-label="Filter by research area"]');
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-testid="deadlines-sub-SE"]')`,
    5_000,
  );
  await tauriPage.click('[data-testid="deadlines-sub-SE"]');
  await waitLong(
    tauriPage,
    `!document.querySelector('[data-testid="deadline-card-aaai33"]') && !!document.querySelector('[data-testid="deadline-card-icse33"]')`,
    10_000,
  );
  // reset back to "All" before checking search works across the full name
  await tauriPage.click('[aria-label="Filter by research area"]');
  await tauriPage.getByText("All research areas", { exact: true }).click();
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="deadline-card-aaai33"]')`,
    10_000,
  );
  await tauriPage.fill('[data-testid="deadlines-search"]', "artificial intelligence");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="deadline-card-aaai33"]') && !document.querySelector('[data-testid="deadline-card-icse33"]')`,
    10_000,
  );
});
