import { test, expect } from "../fixtures";
import { openProject, openSettings, typeInEditorAfter } from "../helpers";

// Spelling/grammar squiggles through the real linters (Harper WASM +
// dictionary), and the ignore round-trip: ignore a word -> squiggle clears ->
// un-ignore in Settings -> squiggle returns.

test("misspellings get squiggles; ignore clears them; un-ignore brings them back", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // A word no dictionary knows. Linting is debounced + lazy-loads WASM.
  await typeInEditorAfter(tauriPage, "here.", " Qwertzuiopz.");
  await expect(tauriPage.locator(".cm-lintRange")).toBeVisible({ timeout: 60_000 });

  // Open the lint tooltip by hovering the squiggle, then ignore project-wide.
  const hovered = await tauriPage.evaluate<boolean>(
    `(() => {
      const el = document.querySelector('.cm-lintRange');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      el.dispatchEvent(new MouseEvent('mousemove', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      return true;
    })()`,
  );
  expect(hovered).toBe(true);
  await expect(tauriPage.getByText("in this project")).toBeVisible({ timeout: 15_000 });
  await tauriPage.getByText("in this project").click();

  // The squiggle for the word clears...
  await tauriPage.waitForFunction(
    `!document.querySelector('.cm-lintRange') || !document.querySelector('.cm-content').textContent.includes('Qwertzuiopz') || (() => {
       const marks = Array.from(document.querySelectorAll('.cm-lintRange'));
       return !marks.some(m => m.textContent.includes('Qwertzuiopz'));
     })()`,
    30_000,
  );

  // ...and the word shows in Settings -> Dictionary, where un-ignoring it
  // brings the squiggle back.
  await openSettings(tauriPage, "dictionary");
  await expect(tauriPage.getByText("Qwertzuiopz")).toBeVisible();
  await tauriPage.click('[aria-label="Stop ignoring Qwertzuiopz"]');
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.cm-lintRange')).some(m => m.textContent.includes('Qwertzuiopz'))`,
    60_000,
  );
});
