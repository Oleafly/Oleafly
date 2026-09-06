import { test, expect } from "../fixtures";
import { openProject, openRailTab } from "../helpers";

test.beforeEach(async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
});

test("project search tab opens the search panel", async ({ tauriPage }) => {
  await openRailTab(tauriPage, "Search Project");
  await expect(tauriPage.locator('input[placeholder="Find in project…"]')).toBeVisible();
});

test("AI tab opens the chat panel", async ({ tauriPage }, testInfo) => {
  await openRailTab(tauriPage, "Research Assistant");
  // Hermetic runs have no AI provider configured, so the connect prompt shows
  // instead of the chat input.
  try {
    await expect(tauriPage.getByText("Connect an AI provider")).toBeVisible();
  } catch (error) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        tauriPage.evaluate(`(() => {
          const describe = (el) => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return {
              tag: el.tagName, id: el.id, testId: el.getAttribute('data-testid'),
              label: el.getAttribute('aria-label'), hidden: el.hidden,
              ariaHidden: el.getAttribute('aria-hidden'), inert: el.inert,
              display: style.display, visibility: style.visibility, opacity: style.opacity,
              overflow: style.overflow, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          };
          const selectors = ['[data-testid="rail-assistant-toggle"]', '[data-testid="research-assistant"]', '[data-tour="ai-assistant"]', '[data-testid="ai-provider-loading"]', '[data-tour="ai-connect-provider"]'];
          const nodes = [...document.querySelectorAll(selectors.join(',')), ...Array.from(document.querySelectorAll('*')).filter(el => !el.children.length && el.textContent.includes('Connect an AI provider'))];
          return {
            readyState: document.readyState,
            selectedRuntime: document.querySelector('[aria-label="Assistant runtime"] [aria-pressed="true"]')?.textContent,
            togglePressed: document.querySelector(selectors[0])?.getAttribute('aria-pressed'),
            visibleText: document.body.innerText.slice(0, 6000),
            nodes: nodes.map(el => {
              const ancestors = [];
              for (let parent = el.parentElement; parent && ancestors.length < 12; parent = parent.parentElement) ancestors.push(describe(parent));
              return { ...describe(el), ready: el.getAttribute('data-tour-ready'), configured: el.getAttribute('data-tour-configured'), configError: el.getAttribute('data-tour-config-error'), ancestors };
            }),
          };
        })()`).then((data) => testInfo.attach("assistant-panel-state", {
          body: JSON.stringify(data, null, 2), contentType: "application/json",
        })),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, 1500); }),
      ]);
    } catch {
    } finally {
      clearTimeout(timer);
    }
    throw error;
  }
});

test("preflight and git tabs are present for a LaTeX project", async ({ tauriPage }) => {
  // The view switchers live in the sidebar bar, which renders while the sidebar
  // is open; open it first, then assert the switchers are present.
  await openRailTab(tauriPage, "Source Tree");
  await expect(tauriPage.locator('[aria-label="Preflight Checks"]')).toBeVisible();
  await expect(tauriPage.locator('[aria-label="Source Control"]')).toBeVisible();
});

test("files tab shows the file tree with main.tex", async ({ tauriPage }) => {
  await openRailTab(tauriPage, "Source Tree");
  await expect(tauriPage.getByText("main.tex")).toBeVisible();
});
