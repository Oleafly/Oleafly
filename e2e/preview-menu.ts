import { expect } from "./fixtures";
import type { Page } from "./helpers";

export async function openVisibleMenu(page: Page, triggerSelector: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const marked = await page.evaluate<boolean>(
      `(() => {
        document.querySelectorAll('[data-e2e-menu-trigger]').forEach(
          candidate => candidate.removeAttribute('data-e2e-menu-trigger')
        );
        const trigger = Array.from(document.querySelectorAll(${JSON.stringify(triggerSelector)}))
          .find(candidate => candidate.getClientRects().length > 0);
        if (!(trigger instanceof HTMLElement)) return false;
        trigger.setAttribute('data-e2e-menu-trigger', 'true');
        return true;
      })()`,
    );
    expect(marked).toBe(true);
    await page.focus('[data-e2e-menu-trigger="true"]');
    await page.press('[data-e2e-menu-trigger="true"]', "ArrowDown");
    try {
      await page.waitForFunction(
        `Array.from(document.querySelectorAll('[role="menu"]')).some(
          candidate => candidate.getClientRects().length > 0
        )`,
        2_000,
      );
      return;
    } catch {
      // Native bridge key delivery can race a toolbar re-render. Re-resolve
      // the visible trigger and retry only while no menu is actually visible.
    }
  }
  await expect(page.locator('[role="menu"]')).toBeVisible();
}

export async function pressVisibleMenuItem(
  page: Page,
  label: string,
  key: "Enter" | "ArrowRight",
): Promise<void> {
  const focused = await page.evaluate<boolean>(
    `(() => {
      document.querySelectorAll('[data-e2e-menu-item]').forEach(
        candidate => candidate.removeAttribute('data-e2e-menu-item')
      );
      const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(candidate => {
        return candidate.textContent?.trim() === ${JSON.stringify(label)} &&
          candidate.getClientRects().length > 0;
      });
      if (!(item instanceof HTMLElement)) return false;
      item.setAttribute('data-e2e-menu-item', 'true');
      item.focus();
      return document.activeElement === item;
    })()`,
  );
  expect(focused).toBe(true);
  if (key === "ArrowRight") {
    await page.press('[data-e2e-menu-item="true"]', key);
    return;
  }
  await page.evaluate(
    `(() => {
      const item = document.querySelector('[data-e2e-menu-item="true"]');
      if (!(item instanceof HTMLElement)) return false;
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
      };
      item.dispatchEvent(new PointerEvent("pointerdown", init));
      item.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
      item.click();
      return true;
    })()`,
  );
  await page.waitForFunction(
    `!document.querySelector('[role="menu"][data-state="open"]')`,
    5_000,
  );
}

export async function openZoomMenu(page: Page): Promise<void> {
  const inlineTrigger = '[aria-haspopup="menu"][aria-label^="Zoom "]';
  if (await page.locator(inlineTrigger).isVisible()) {
    await openVisibleMenu(page, inlineTrigger);
  } else {
    await openVisibleMenu(page, '[aria-label="More preview controls"]');
    const label = await page.evaluate<string>(`(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find(candidate =>
        candidate.getClientRects().length > 0 && candidate.textContent?.trim().startsWith('Zoom · ')
      );
      return item?.textContent?.trim() ?? '';
    })()`);
    expect(label).toMatch(/^Zoom · \d+%$/);
    await pressVisibleMenuItem(page, label, "ArrowRight");
  }
  await page.waitForFunction(`Array.from(document.querySelectorAll('[role="menuitem"]')).some(
    item => item.getClientRects().length > 0 && item.textContent?.trim() === '100%'
  )`, 5_000);
}
