import { expect, test } from "../fixtures";
import { caretIn, openProject, pressGlobal, waitLong } from "../helpers";

// Cmd+K and Cmd+Shift+F are covered in 04-commands; this file covers the rest.

test("Cmd+Enter compiles and Cmd+Shift+J forward-SyncTeX highlights the PDF", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await tauriPage.click('[data-testid="toolbar-views"] button[aria-label="Split View"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 120_000,
  });

  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.locator(".pdf-canvas")).toBeVisible({ timeout: 90_000 });
  await waitLong(
    tauriPage,
    `!document.body.innerText.includes('Compiling your document')`,
    120_000,
  );
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok");

  await caretIn(tauriPage, "Write your");
  await pressGlobal(tauriPage, "j", { meta: true, shift: true });
  await expect(tauriPage.locator(".ll-synctex-hl")).toBeVisible({ timeout: 15_000 });
});

test("Cmd+/ opens the keyboard shortcuts reference", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "/", { meta: true });
  await expect(tauriPage.getByText("Keyboard Shortcuts")).toBeVisible();
  await expect(tauriPage.locator('input[placeholder="Search shortcuts…"]')).toBeVisible();
});

async function pressSettingsShortcut(page: Parameters<typeof pressGlobal>[0]) {
  const nativeMenu = await page.evaluate<boolean>(
    `Boolean(window.__TAURI_INTERNALS__) && /Mac/.test(navigator.platform)`,
  );
  if (nativeMenu) {
    await page.evaluate(
      `window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
        event: "settings:open",
        payload: null,
      }).then(() => true)`,
    );
    return;
  }
  await pressGlobal(page, ",", { meta: true });
}

test("Cmd+, opens Settings", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressSettingsShortcut(tauriPage);
  await expect(tauriPage.locator('[data-testid="settings-section-appearance"]')).toBeVisible({
    timeout: 10_000,
  });
  await tauriPage.click('[data-testid="settings-close"]');
  await expect(tauriPage.locator('[data-testid="settings-close"]')).toHaveCount(0, { timeout: 10_000 });
});

async function viewMode(page: Parameters<typeof pressGlobal>[0]): Promise<string> {
  return page.evaluate<string>(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => useSettingsStore.getState().viewMode)`,
  );
}

test("Cmd+Option+P shows and hides the PDF beside the editor", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.evaluate(
    `import("/src/store/settings.ts").then(({ useSettingsStore }) => {
      useSettingsStore.getState().setViewMode("editor");
      return 1;
    })`,
  );
  await pressGlobal(tauriPage, "p", { meta: true, alt: true });
  await expect.poll(async () => await viewMode(tauriPage), { timeout: 10_000 }).toBe("split");
  await pressGlobal(tauriPage, "p", { meta: true, alt: true });
  await expect.poll(async () => await viewMode(tauriPage), { timeout: 10_000 }).toBe("editor");
});

async function storedZoom(page: Parameters<typeof pressGlobal>[0]): Promise<string | null> {
  return page.evaluate<string | null>(`localStorage.getItem("oleafly.appZoom")`);
}

test("Cmd+= and Cmd+- zoom the whole app and Cmd+0 sets it back", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const width = () => tauriPage.evaluate<number>("window.innerWidth");
  const start = await width();
  try {
    await pressGlobal(tauriPage, "=", { meta: true });
    await expect.poll(async () => await storedZoom(tauriPage), { timeout: 10_000 }).toBe("110");
    await expect.poll(width, { timeout: 10_000 }).toBeLessThan(start);
    await pressGlobal(tauriPage, "-", { meta: true });
    await pressGlobal(tauriPage, "-", { meta: true });
    await expect.poll(async () => await storedZoom(tauriPage), { timeout: 10_000 }).toBe("90");
    await expect.poll(width, { timeout: 10_000 }).toBeGreaterThan(start);
  } finally {
    await pressGlobal(tauriPage, "0", { meta: true });
  }
  await expect.poll(async () => await storedZoom(tauriPage), { timeout: 10_000 }).toBe("100");
  await expect.poll(width, { timeout: 10_000 }).toBe(start);
});
