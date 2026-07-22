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
  await tauriPage.click('[data-testid="open-deadlines"]');
  await expect(tauriPage.locator('[data-testid="deadlines-view"]')).toBeVisible({
    timeout: 20_000,
  });
  await tauriPage.click('[data-testid="deadlines-refresh"]');
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="deadline-card-aaai33"]')`,
    30_000,
  );
  const card = await tauriPage.evaluate<string>(
    `document.querySelector('[data-testid="deadline-card-aaai33"]')?.textContent ?? ""`,
  );
  expect(card).toContain("AAAI 2033");
  expect(card).toContain("A*");
  expect(card).toMatch(/\d+d : \d+h : \d+m : \d+s/);
  // sub filter narrows to the SE venue only
  await tauriPage.click('[data-testid="deadlines-sub-SE"]');
  await waitLong(
    tauriPage,
    `!document.querySelector('[data-testid="deadline-card-aaai33"]') && !!document.querySelector('[data-testid="deadline-card-icse33"]')`,
    10_000,
  );
  // search works across the full name
  await tauriPage.click('[data-testid="deadlines-sub-SE"]');
  await tauriPage.fill('[data-testid="deadlines-search"]', "neural information");
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="deadline-card-aaai33"]') && !document.querySelector('[data-testid="deadline-card-icse33"]')`,
    10_000,
  );
});
