import { test, expect } from "../fixtures";
import { openProject } from "../helpers";

// TEMPORARY: capture the diagram composer's failure toast. Delete after triage.
test("dump composer state after compile", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.evaluate(
    `(window.__diagErrors = [], window.addEventListener("unhandledrejection", (e) => window.__diagErrors.push("rejection: " + (e.reason?.stack || e.reason))), window.__origConsoleError = console.error, console.error = (...a) => { window.__diagErrors.push("console: " + a.map(String).join(" ")); window.__origConsoleError(...a); }, true)`,
  );
  await tauriPage.click('[aria-label="Insert diagram"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeVisible();
  await tauriPage.click('[data-testid="diagram-compile"]');
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const state = await tauriPage.evaluate<string>(
      `JSON.stringify({
        hasImg: !!document.querySelector('img[alt="Diagram preview"]'),
        alerts: Array.from(document.querySelectorAll('[role="alert"],[role="status"]')).map((e) => e.textContent),
        errors: window.__diagErrors,
        busyText: document.querySelector('[data-testid="diagram-compile"]')?.textContent,
      })`,
    );
    console.log(`STATE[${i * 5}s]: ${state}`);
    if (state.includes('"hasImg":true')) break;
  }
});
