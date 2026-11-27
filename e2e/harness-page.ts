import { expect, type Page } from "@playwright/test";

const BASE_URL = process.env.OLEAFLY_BROWSER_TEST_URL ?? "http://localhost:1420";

export async function openHarnessPage(
  page: Page,
  harness: string,
  query: string,
  size: { width: number; height: number },
) {
  await page.setViewportSize(size);
  await page.goto(`${BASE_URL}/e2e/${harness}.html?${query}`);
  await expect(page.locator("body")).toHaveAttribute("data-fixture-state", "mounted");
}

export async function harnessCalls(page: Page, command: string): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (name) =>
      (window as unknown as { __calls: { command: string; args: Record<string, unknown> }[] }).__calls
        .filter((call) => call.command === name)
        .map((call) => call.args),
    command,
  );
}
