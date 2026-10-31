import type { TauriPage } from "@srsholmes/tauri-playwright";
import { test, expect } from "../fixtures";
import { finishProjectCreation, openGallery, openSettings, waitLong } from "../helpers";
import {
  CJK_TEMPLATE_ID,
  CJK_TEMPLATE_NAME,
  MANY_PACK_ID,
  MANY_PACK_TEMPLATES,
  startPackFixtureServer,
} from "../pack-fixture-server";
import { scriptValue } from "../script-value";
import {
  type ScrollDirection,
  type ScrollStep,
  scrollScript,
  type WindowedList,
} from "../windowed-list";

// The Rust side fetches the catalog from OLEAFLY_PACKS_BASE_URL, which
// scripts/e2e.sh points at the fixed fixture port before the app starts.
// Pack management now lives in Settings -> Downloads (moved out of
// the template gallery in the home-shell redesign), which is an "Advanced"
// settings section: its nav entry only renders once Advanced is toggled on.

let server: Awaited<ReturnType<typeof startPackFixtureServer>>;
let manyPackInstalled = false;

test.beforeAll(async () => {
  server = await startPackFixtureServer();
});
test.afterAll(async () => {
  await server?.close();
});
test.afterEach(async ({ tauriPage }) => {
  if (!manyPackInstalled) return;
  manyPackInstalled = false;
  await tauriPage
    .evaluate(
      `import("/src/lib/tauri.ts").then((api) => api.removeTemplatePack(${scriptValue(MANY_PACK_ID)})).then(() => true, () => false)`,
    )
    .catch(() => false);
});

async function openTemplatePacks(tauriPage: TauriPage) {
  await openSettings(tauriPage);
  const downloadsNav = tauriPage.locator('[data-testid="settings-section-downloads"]');
  if (!(await downloadsNav.isVisible())) {
    await tauriPage.click('[data-testid="settings-toggle-advanced"]');
  }
  await expect(downloadsNav).toBeVisible({ timeout: 10_000 });
  await openSettings(tauriPage, "downloads");
  const templatesTab = tauriPage.locator('[data-testid="downloads-tab-templates"]');
  await templatesTab.focus();
  await templatesTab.press("Enter");
  await tauriPage.click('[data-testid="packs-refresh"]');
  await expect(tauriPage.locator('[data-testid="pack-row-fixture-pack"]')).toBeVisible({
    timeout: 30_000,
  });
}

const MAX_SCROLL_STEPS = 400;

const GALLERY: WindowedList = {
  label: "new-project gallery",
  scroller: '[data-tour="project-template-list"]',
  alive: '[data-testid="template-gallery"][data-tour-stage="templates"]',
  cards: '[data-testid^="template-card-"]',
  maxCards: 40,
};

const PACK_GRID: WindowedList = {
  label: "pack template grid",
  scroller: '[data-testid="pack-template-grid"]',
  scrollParentOf: true,
  alive: `[data-testid="pack-view-${MANY_PACK_ID}"]`,
  cards: '[data-testid="pack-template-grid"] > [data-row-window-item]',
  maxCards: 120,
};

async function scrollWindowedList(
  page: TauriPage,
  list: WindowedList,
  {
    from = "top",
    directions = ["down", "up"],
  }: Readonly<{ from?: "top" | "here"; directions?: readonly ScrollDirection[] }> = {},
): Promise<ScrollStep[]> {
  const seen: ScrollStep[] = [];
  const check = (step: ScrollStep, where: string) => {
    expect(
      step.found && step.alive,
      `${list.label} closed while scrolling ${where} (scrollTop ${step.top} of ${step.max})`,
    ).toBe(true);
    expect(step.cards, `${list.label} mounted no cards ${where} at scrollTop ${step.top}`).toBeGreaterThan(0);
    expect(
      step.cards,
      `${list.label} mounted ${step.cards} cards ${where} at scrollTop ${step.top}`,
    ).toBeLessThanOrEqual(list.maxCards);
    seen.push(step);
  };
  const [start] = await page.evaluate<ScrollStep[]>(scrollScript(list, from));
  check(start, from === "top" ? "after returning to the top" : "before scrolling");
  for (const direction of directions) {
    let taken = 0;
    for (;;) {
      const steps = await page.evaluate<ScrollStep[]>(scrollScript(list, direction));
      expect(
        Array.isArray(steps) && steps.length > 0,
        `${list.label} returned no scroll state while scrolling ${direction}`,
      ).toBe(true);
      for (const step of steps) check(step, direction);
      taken += steps.length;
      if (steps[steps.length - 1].end) break;
      expect(
        taken,
        `${list.label} never reached the ${direction === "down" ? "bottom" : "top"}`,
      ).toBeLessThan(MAX_SCROLL_STEPS);
    }
  }
  return seen;
}

function mountedIds(steps: readonly ScrollStep[]): Set<string> {
  return new Set(steps.flatMap((step) => step.ids));
}

function cardsExpression(list: WindowedList, predicate: string): string {
  return `(() => {
    const cards = [...document.querySelectorAll(${scriptValue(list.cards)})];
    return cards.length > 0 && ${predicate};
  })()`;
}

test("a pack opens to a preview of each template and installs one on its own", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await openTemplatePacks(tauriPage as TauriPage);

  await tauriPage.click('[data-testid="pack-open-fixture-pack"]');
  await expect(tauriPage.locator('[data-testid="pack-template-fixture-letter"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(tauriPage.locator('[data-testid="pack-template-fixture-article"]')).toBeVisible();
  await tauriPage.click('[data-testid="pack-template-fixture-letter"] button');
  await expect(tauriPage.locator('[data-testid="template-preview"]')).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator('[data-testid="template-preview-get"]')).toBeEnabled();

  await tauriPage.click('[data-testid="template-preview-get"]');
  await expect(tauriPage.locator('[data-testid="template-preview-use"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(tauriPage.locator('[data-testid="pack-view-install-fixture-pack"]')).toBeVisible();

  await tauriPage.click('[data-testid="template-preview-use"]');
  await expect(tauriPage.locator("#new-project-name")).toBeVisible({ timeout: 20_000 });
  await tauriPage.fill("#new-project-name", "Pack Letter");
  await finishProjectCreation(tauriPage);
});

test("a downloaded template with a Korean name opens in the gallery, which scrolls end to end", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  const page = tauriPage as TauriPage;
  await openTemplatePacks(page);

  await page.click('[data-testid="pack-open-fixture-pack"]');
  const card = page.locator(`[data-testid="pack-template-${CJK_TEMPLATE_ID}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(CJK_TEMPLATE_NAME);
  await page.click(`[data-testid="pack-template-${CJK_TEMPLATE_ID}"] button`);
  const preview = page.locator('[data-testid="template-preview"]');
  await expect(preview).toBeVisible({ timeout: 10_000 });
  await expect(preview).toContainText(CJK_TEMPLATE_NAME);
  const get = page.locator('[data-testid="template-preview-get"]');
  if (await get.isVisible()) {
    await expect(get).toBeEnabled();
    await page.click('[data-testid="template-preview-get"]');
  }
  await expect(page.locator('[data-testid="template-preview-use"]')).toBeVisible({
    timeout: 30_000,
  });

  await page.click('[data-testid="template-preview-use"]');
  await expect(page.locator("#new-project-name")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="template-gallery"]')).toContainText(CJK_TEMPLATE_NAME);
  await page.click('[data-tour="project-dialog-back"]');
  await expect(page.locator(GALLERY.alive)).toBeVisible({ timeout: 20_000 });
  await waitLong(page, cardsExpression(GALLERY, "true"), 20_000);

  const steps = await scrollWindowedList(page, GALLERY);
  expect(
    mountedIds(steps).has(`template-card-${CJK_TEMPLATE_ID}`),
    "the gallery never showed the downloaded template while scrolling",
  ).toBe(true);
});

test("installing a pack adds its templates to the gallery", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await openTemplatePacks(tauriPage as TauriPage);

  await tauriPage.click('[data-testid="pack-install-fixture-pack"]');
  await expect(tauriPage.locator('[data-testid="pack-remove-fixture-pack"]')).toBeVisible({
    timeout: 30_000,
  });
  await tauriPage.click('[aria-label="Close settings"]');

  await openGallery(tauriPage);
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="template-card-fixture-article"]')`,
    20_000,
  );
  await tauriPage.click('[data-testid="template-card-fixture-article"]');
  await tauriPage.fill("#new-project-name", "Pack Doc");
  await finishProjectCreation(tauriPage);
});

test("600 templates named in mixed scripts scroll in the gallery and the pack browser", async ({ tauriPage }) => {
  test.setTimeout(480_000);
  const page = tauriPage as TauriPage;
  await openTemplatePacks(page);

  const row = page.locator(`[data-testid="pack-row-${MANY_PACK_ID}"]`);
  const remove = page.locator(`[data-testid="pack-remove-${MANY_PACK_ID}"]`);
  await expect(row).toBeVisible({ timeout: 30_000 });
  manyPackInstalled = true;
  if (!(await remove.isVisible())) {
    await page.click(`[data-testid="pack-install-${MANY_PACK_ID}"]`);
  }
  await expect(remove).toBeVisible({ timeout: 180_000 });
  await page.click('[aria-label="Close settings"]');

  await openGallery(page);
  await waitLong(page, cardsExpression(GALLERY, "true"), 20_000);
  const galleryIds = mountedIds(await scrollWindowedList(page, GALLERY));
  expect(
    MANY_PACK_TEMPLATES.filter((template) => !galleryIds.has(`template-card-${template.id}`)).map(
      (template) => template.id,
    ),
    "pack templates the gallery never showed while scrolling",
  ).toEqual([]);

  await page.click('[data-testid="open-template-downloads"]');
  await expect(row).toBeVisible({ timeout: 30_000 });
  await page.click(`[data-testid="pack-open-${MANY_PACK_ID}"]`);
  await expect(page.locator(PACK_GRID.alive)).toBeVisible({ timeout: 30_000 });
  await waitLong(page, cardsExpression(PACK_GRID, "true"), 30_000);
  const packIds = mountedIds(await scrollWindowedList(page, PACK_GRID, { directions: ["down"] }));
  expect(
    MANY_PACK_TEMPLATES.filter((template) => !packIds.has(`pack-template-${template.id}`)).map(
      (template) => template.id,
    ),
    "templates the pack browser never showed while scrolling",
  ).toEqual([]);

  await page.fill('[data-testid="pack-templates-search"]', "大学");
  await waitLong(
    page,
    cardsExpression(PACK_GRID, `cards.every((card) => (card.textContent ?? "").includes("大学"))`),
    20_000,
  );
  const filtered = await scrollWindowedList(page, PACK_GRID, {
    from: "here",
    directions: ["up", "down"],
  });
  expect(
    filtered.flatMap((step) => step.texts).filter((text) => !text.includes("大学")),
    "cards outside the search results while the search was active",
  ).toEqual([]);

  await page.fill('[data-testid="pack-templates-search"]', "");
  await waitLong(
    page,
    cardsExpression(PACK_GRID, `cards.some((card) => !(card.textContent ?? "").includes("大学"))`),
    20_000,
  );
  await scrollWindowedList(page, PACK_GRID, { from: "here" });
});
