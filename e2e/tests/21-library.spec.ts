import { test, expect } from "../fixtures";
import type { TauriPage } from "@srsholmes/tauri-playwright";
import { createBlankProject, openProject, openSettings } from "../helpers";

async function ensureLibraryFixture(tauriPage: TauriPage) {
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
  const hasProject = await tauriPage.evaluate<boolean>(
    `Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
      .some((button) => button.textContent.includes('E2E Doc'))`,
  );
  if (hasProject) return;

  await createBlankProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[title="Back to library"]');
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ tauriPage }) => {
  await ensureLibraryFixture(tauriPage);
});

async function compileForLibraryPreview(tauriPage: TauriPage) {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[data-testid="compile-button"]');
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");
  await tauriPage.click('[title="Back to library"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible({ timeout: 10_000 });
}

// The bookmark only reveals via a real CSS :hover, which the bridge's
// synthetic hover doesn't reliably keep active across the follow-up click,
// so this drives the button directly (bypassing hover/opacity) and, by this
// point in the suite the library holds several project books, scopes to the
// E2E Doc one specifically rather than an unscoped aria-label.
async function clickBookBookmark(tauriPage: TauriPage) {
  const clicked = await tauriPage.evaluate<boolean>(
    `(() => {
      const book = Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
        .find((b) => b.textContent.includes('E2E Doc'));
      const btn = book?.parentElement?.querySelector('[aria-label="Add to favorites"], [aria-label="Remove from favorites"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
  if (!clicked) throw new Error("bookmark button not found for the E2E Doc book");
}

test("favorite toggles on a project book", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await clickBookBookmark(tauriPage);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
      .find((b) => b.textContent.includes('E2E Doc'))
      ?.parentElement?.querySelector('[aria-label="Remove from favorites"]') != null`,
    10_000,
  );
  await clickBookBookmark(tauriPage);
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
      .find((b) => b.textContent.includes('E2E Doc'))
      ?.parentElement?.querySelector('[aria-label="Add to favorites"]') != null`,
    10_000,
  );
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
      const bookmarkLayer = btn?.parentElement;
      if (!bookmarkLayer || !overlay) return false;
      const z = (n) => parseInt(getComputedStyle(n).zIndex || '0', 10) || 0;
      return z(bookmarkLayer) > z(overlay);
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
test("move the forked copy to the recycle bin and restore it from Data Storage", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('button[aria-label^="Open "]')).some(b => b.textContent.includes('E2E Fork'))`,
    60_000,
  );
  const forkName = await tauriPage.evaluate<string>(
    `(() => {
      const copy = Array.from(document.querySelectorAll('button[aria-label^="Open "]'))
        .find((button) => button.textContent.includes('E2E Fork'));
      return copy?.getAttribute('aria-label')?.replace(/^Open /, '') ?? '';
    })()`,
  );
  expect(forkName).not.toBe("");

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
  let confirmation = tauriPage.getByRole("alertdialog");
  await expect(confirmation).toBeVisible({ timeout: 10_000 });
  await expect(confirmation).toContainText(
    /Move “E2E Fork.*” to the Recycle Bin\?/u,
  );
  await confirmation.getByText("Cancel").click();
  await expect(confirmation).not.toBeVisible();
  await expect(tauriPage.locator('button[aria-label^="Open E2E Fork"]').first()).toBeVisible();

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
  await tauriPage.getByText("Delete project").click();
  confirmation = tauriPage.getByRole("alertdialog");
  await expect(confirmation).toBeVisible({ timeout: 10_000 });
  await confirmation.getByText("Move to Recycle Bin").click();
  await tauriPage.waitForFunction(
    `!Array.from(document.querySelectorAll('button[aria-label^="Open "]')).some(b => b.textContent.includes('E2E Fork'))`,
    20_000,
  );

  await openSettings(tauriPage, "data");
  await expect(tauriPage.getByText("Storage usage", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Recycle Bin", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText(forkName, { exact: true })).toBeVisible();
  const restored = await tauriPage.evaluate<boolean>(
    `(() => {
      const item = Array.from(document.querySelectorAll('li'))
        .find((element) => element.textContent.includes(${JSON.stringify(forkName)}));
      const restore = item && Array.from(item.querySelectorAll('button'))
        .find((button) => button.textContent.includes('Restore'));
      if (!(restore instanceof HTMLElement)) return false;
      restore.click();
      return true;
    })()`,
  );
  expect(restored).toBe(true);
  await expect(tauriPage.getByText(forkName, { exact: true })).toHaveCount(0);
  await tauriPage.click('[aria-label="Close settings"]');
  await expect(tauriPage.locator(`[aria-label="Open ${forkName}"]`)).toBeVisible({
    timeout: 20_000,
  });
});

test("the library header search filters projects and clears cleanly", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  const search = tauriPage.locator('input[aria-label="Search projects"]');
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute(
    "placeholder",
    /Search \d+ projects? by name, ID, main file, color, or export/u,
  );

  await search.fill("a project name that cannot exist in this test");
  await expect(tauriPage.getByText("No matches", { exact: true })).toBeVisible();
  await expect(
    tauriPage.getByText("No projects match the current filters.", { exact: true }),
  ).toBeVisible();

  await tauriPage.click('[aria-label="Clear project search"]');
  await expect(search).toHaveValue("");
  await expect(tauriPage.getByText("E2E Doc", { exact: true })).toBeVisible();
});

test("list view exposes favorites and the compiled PDF preview", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await compileForLibraryPreview(tauriPage);

  await tauriPage.click('[aria-label="List view"]');
  await expect(tauriPage.locator('[aria-label="List view"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tauriPage.getByTestId("project-list")).toBeVisible();
  await expect(tauriPage.getByTestId("project-grid")).toHaveCount(0);

  const listFavorite = tauriPage
    .getByTestId("project-list")
    .locator('[aria-label="Add to favorites"], [aria-label="Remove from favorites"]')
    .first();
  const originalFavoriteLabel = await listFavorite.getAttribute("aria-label");
  await listFavorite.click();
  await expect(listFavorite).toHaveAttribute(
    "aria-label",
    originalFavoriteLabel === "Add to favorites"
      ? "Remove from favorites"
      : "Add to favorites",
  );
  await listFavorite.click();
  await expect(listFavorite).toHaveAttribute(
    "aria-label",
    originalFavoriteLabel ?? "Add to favorites",
  );

  await tauriPage.click('[aria-label="Preview E2E Doc"]');
  const previewDialog = tauriPage.getByRole("dialog");
  await expect(previewDialog).toContainText("PDF preview — E2E Doc");
  await expect(previewDialog.locator(".pdf-canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await tauriPage.press("body", "Escape");
  await expect(previewDialog).toHaveCount(0);

  await tauriPage.click('[aria-label="Grid view"]');
  await expect(tauriPage.getByTestId("project-grid")).toBeVisible();
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
  await tauriPage.press('[data-testid="appearance-tab-pdf"]', "Enter");
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
  await tauriPage.press('[data-testid="appearance-tab-pdf"]', "Enter");
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

test("advanced filters keep select interactions open and dismiss outside", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.click('[aria-label="Advanced project filters"]');
  await expect(tauriPage.getByText("Advanced filters", { exact: true })).toBeVisible();

  await tauriPage.getByText("All engines", { exact: true }).click();
  await expect(tauriPage.getByRole("listbox")).toBeVisible();
  const selected = await tauriPage.evaluate<boolean>(
    `(() => {
      const option = Array.from(document.querySelectorAll('[role="option"]'))
        .find((element) => element.textContent.trim() === 'Tectonic');
      if (!(option instanceof HTMLElement)) return false;
      option.click();
      return true;
    })()`,
  );
  expect(selected).toBe(true);
  await expect(tauriPage.getByText("Advanced filters", { exact: true })).toBeVisible();

  const shelf = tauriPage.getByTestId("project-grid");
  await shelf.click({ position: { x: 4, y: 4 } });
  await expect(tauriPage.getByText("Advanced filters", { exact: true })).toHaveCount(0);
});
