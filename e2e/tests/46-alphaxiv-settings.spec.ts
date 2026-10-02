import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect, reloadNativePage } from "../fixtures";
import { openSettings, waitLong } from "../helpers";

const reload = (page: unknown) => reloadNativePage(page as TauriPage);

// The bridge's getByText(...).click() dispatches a raw el.click() with no
// preceding pointerdown/focus, which Radix Tabs sometimes fails to commit as
// a real activation (confirmed via an isolated component repro: identical
// synthetic click behavior left Tabs.Root's value unchanged). Keyboard
// activation goes through Radix's own roving-tabindex handling instead,
// which is reliable - the same pattern already used for the zoom menu in
// 17-preview-controls.spec.ts.
async function openAlphaXivTab(page: import("../helpers").Page) {
  const tab = page.locator('[data-testid="integrations-tab-alphaxiv"]');
  await tab.focus();
  await tab.press("Enter");
}

test("a key alphaXiv does not accept is explained and never saved", async ({ tauriPage }) => {
  const sectionSelector = '[data-testid="alphaxiv-section"]';
  const keyInputSelector = `${sectionSelector} [aria-label="alphaXiv API key"]`;

  await openSettings(tauriPage, "integrations");
  await openAlphaXivTab(tauriPage);
  await waitLong(tauriPage, `!!document.querySelector(${JSON.stringify(keyInputSelector)})`, 10_000);

  await tauriPage.fill(keyInputSelector, "e2e-not-a-real-alphaxiv-key");
  await tauriPage.evaluate(
    `document.querySelector(${JSON.stringify(`${sectionSelector} form`)})?.requestSubmit()`,
  );
  await waitLong(
    tauriPage,
    `!!document.querySelector(${JSON.stringify(`${sectionSelector} [role="alert"]`)})`,
    60_000,
  );
  const alert = await tauriPage.evaluate<string>(
    `document.querySelector(${JSON.stringify(`${sectionSelector} [role="alert"]`)})?.textContent ?? ""`,
  );
  expect(alert).toContain("did not accept this key");
  expect(
    await tauriPage.evaluate<boolean>(
      `!!document.querySelector(${JSON.stringify(`${sectionSelector} [data-testid="alphaxiv-connected"]`)})`,
    ),
  ).toBe(false);

  await reload(tauriPage);
  await openSettings(tauriPage, "integrations");
  await openAlphaXivTab(tauriPage);
  await waitLong(tauriPage, `!!document.querySelector(${JSON.stringify(keyInputSelector)})`, 40_000);
  expect(
    await tauriPage.evaluate<boolean>(
      `!!document.querySelector(${JSON.stringify(`${sectionSelector} [data-testid="alphaxiv-connected"]`)})`,
    ),
  ).toBe(false);
});

test("the key hint links to alphaXiv and its MCP server docs", async ({ tauriPage }) => {
  await openSettings(tauriPage, "integrations");
  await openAlphaXivTab(tauriPage);
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="alphaxiv-section"] a')`,
    10_000,
  );
  const hrefs = await tauriPage.evaluate<string[]>(
    `Array.from(document.querySelectorAll('[data-testid="alphaxiv-section"] a')).map(a => a.href)`,
  );
  expect(hrefs).toContain("https://www.alphaxiv.org/");
  expect(hrefs).toContain("https://www.alphaxiv.org/docs/mcp");
  expect(hrefs.some((h) => h.includes("@api-key"))).toBe(false);
});
