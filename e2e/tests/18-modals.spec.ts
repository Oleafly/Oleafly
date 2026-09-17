import { test, expect } from "../fixtures";
import {
  chooseCommandPaletteItem,
  createBlankProject,
  fillCommandPalette,
  openProject,
  openSettings,
  pressGlobal,
  chooseProjectKind,
} from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  const projectExists = await tauriPage.evaluate<boolean>(
    `document.querySelector(${JSON.stringify('button[aria-label="Open E2E Doc"]')}) !== null`,
  );
  if (projectExists) await openProject(tauriPage, "E2E Doc");
  else await createBlankProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test("settings and template modals close through user interactions and restore focus", async ({ tauriPage }) => {
  await tauriPage.click('[aria-label="Home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.focus('[data-testid="new-project"]');
  await expect(tauriPage.locator('[data-testid="new-project"]')).toBeFocused();
  await tauriPage.click('[data-testid="new-project"]');
  // Creating a project opens the chooser first.
  await expect(tauriPage.getByTestId("project-kind-chooser")).toBeVisible();
  // The bridge's synthetic Escape never reaches this dialog's own keydown
  // listener, so close it the way a reader would: with its Close button.
  await tauriPage.evaluate(
    `[...document.querySelectorAll('[data-testid="project-kind-chooser"] button')]
      .find((button) => button.textContent?.trim() === "Close")?.click()`,
  );
  // Radix keeps the content mounted through its exit animation, so wait for the
  // state it reports rather than for the node to disappear. Focus restore is
  // asserted on the gallery below, which closes from a real key press.
  await tauriPage.waitForFunction(
    `document.querySelector('[data-testid="project-kind-chooser"]')?.getAttribute("data-state") !== "open"`,
    5_000,
  );

  await tauriPage.click('[data-testid="new-project"]');
  await chooseProjectKind(tauriPage, "template");
  await expect(tauriPage.getByTestId("template-gallery")).toBeVisible();
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.getByTestId("template-gallery")).not.toBeVisible();
  await expect(tauriPage.locator('[data-testid="new-project"]')).toBeFocused();

  await tauriPage.focus('[aria-label="Settings"]');
  await expect(tauriPage.locator('[aria-label="Settings"]')).toBeFocused();
  await tauriPage.click('[aria-label="Settings"]');
  await expect(tauriPage.locator('[aria-label="Close settings"]')).toBeVisible();
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.locator('[aria-label="Close settings"]')).not.toBeVisible();
  await expect(tauriPage.locator('[aria-label="Settings"]')).toBeFocused();
});

test("project info modal opens from the word-count palette command and closes", async ({
  tauriPage,
}) => {
  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "word"); // cmdk matches single terms
  await tauriPage.press("[cmdk-input]", "Enter");
  const projectInfo = tauriPage.locator(
    '[role="dialog"][aria-labelledby="project-info-title"]',
  );
  await expect(projectInfo).toBeVisible();
  await expect(tauriPage.getByText("Project info", { exact: true })).toBeVisible();
  await tauriPage.getByText("Close", { exact: true }).click();
  await expect(projectInfo).not.toBeVisible();
});

test("history command reveals Source Control Graph while Versioning stays checkpoints-only", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "k", { meta: true });
  await fillCommandPalette(tauriPage, "history");
  await chooseCommandPaletteItem(tauriPage, "Git history");
  try {
    await tauriPage.waitForFunction(
      `document.querySelector('[aria-label="Source Control"]')?.getAttribute('aria-current') === 'page'`,
      10_000,
    );
  } catch (error) {
    const snapshot = await tauriPage.evaluate<string>(
      `Promise.all([
        import("/src/store/settings.ts").then(({ useSettingsStore }) => {
          const state = useSettingsStore.getState();
          return { railTab: state.railTab, showTree: state.showTree, paletteOpen: state.paletteOpen };
        }),
        Promise.resolve({
          activeRail: Array.from(document.querySelectorAll('[aria-current="page"]'))
            .map((element) => element.getAttribute("aria-label")),
          sourcePresent: !!document.querySelector('[aria-label="Source Control"]'),
          paletteVisible: Array.from(document.querySelectorAll('[cmdk-input]')).some(
            (element) => element.getClientRects().length > 0,
          ),
        }),
      ]).then(([store, dom]) => JSON.stringify({ store, dom }))`,
    );
    throw new Error(`Git history command did not reveal Source Control: ${snapshot}`, {
      cause: error,
    });
  }
  await tauriPage.waitForFunction(
    `!!document.querySelector('[data-testid="source-control-graph"]') ||
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent.trim() === "Initialize Repository"
      )`,
    15_000,
  );
  const hasGraph = await tauriPage.evaluate<boolean>(
    `!!document.querySelector('[data-testid="source-control-graph"]')`,
  );
  if (!hasGraph) {
    await tauriPage.getByText("Initialize Repository", { exact: true }).click();
  }
  await expect(tauriPage.getByTestId("source-control-graph")).toBeVisible({ timeout: 10_000 });
  await expect(
    tauriPage.locator(
      '[data-testid="source-control-graph"] button[aria-controls="source-control-graph-content"]',
    ),
  ).toHaveAttribute("aria-expanded", "true");

  await tauriPage.click('[aria-label="Versioning"]');
  await expect(tauriPage.getByTestId("versioning-panel-checkpoints")).toBeVisible({
    timeout: 10_000,
  });
  await expect(tauriPage.getByTestId("versioning-tab-git")).toHaveCount(0);
  await tauriPage.click('[aria-label="Close versioning"]');
});

test("Help and About is available from Settings", async ({ tauriPage }) => {
  await openSettings(tauriPage, "help");
  await expect(tauriPage.getByTestId("about-oleafly-section")).toBeVisible();
  await expect(tauriPage.getByText("Discord", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Follow releases and development")).toBeVisible();
  await tauriPage.click('[aria-label="Close settings"]');
});

test("shortcuts reference filters as you search", async ({ tauriPage }) => {
  await pressGlobal(tauriPage, "/", { meta: true });
  await expect(tauriPage.getByText("Keyboard Shortcuts")).toBeVisible();
  await tauriPage.fill('input[placeholder="Search shortcuts…"]', "recompile");
  await expect(tauriPage.getByText("Recompile")).toBeVisible();
  await tauriPage.fill('input[placeholder="Search shortcuts…"]', "zzzznothing");
  await expect(tauriPage.getByText("No shortcuts found.")).toBeVisible();
});
