import {
  reloadNativePage,
  tourExpect as expect,
  tourTest as test,
} from "../fixtures";
import {
  createBlankProject,
  openProject,
  openRailTab,
  pressGlobal,
  type Page,
} from "../helpers";
import { tourRegistry } from "../../src/lib/tours/registry";

const versions = Object.fromEntries(
  Object.entries(tourRegistry).map(([id, definition]) => [id, definition.version]),
) as Record<keyof typeof tourRegistry, number>;

function state(
  enabled: boolean,
  statuses: Partial<Record<keyof typeof versions, "pending" | "completed" | "dismissed">>,
) {
  return JSON.stringify({
    state: {
      schemaVersion: 1,
      enabled,
      tours: Object.fromEntries(
        Object.entries(versions).map(([id, version]) => [
          id,
          { status: statuses[id as keyof typeof versions] ?? "dismissed", version },
        ]),
      ),
    },
    version: 1,
  });
}

async function loadTours(
  page: Page,
  statuses: Partial<Record<keyof typeof versions, "pending" | "completed" | "dismissed">>,
) {
  const stored = state(true, statuses);
  await page.evaluate(
    `(() => {
      localStorage.setItem("oleafly.tours", ${JSON.stringify(stored)});
    })()`,
  );
  await reloadNativePage(page);
}

async function dismissAll(page: Page) {
  const stored = state(false, {});
  await page.evaluate(
    `localStorage.setItem("oleafly.tours", ${JSON.stringify(stored)})`,
  );
}

test.afterEach(async ({ tauriPage }) => {
  await dismissAll(tauriPage);
});

test("welcome is modal and Home creates a real project before Workspace starts", async ({
  tauriPage,
}) => {
  await loadTours(tauriPage, { home: "pending", workspace: "pending" });
  const welcome = tauriPage.getByTestId("tour-welcome");
  await expect(welcome).toBeVisible({ timeout: 30_000 });
  await expect(tauriPage.locator('[data-testid="tour-welcome"] [aria-label*="Close"]')).toHaveCount(0);

  await tauriPage.press('[data-testid="tour-welcome"]', "Escape");
  await expect(welcome).toBeVisible();
  await tauriPage.evaluate(
    `document.querySelector('[data-testid="tour-welcome"]')?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
  );
  await expect(welcome).toBeVisible();

  await tauriPage.getByText("Show me around", { exact: true }).click();
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Home");
  await expect(tauriPage.locator('#react-joyride-portal [aria-label*="Close"]')).toHaveCount(0);
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Home");
  await pressGlobal(tauriPage, "k", { meta: true });
  await expect(tauriPage.locator("[cmdk-dialog]")).toHaveCount(0);

  await tauriPage.getByText("Next", { exact: true }).click();
  await tauriPage.click('[data-tour="new-project"]');
  await expect(tauriPage.getByText("Find your starting point", { exact: true })).toBeVisible();
  await tauriPage.getByText("Back", { exact: true }).click();
  await expect(tauriPage.getByText("Choose a template", { exact: true })).toHaveCount(0);
  await expect(tauriPage.getByText("Create a real project", { exact: true })).toBeVisible();
  await tauriPage.click('[data-tour="new-project"]');
  await expect(tauriPage.getByText("Find your starting point", { exact: true })).toBeVisible();
  await tauriPage.getByText("Next", { exact: true }).click();
  await tauriPage.click('[data-testid="template-card-blank"]');
  await expect(tauriPage.getByText("Name your project", { exact: true })).toBeVisible();

  const projectName = `Tour E2E ${Date.now()}`;
  await tauriPage.click('[data-tour="project-name"]');
  await tauriPage.type('[data-tour="project-name"]', projectName);
  await tauriPage.getByText("Next", { exact: true }).click();
  await expect(tauriPage.getByText("Choose a cover color", { exact: true })).toBeVisible();
  await tauriPage.getByText("Next", { exact: true }).click();
  await tauriPage.click('[data-tour="create-project"]');
  await expect(tauriPage.getByText("Project toolbar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await reloadNativePage(tauriPage);
  await expect(tauriPage.getByTestId("tour-welcome")).toHaveCount(0);
  await openProject(tauriPage, projectName);
  await expect(tauriPage.getByText("Project toolbar", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test("Settings tour remains in the viewport and tour confirmations are atomic", async ({
  tauriPage,
}) => {
  await loadTours(tauriPage, {
    home: "completed",
    workspace: "pending",
    settings: "pending",
  });
  await tauriPage.click('[data-tour="settings"]');
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Settings", {
    timeout: 20_000,
  });
  await tauriPage.waitForFunction(
    `(() => {
      const tooltip = document.querySelector('#react-joyride-portal [role="alertdialog"]');
      if (!tooltip) return false;
      const r = tooltip.getBoundingClientRect();
      return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    })()`,
    20_000,
  );
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Settings");
  await tauriPage.getByText("Skip", { exact: true }).click();
  await expect(tauriPage.locator("#react-joyride-portal")).toHaveCount(0);
  await expect(tauriPage.locator(".react-joyride__overlay")).toHaveCount(0);
  await tauriPage.click('[data-testid="settings-section-general"]');
  await expect(tauriPage.getByText("Enable tour guides", { exact: true })).toBeVisible();

  await tauriPage.click('[aria-label="Enable all tour guides"]');
  await expect(tauriPage.getByText("Disable tour guides?", { exact: true })).toBeVisible();
  await tauriPage.getByText("Cancel", { exact: true }).click();
  await expect(tauriPage.getByText("Disable tour guides?", { exact: true })).toHaveCount(0);

  await tauriPage.click('[aria-controls="tour-guides-panel"]');
  await tauriPage.getByText("Dismiss all tours", { exact: true }).click();
  await expect(tauriPage.getByText("Dismiss all tours?", { exact: true })).toBeVisible();
  await tauriPage.getByText("Dismiss all", { exact: true }).click();
  await expect(tauriPage.getByText("5 dismissed", { exact: false })).toBeVisible();

  await tauriPage.click('[aria-label="Enable all tour guides"]');
  await expect(tauriPage.locator('[aria-label="Close settings"]')).toHaveCount(0);
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Home", {
    timeout: 20_000,
  });
});

test("AI and Diagram tours select their eligible context without sending or compiling", async ({
  tauriPage,
}) => {
  await loadTours(tauriPage, { ai: "pending", diagram: "pending" });
  await createBlankProject(tauriPage, `Tour Context ${Date.now()}`);
  await openRailTab(tauriPage, "Chat / AI Assistant");
  await tauriPage.waitForFunction(
    `document.querySelector("#react-joyride-portal h2")?.textContent === "AI Assistant"`,
    30_000,
  );
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("AI Assistant", {
    timeout: 30_000,
  });
  await tauriPage.getByText("Skip", { exact: true }).click();

  await tauriPage.click('[aria-label="Insert diagram"]');
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Diagram Composer", {
    timeout: 30_000,
  });
  await expect(tauriPage.locator('[data-tour="diagram-composer"]')).toBeVisible();
  await tauriPage.getByText("Skip", { exact: true }).click();
});
