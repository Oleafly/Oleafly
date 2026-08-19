import {
  reloadNativePage,
  tourExpect as expect,
  tourTest as test,
} from "../fixtures";
import {
  createBlankProject,
  openProject,
  openRailTab,
  openSettings,
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

interface ProjectHandoffSnapshot {
  tourTitleVisible: boolean;
  toolbarVisible: boolean;
  projectId: string | null;
  projectName: string | null;
  publishedProjectIds: string[] | null;
  projectListError: string | null;
  appLog: string | null;
  appLogError: string | null;
  createButtonConnected: boolean;
  createButtonVisible: boolean;
  createButtonEnabled: boolean;
  wizardStage: string | null;
  alerts: string[];
}

async function projectHandoffSnapshot(
  page: Page,
  projectName: string,
  attemptToken: string,
  includeProjects = false,
): Promise<ProjectHandoffSnapshot> {
  return page.evaluate<ProjectHandoffSnapshot>(
    `(async () => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement) || element.getClientRects().length === 0) {
          return false;
        }
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
      };
      const createButton = document.querySelector(
        '[data-e2e-create-attempt=${JSON.stringify(attemptToken)}]'
      );
      const toolbar = document.querySelector('[data-tour="project-toolbar"]');
      const tourTitleVisible = [...document.querySelectorAll("#react-joyride-portal h2")]
        .some((element) => visible(element) && element.textContent?.trim() === "Project toolbar");
      const files = await import("/src/store/files.ts");
      const fileState = files.useFilesStore.getState();
      let publishedProjectIds = null;
      let projectListError = null;
      let appLog = null;
      let appLogError = null;
      if (${includeProjects}) {
        const api = await import("/src/lib/tauri.ts");
        try {
          publishedProjectIds = (await api.listProjects())
            .filter((project) => project.name === ${JSON.stringify(projectName)})
            .map((project) => project.id);
        } catch (error) {
          projectListError = String(error);
        }
        try {
          appLog = await api.readAppLog(16 * 1024);
        } catch (error) {
          appLogError = String(error);
        }
      }
      return {
        tourTitleVisible,
        toolbarVisible: visible(toolbar),
        projectId: fileState.projectId,
        projectName: fileState.projectName,
        publishedProjectIds,
        projectListError,
        appLog,
        appLogError,
        createButtonConnected: Boolean(createButton?.isConnected),
        createButtonVisible: visible(createButton),
        createButtonEnabled:
          createButton instanceof HTMLButtonElement && !createButton.disabled,
        wizardStage:
          document.querySelector('[data-tour="project-template-gallery"]')
            ?.getAttribute("data-tour-stage") ?? null,
        alerts: [...document.querySelectorAll('[role="alert"]')]
          .filter(visible)
          .map((element) => element.textContent?.trim() ?? "")
          .filter(Boolean),
      };
    })()`,
  );
}

async function createProjectAndWaitForWorkspaceTour(page: Page, projectName: string) {
  const attemptToken = `tour-create-${Date.now().toString(36)}`;
  const resolved = await page.evaluate<{ liveCount: number; buttonCount: number }>(
    `(() => {
      const visible = (element) => {
        if (!(element instanceof HTMLElement) || element.getClientRects().length === 0) {
          return false;
        }
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
      };
      const buttons = [...document.querySelectorAll('[data-tour="create-project"]')];
      const live = buttons.filter(
        (button) =>
          visible(button) &&
          button instanceof HTMLButtonElement &&
          !button.disabled
      );
      if (live.length === 1) {
        live[0].dataset.e2eCreateAttempt = ${JSON.stringify(attemptToken)};
      }
      return { liveCount: live.length, buttonCount: buttons.length };
    })()`,
  );
  if (resolved.liveCount !== 1) {
    throw new Error(
      `Expected one live create-project button, found ${resolved.liveCount} live / ${resolved.buttonCount} total`,
    );
  }

  const selector = `[data-e2e-create-attempt="${attemptToken}"]`;
  await page.locator(selector).click();

  const startedAt = Date.now();
  const deadline = startedAt + 30_000;
  let retriedDroppedClick = false;
  let last = await projectHandoffSnapshot(page, projectName, attemptToken);
  while (Date.now() < deadline) {
    if (last.tourTitleVisible) return;
    if (last.alerts.length > 0) {
      // notifyError persists the underlying command error asynchronously.
      // Give that diagnostic invoke a short opportunity to finish before
      // collecting the state that will be attached to a CI failure.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const diagnostic = await projectHandoffSnapshot(
        page,
        projectName,
        attemptToken,
        true,
      );
      throw new Error(`Project creation reported an error: ${JSON.stringify(diagnostic)}`);
    }

    const projectOpened =
      Boolean(last.projectId) || last.toolbarVisible;
    if (
      !retriedDroppedClick &&
      !projectOpened &&
      Date.now() - startedAt >= 1_000 &&
      last.createButtonConnected &&
      last.createButtonVisible &&
      last.createButtonEnabled
    ) {
      const checked = await projectHandoffSnapshot(
        page,
        projectName,
        attemptToken,
        true,
      );
      const projectPublished = (checked.publishedProjectIds?.length ?? 0) > 0;
      if (
        !checked.projectId &&
        !checked.toolbarVisible &&
        checked.alerts.length === 0 &&
        !projectPublished &&
        checked.projectListError === null &&
        checked.createButtonConnected &&
        checked.createButtonVisible &&
        checked.createButtonEnabled
      ) {
        // The bridge acknowledged the first command but the exact same button
        // is still live and neither the store nor disk saw a project. Retry
        // this one dropped click; never retry once creation has begun.
        await page.locator(selector).click();
        retriedDroppedClick = true;
      }
      last = checked;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await projectHandoffSnapshot(page, projectName, attemptToken);
  }

  const diagnostic = await projectHandoffSnapshot(
    page,
    projectName,
    attemptToken,
    true,
  );
  throw new Error(
    `Workspace tour did not start after project creation (retriedDroppedClick=${retriedDroppedClick}): ${JSON.stringify(diagnostic)}`,
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
  await tauriPage.click('[data-testid="tour-back"]');
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
  const creamSwatch = tauriPage.locator(
    '[data-tour="project-cover-color"] button[aria-label="Cream"]',
  );
  await creamSwatch.click();
  await expect(creamSwatch).toHaveAttribute("aria-pressed", "true");
  await expect(creamSwatch.locator("svg")).toBeVisible();
  await tauriPage.getByText("Next", { exact: true }).click();
  await createProjectAndWaitForWorkspaceTour(tauriPage, projectName);

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
    settings: "pending",
    diagram: "pending",
  });
  await tauriPage.click('[data-tour="settings"]');
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Settings", {
    timeout: 20_000,
  });
  await tauriPage.waitForFunction(
    `(() => {
      const tooltip = document.querySelector('[data-tour-tooltip="settings-navigation"]');
      if (!tooltip) return false;
      const r = tooltip.getBoundingClientRect();
      return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    })()`,
    20_000,
  );
  await tauriPage.press("body", "Escape");
  await expect(tauriPage.getByText("Quit the tour?")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Cancel", { exact: true }).click();
  await expect(tauriPage.getByText("Quit the tour?")).toBeHidden();
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Settings");
  await tauriPage.getByText("Skip", { exact: true }).click();
  await expect(tauriPage.getByText("Quit the tour?")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Quit tour", { exact: true }).click();
  await expect(tauriPage.locator("#react-joyride-portal")).toHaveCount(0);
  await expect(tauriPage.locator(".react-joyride__overlay")).toHaveCount(0);
  await openSettings(tauriPage, "general");
  await expect(tauriPage.getByText("Enable tour guides", { exact: true })).toBeVisible();

  await tauriPage.click('[aria-label="Enable all tour guides"]');
  await expect(tauriPage.getByText("Disable tour guides?", { exact: true })).toBeVisible();
  await tauriPage.getByText("Cancel", { exact: true }).click();
  await expect(tauriPage.getByText("Disable tour guides?", { exact: true })).toHaveCount(0);

  await tauriPage.click('[aria-controls="tour-guides-panel"]');
  await tauriPage.getByText("Dismiss all tours", { exact: true }).click();
  await expect(tauriPage.getByText("Dismiss all tours?", { exact: true })).toBeVisible();
  await tauriPage.getByText("Dismiss all", { exact: true }).click();
  await expect(
    tauriPage.getByText(`${Object.keys(versions).length} dismissed`, { exact: false }),
  ).toBeVisible();

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
  await openRailTab(tauriPage, "Research Assistant");
  await tauriPage.waitForFunction(
    `document.querySelector("#react-joyride-portal h2")?.textContent === "AI Assistant"`,
    30_000,
  );
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("AI Assistant", {
    timeout: 30_000,
  });
  await tauriPage.waitForFunction(
    `(() => {
      const target = document.querySelector('[data-tour="ai-assistant"]');
      const tooltip = document.querySelector('[data-tour-tooltip="ai-assistant"]');
      if (!(target instanceof HTMLElement) || !(tooltip instanceof HTMLElement)) return false;
      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      return tooltipRect.left >= targetRect.right - 2
        && tooltipRect.top >= 0
        && tooltipRect.right <= window.innerWidth
        && tooltipRect.bottom <= window.innerHeight;
    })()`,
    20_000,
  );
  await tauriPage.getByText("Skip", { exact: true }).click();
  await expect(tauriPage.getByText("Quit the tour?")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Quit tour", { exact: true }).click();

  // The Diagram Composer is a standalone home-shell page now, not a
  // per-project modal, so reaching it means leaving the project first.
  await tauriPage.click('[title="Back to library"]');
  // The dock re-renders while the project list refreshes after leaving a
  // project, and a click landing on a pre-refresh button node is silently
  // dropped. Wait for the loaded library, then probe-and-click atomically,
  // re-clicking until the composer actually mounts.
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
  const composerDeadline = Date.now() + 30_000;
  for (;;) {
    const state = await tauriPage.evaluate<string>(
      `(() => {
        if (document.querySelector('[data-tour="diagram-composer"]')) return "open";
        const button = document.querySelector('[data-testid="open-diagram-composer"]');
        if (button instanceof HTMLElement) {
          button.click();
          return "clicked";
        }
        return "missing";
      })()`,
    );
    if (state === "open") break;
    if (Date.now() > composerDeadline) {
      throw new Error(`Diagram Composer never opened (last state: ${state})`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await expect(tauriPage.locator("#react-joyride-portal h2")).toHaveText("Diagram Composer", {
    timeout: 30_000,
  });
  await expect(tauriPage.locator('[data-tour="diagram-composer"]')).toBeVisible();
  await tauriPage.getByText("Skip", { exact: true }).click();
  await expect(tauriPage.getByText("Quit the tour?")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Quit tour", { exact: true }).click();
  await expect(tauriPage.getByText("Quit the tour?")).toBeHidden();
});

test("AI settings tour walks the tabs with keyboard navigation and Escape confirm", async ({
  tauriPage,
}) => {
  await loadTours(tauriPage, { "ai-settings": "pending" });
  await openSettings(tauriPage, "ai");
  const title = () => tauriPage.locator("#react-joyride-portal h2");
  await expect(title()).toHaveText("AI Assistant settings", { timeout: 30_000 });

  await pressGlobal(tauriPage, "ArrowRight", { meta: true });
  await expect(title()).toHaveText("Connect providers", { timeout: 10_000 });
  await pressGlobal(tauriPage, "ArrowLeft", { meta: true });
  await expect(title()).toHaveText("AI Assistant settings", { timeout: 10_000 });
  await pressGlobal(tauriPage, "ArrowRight", { meta: true });
  await expect(title()).toHaveText("Connect providers", { timeout: 10_000 });
  await pressGlobal(tauriPage, "ArrowRight", { meta: true });
  await expect(title()).toHaveText("Bring your own endpoint", { timeout: 10_000 });

  await pressGlobal(tauriPage, "ArrowRight", { meta: true });
  await expect(title()).toHaveText("Instructions", { timeout: 10_000 });
  await pressGlobal(tauriPage, "ArrowRight", { meta: true });
  await expect(title()).toHaveText("Instructions");

  // A real click (mouse or trusted Enter) fires a native click event; the
  // bridge's synthetic Enter only reaches Radix's keydown handler, which
  // switches the tab without the click the required-click step listens for.
  // The synthetic sequence must include mousedown: Radix activates the tab on
  // mousedown, while the tour's required-click step advances on click.
  await tauriPage.evaluate(
    `(() => {
      const el = document.querySelector('[data-tour="ai-settings-tab-instructions"]');
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1 }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    })()`,
  );
  await expect(title()).toHaveText("Default model", { timeout: 15_000 });

  await pressGlobal(tauriPage, "Escape");
  await expect(tauriPage.getByText("Quit the tour?")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Cancel", { exact: true }).click();
  await expect(tauriPage.getByText("Quit the tour?")).toBeHidden();
  await expect(title()).toHaveText("Default model");

  await pressGlobal(tauriPage, "Escape");
  await expect(tauriPage.getByText("Quit the tour?")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Quit tour", { exact: true }).click();
  await expect(tauriPage.getByText("Quit the tour?")).toBeHidden();
  await tauriPage.waitForFunction(
    `!document.querySelector("#react-joyride-portal h2")`,
    10_000,
  );
  await tauriPage.click('[aria-label="Close settings"]');
});
