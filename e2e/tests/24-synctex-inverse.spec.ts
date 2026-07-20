import { test, expect } from "../fixtures";
import { createBlankProject, openProject, pressGlobal } from "../helpers";

test("clicking the PDF jumps to the word in the source", async ({ tauriPage }) => {
  test.setTimeout(180_000); // cold text-layer render can be slow
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]'),
  ).toBeVisible({ timeout: 30_000 });
  const projectExists = await tauriPage.evaluate<boolean>(
    `!!document.querySelector('button[aria-label="Open E2E Doc"]')`,
  );
  if (projectExists) {
    await openProject(tauriPage, "E2E Doc");
  } else {
    await createBlankProject(tauriPage, "E2E Doc");
  }
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await pressGlobal(tauriPage, "Enter", { meta: true });
  await expect(tauriPage.getByTestId("compile-status")).toHaveAttribute("data-severity", "ok", {
    timeout: 90_000,
  });
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

  const target = tauriPage.locator(".textLayer span").filter({ hasText: "Introduction" });
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(`(element) => {
    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new MouseEvent("mouseup", options));
    element.dispatchEvent(new MouseEvent("click", options));
  }`);

  await expect
    .poll(
      () =>
        tauriPage.evaluate<string>(
          `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
            const view = getEditorView();
            if (!view) return "";
            const selection = view.state.selection.main;
            return view.state.sliceDoc(selection.from, selection.to);
          })`,
        ),
      { timeout: 15_000 },
    )
    .toBe("Introduction");
});
