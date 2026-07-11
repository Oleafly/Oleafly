import { test, expect } from "../fixtures";

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
