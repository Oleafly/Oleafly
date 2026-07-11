import { test, expect } from "../fixtures";
import { openProject, openSettings } from "../helpers";

// Appearance settings must change the real UI: the editor font size select
// restyles CodeMirror, and dark mode flips from the settings toggle too.

test("editor font size select restyles the editor", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const fontSize = () =>
    tauriPage.evaluate<string>(
      `getComputedStyle(document.querySelector('.cm-content')).fontSize`,
    );
  const before = await fontSize();

  const pickEditorFontSize = async (px: string) => {
    // Two font-size selects exist (editor + app); open the one inside the
    // "Editor font size" row, then pick the option from the Radix portal.
    await tauriPage.evaluate(
      `(() => {
        const combos = Array.from(document.querySelectorAll('[role="combobox"]'));
        const combo = combos.find(c => (c.closest('div')?.parentElement?.textContent ?? '').includes('Editor font size'));
        combo.click();
        return 1;
      })()`,
    );
    await tauriPage.waitForFunction(`!!document.querySelector('[role="option"]')`, 5_000);
    await tauriPage.evaluate(
      `(() => {
        const opt = Array.from(document.querySelectorAll('[role="option"]')).find(o => o.textContent.trim() === ${JSON.stringify(px)});
        opt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        opt.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        opt.click();
        return 1;
      })()`,
    );
  };

  await openSettings(tauriPage, "appearance");
  await pickEditorFontSize("16px");
  await tauriPage.click('[aria-label="Close settings"]');
  expect(await fontSize()).toBe("16px");

  // Restore.
  await openSettings(tauriPage, "appearance");
  await pickEditorFontSize(`${parseInt(before)}px`);
  await tauriPage.click('[aria-label="Close settings"]');
  expect(await fontSize()).toBe(before);
});

test("dark mode toggle in settings flips the real theme", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const theme = () =>
    tauriPage.evaluate<boolean>(`document.documentElement.classList.contains('dark')`);
  const before = await theme();
  await openSettings(tauriPage, "appearance");
  await tauriPage.click('[role="switch"][aria-label="Dark mode"]');
  expect(await theme()).toBe(!before);
  await tauriPage.click('[role="switch"][aria-label="Dark mode"]');
  expect(await theme()).toBe(before);
  await tauriPage.click('[aria-label="Close settings"]');
});
