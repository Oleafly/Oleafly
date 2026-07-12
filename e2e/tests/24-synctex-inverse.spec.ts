import { test, expect } from "../fixtures";
import { openProject, pressGlobal } from "../helpers";

// Inverse SyncTeX: Cmd-clicking a word in the real rendered PDF must land the
// editor caret on that word in the source.

test("Cmd-click on the PDF jumps to the word in the source", async ({ tauriPage }) => {
  test.setTimeout(180_000); // cold text-layer render can be slow
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });
  // The text layer gives us real coordinates for the word "Introduction".
  const probe = await tauriPage
    .waitForFunction(
      `Array.from(document.querySelectorAll('.textLayer')).some(t => (t.textContent || '').includes('Introduction'))`,
      30_000,
    )
    .then(() => "ok")
    .catch(() => "timeout");
  if (probe !== "ok") {
    const dump = await tauriPage.evaluate<string>(
      `JSON.stringify({
        canvases: document.querySelectorAll('.pdf-canvas').length,
        layers: Array.from(document.querySelectorAll('.textLayer')).map(t => (t.textContent || '').length),
        wraps: document.querySelectorAll('[data-page]').length,
        chip: document.querySelector('[data-testid="compile-status"]')?.getAttribute('data-severity'),
      })`,
    );
    throw new Error("textLayer never got content: " + dump);
  }

  const clicked = await tauriPage.evaluate<boolean>(
    `(() => {
      const spans = Array.from(document.querySelectorAll('.textLayer span'));
      const target = spans.find(s => s.textContent.includes('Introduction'));
      if (!target) return false;
      const r = target.getBoundingClientRect();
      const wrap = target.closest('[data-page]');
      if (!wrap) return false;
      wrap.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, metaKey: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
      return true;
    })()`,
  );
  expect(clicked).toBe(true);

  // The editor lands on the word: either the word gets selected, or the
  // caret's active line is the \section{Introduction} line.
  await tauriPage.waitForFunction(
    `window.getSelection().toString().includes('Introduction') || (document.querySelector('.cm-activeLine')?.textContent ?? '').includes('Introduction')`,
    15_000,
  );
});
