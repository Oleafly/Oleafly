import { test, expect } from "../fixtures";
import type { TauriPage } from "@srsholmes/tauri-playwright";
import { createBlankProject, openProject, openSettings } from "../helpers";

async function compileForLibraryPreview(tauriPage: TauriPage) {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");
  await tauriPage.click('[title="Back to library"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 10_000 });
}

test("favorite toggles on a project book", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  // The bookmark control reveals on hover.
  await tauriPage.hover('button[aria-label^="Open "]');
  await tauriPage.click('[aria-label="Add to favorites"]');
  await expect(tauriPage.locator('[aria-label="Remove from favorites"]')).toBeVisible();
  await tauriPage.click('[aria-label="Remove from favorites"]');
  await expect(tauriPage.locator('[aria-label="Add to favorites"]')).toBeVisible();
});

// Regression: the hover preview used to slide in ABOVE the bookmark (its overlay
// z-[15] over the button's z-[12]), hiding it and swallowing the click, so a
// project with a preview could not be bookmarked. The bookmark must stack above
// the decorative overlay. Asserted via computed z-index (static, not hover-gated)
// rather than a click, because the bridge dispatches synthetic clicks that ignore
// occlusion and so cannot observe the stacking bug.
test("the bookmark stacks above the hover preview overlay", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await compileForLibraryPreview(tauriPage);

  // Reveal the preview overlay: it mounts only for a compiled project with the
  // default-on hover-preview setting, and its thumbnail loads on hover.
  await tauriPage.evaluate(
    `(() => {
      const el = Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
        .find((b) => b.textContent.includes('E2E Doc'));
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      return true;
    })()`,
  );
  await tauriPage.waitForFunction(
    `(() => {
      const el = Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
        .find((b) => b.textContent.includes('E2E Doc'));
      return !!el && !!el.querySelector('img[draggable="false"]');
    })()`,
    70_000,
  );

  const stacked = await tauriPage.evaluate<boolean>(
    `(() => {
      const el = Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
        .find((b) => b.textContent.includes('E2E Doc'));
      const btn = el?.parentElement?.querySelector('[aria-label="Add to favorites"], [aria-label="Remove from favorites"]');
      const img = el && el.querySelector('img[draggable="false"]');
      const overlay = img && img.parentElement;
      if (!btn || !overlay) return false;
      const z = (n) => parseInt(getComputedStyle(n).zIndex || '0', 10) || 0;
      return z(btn) > z(overlay);
    })()`,
  );
  expect(stacked).toBe(true);
});

test("fork a project from the context menu", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();

  await tauriPage.evaluate(
    `(() => {
      const books = Array.from(document.querySelectorAll('button[aria-label^="Open "]'));
      const book = books.find(b => b.textContent.includes('E2E Doc'));
      const r = book.getBoundingClientRect();
      book.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2,
      }));
      return 1;
    })()`,
  );
  await expect(tauriPage.getByText("Fork project")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Fork project").click();

  // Give the fork a unique name so re-runs never collide.
  await expect(tauriPage.locator('input[placeholder="New project name"]')).toBeVisible();
  const forkName = `E2E Fork ${Date.now().toString(36)}`;
  await tauriPage.fill('input[placeholder="New project name"]', forkName);
  await tauriPage.getByText("Fork", { exact: true }).click();
  await expect(tauriPage.getByText(forkName)).toBeVisible({ timeout: 20_000 });
});

// Separate test: the fixture's reload between tests clears the re-armed
// Radix context menu from the fork flow (a second right-click in the same
// page would hit the wrong book's menu).
test("delete the forked copy from the context menu", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('button[aria-label^="Open "]')).some(b => b.textContent.includes('E2E Fork'))`,
    60_000,
  );

  // Override the native confirm, but only accept a dialog naming the fork;
  // anything else is a mis-targeted delete. (Comma-expression: evaluate
  // needs a serializable return value.)
  await tauriPage.evaluate(
    `(window.confirm = (msg) => typeof msg === 'string' && msg.includes('E2E Fork'), 1)`,
  );
  await tauriPage.evaluate(
    `(() => {
      const books = Array.from(document.querySelectorAll('button[aria-label^="Open "]'));
      const copy = books.find(b => b.textContent.includes('E2E Fork'));
      const r = copy.getBoundingClientRect();
      copy.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 2,
      }));
      return 1;
    })()`,
  );
  await expect(tauriPage.getByText("Delete project")).toBeVisible({ timeout: 10_000 });
  await tauriPage.getByText("Delete project").click();
  await tauriPage.waitForFunction(
    `!Array.from(document.querySelectorAll('button[aria-label^="Open "]')).some(b => b.textContent.includes('E2E Fork'))`,
    20_000,
  );
});

test("bookmark filter shows only bookmarked projects", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.hover('button[aria-label^="Open "]');
  await tauriPage.click('[aria-label="Add to favorites"]');

  await tauriPage.click('[aria-label="Show bookmarked only"]');
  await tauriPage.waitForFunction(
    `document.querySelectorAll('[aria-label="Remove from favorites"]').length >= 1
      && document.querySelectorAll('[aria-label="Add to favorites"]').length === 0`,
    10_000,
  );

  await tauriPage.click('[aria-label="Remove from favorites"]');
  await expect(tauriPage.getByText("No bookmarks yet")).toBeVisible({ timeout: 5_000 });

  await tauriPage.click('[aria-label="Show bookmarked only"]');
  await tauriPage.waitForFunction(
    `document.querySelectorAll('[aria-label="Add to favorites"]').length >= 1`,
    10_000,
  );
});

test("hovering a compiled project slides in its PDF preview, gated by the setting", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await compileForLibraryPreview(tauriPage);
  const bookFor = (name: string) =>
    `(() => {
      const el = Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
        .find(b => b.textContent.includes(${JSON.stringify(name)}));
      if (!el) return null;
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      return !!el.querySelector('img[draggable="false"]');
    })()`;
  await tauriPage.evaluate(bookFor("E2E Doc"));
  await tauriPage.waitForFunction(
    `(() => {
      const el = Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
        .find(b => b.textContent.includes('E2E Doc'));
      return !!el && !!el.querySelector('img[draggable="false"]');
    })()`,
    20_000,
  );

  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "appearance");
  await tauriPage.click('[role="switch"][aria-label="Preview PDF on hover"]');
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.click('[title="Back to library"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 10_000 });
  await tauriPage.evaluate(bookFor("E2E Doc"));
  await tauriPage.waitForFunction(
    `(() => {
      const el = Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
        .find(b => b.textContent.includes('E2E Doc'));
      return !!el && !el.querySelector('img[draggable="false"]');
    })()`,
    10_000,
  );

  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "appearance");
  await tauriPage.click('[role="switch"][aria-label="Preview PDF on hover"]');
  await tauriPage.click('[aria-label="Close settings"]');
});

test("project details and export history release their modal layers after closing", async ({
  tauriPage,
}) => {
  await createBlankProject(tauriPage, `Modal Layers ${Date.now()}`);
  await tauriPage.click('[title="Back to library"]');
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible();
  const openContextMenu = () =>
    tauriPage.evaluate(
      `(() => {
        const book = document.querySelector('button[aria-label^="Open "]');
        const r = book.getBoundingClientRect();
        book.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, cancelable: true, clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2, button: 2,
        }));
        return true;
      })()`,
    );

  await openContextMenu();
  await expect(tauriPage.getByText("Project details", { exact: true })).toBeVisible();
  await tauriPage.evaluate(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent.includes("Project details")).click()`,
  );
  await expect(
    tauriPage.getByText("Read-only metadata used by project search and filters."),
  ).toBeVisible();
  await tauriPage.getByText("Close", { exact: true }).click();
  await expect(
    tauriPage.getByText("Read-only metadata used by project search and filters."),
  ).toHaveCount(0);

  await openContextMenu();
  await expect(tauriPage.getByText("Export history", { exact: true })).toBeVisible();
  await tauriPage.evaluate(
    `Array.from(document.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent.includes("Export history")).click()`,
  );
  await expect(tauriPage.getByText("Files exported from", { exact: false })).toBeVisible();
  await tauriPage.getByText("Close", { exact: true }).click();
  await expect(tauriPage.getByText("Files exported from", { exact: false })).toHaveCount(0);

  await tauriPage.waitForFunction(`(() => {
    const button = document.querySelector('[data-tour="settings"]');
    if (!button || document.body.style.pointerEvents === "none") return false;
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === button || button.contains(hit);
  })()`);
  await tauriPage.click('[data-tour="settings"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible();
});

test("advanced filters stay open through abandoned select interactions", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.click('[aria-label="Advanced project filters"]');
  await expect(tauriPage.getByText("Advanced filters", { exact: true })).toBeVisible();

  await tauriPage.getByText("All engines", { exact: true }).click();
  await expect(tauriPage.getByRole("listbox")).toBeVisible();
  await tauriPage.click("#project-filter-metadata");
  await expect(tauriPage.getByText("Advanced filters", { exact: true })).toBeVisible();

  await tauriPage.fill("#project-filter-metadata", "E2E Doc");
  await expect(tauriPage.getByText("Showing 1 of", { exact: false })).toBeVisible();
  await tauriPage.click('[aria-label="Advanced project filters"]');
  await expect(tauriPage.getByText("Advanced filters", { exact: true })).toHaveCount(0);
});
