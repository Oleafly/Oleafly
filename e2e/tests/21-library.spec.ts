import { test, expect } from "../fixtures";
import { openProject, openSettings } from "../helpers";

// Library management: favorites, the book context menu, fork, and delete -
// all against real projects on disk.

test("favorite toggles on a project book", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  // The bookmark control reveals on hover.
  await tauriPage.hover('[role="button"][tabindex="0"]');
  await tauriPage.click('[aria-label="Add to favorites"]');
  await expect(tauriPage.locator('[aria-label="Remove from favorites"]')).toBeVisible();
  await tauriPage.click('[aria-label="Remove from favorites"]');
  await expect(tauriPage.locator('[aria-label="Add to favorites"]')).toBeVisible();
});

test("fork a project from the context menu", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();

  // Right-click the E2E Doc book (by name) to open its context menu.
  await tauriPage.evaluate(
    `(() => {
      const books = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'));
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

// Separate test: the fixture reloads the app in between, which clears the
// re-armed Radix context menu from the fork flow (a second synthetic
// right-click in the same page acts on the WRONG book's menu).
test("delete the forked copy from the context menu", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('[role="button"][tabindex="0"]')).some(b => b.textContent.includes('E2E Fork'))`,
    20_000,
  );

  // The confirm prompt is native, so override it - but ONLY accept a dialog
  // that names the fork; anything else is a mis-targeted destructive action
  // and must be refused. (Comma-expression: evaluate needs a serializable value.)
  await tauriPage.evaluate(
    `(window.confirm = (msg) => typeof msg === 'string' && msg.includes('E2E Fork'), 1)`,
  );
  await tauriPage.evaluate(
    `(() => {
      const books = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'));
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
    `!Array.from(document.querySelectorAll('[role="button"][tabindex="0"]')).some(b => b.textContent.includes('E2E Fork'))`,
    20_000,
  );
});

test("bookmark filter shows only bookmarked projects", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.hover('[role="button"][tabindex="0"]');
  await tauriPage.click('[aria-label="Add to favorites"]');

  await tauriPage.click('[aria-label="Show bookmarked only"]');
  await tauriPage.waitForFunction(
    `document.querySelectorAll('[aria-label="Remove from favorites"]').length >= 1
      && document.querySelectorAll('[aria-label="Add to favorites"]').length === 0`,
    10_000,
  );

  await tauriPage.click('[aria-label="Remove from favorites"]');
  await expect(tauriPage.getByText("No bookmarked projects yet")).toBeVisible({ timeout: 5_000 });

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
  const bookFor = (name: string) =>
    `(() => {
      const el = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'))
        .find(b => b.textContent.includes(${JSON.stringify(name)}));
      if (!el) return null;
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.parentElement?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      return !!el.querySelector('img[draggable="false"]');
    })()`;
  await tauriPage.evaluate(bookFor("E2E Doc"));
  await tauriPage.waitForFunction(
    `(() => {
      const el = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'))
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
      const el = Array.from(document.querySelectorAll('[role="button"][tabindex="0"]'))
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
