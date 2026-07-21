import { test, expect } from "../fixtures";
import { caretIn, createBlankProject, openProject, openRailTab } from "../helpers";

test("place a shape, inspect it, and toggle canvas controls", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Insert diagram"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeVisible();

  const nodes = () =>
    tauriPage.evaluate<number>(`document.querySelectorAll('.react-flow__node').length`);
  const before = await nodes();
  await tauriPage.click('[aria-label="Rectangle"]');
  // Node creation is click-drag-to-draw (pointer events), not a plain click:
  // pointerdown with a tool armed creates the node, the drag sizes it.
  await tauriPage.evaluate(
    `(() => {
      const pane = document.querySelector('.react-flow__pane');
      const r = pane.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ev = (t, cx, cy) => new PointerEvent(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, pointerId: 1, isPrimary: true });
      pane.dispatchEvent(ev('pointerdown', x, y));
      pane.dispatchEvent(ev('pointermove', x + 90, y + 70));
      pane.dispatchEvent(ev('pointerup', x + 90, y + 70));
      return 1;
    })()`,
  );
  expect(await nodes()).toBe(before + 1);

  await tauriPage.click(".react-flow__node");
  await expect(tauriPage.getByText("Border style")).toBeVisible();
  await expect(tauriPage.getByText("Corner radius")).toBeVisible();

  await tauriPage.click('[aria-label="Toggle canvas theme"]');
  await tauriPage.click('[aria-label="Toggle canvas theme"]');
  await tauriPage.click('[aria-label="Toggle minimap"]');
  await expect(tauriPage.locator('[aria-label="Toggle minimap"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await tauriPage.click('[aria-label="Toggle minimap"]');

  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Back to project"]');
});

test("code tab snippets insert TikZ", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Insert diagram"]');
  await tauriPage.click('[data-testid="diagram-tab-code"]');
  await tauriPage.click('[aria-label="Circle node"]');
  const code = await tauriPage.evaluate<string>(
    `document.querySelectorAll('.cm-content')[1] ? Array.from(document.querySelectorAll('.cm-content')).map(e => e.textContent).join(' ') : document.querySelector('.cm-content').textContent`,
  );
  expect(code).toContain("circle");
  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Back to project"]');
});

test("insert as code lands editable TikZ in the document and a figures/ file", async ({
  tauriPage,
}) => {
  // This test permanently edits the document, so it gets a throwaway project:
  // a mis-placed insert must never break the shared "E2E Doc" fixture that
  // later specs compile.
  await createBlankProject(tauriPage, `E2E Diagram ${Date.now().toString(36)}`);
  // Insert-as-code lands at the caret: put it in the document body first,
  // or the figure would land before \documentclass and break every
  // subsequent compile.
  await caretIn(tauriPage, "here.", 1, "end");
  await tauriPage.click('[aria-label="Insert diagram"]');

  const name = `e2efig${Date.now().toString(36)}`;
  // Name is plain text until clicked, same pattern as the project title.
  await tauriPage.click('[data-testid="diagram-name-display"]');
  await tauriPage.fill("#diagram-name", name);
  await tauriPage.click('[aria-label="Save name"]');
  await tauriPage.click('[data-testid="diagram-tab-code"]');
  await tauriPage.getByText("Insert as code (vector)").click();
  await expect(
    tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]'),
  ).toBeHidden({ timeout: 20_000 });
  await expect(tauriPage.locator(".cm-content")).toContainText("tikzpicture");
  await openRailTab(tauriPage, "Source Tree");
  await tauriPage.getByText("figures").click();
  await expect(tauriPage.getByText(`${name}.tikz`)).toBeVisible({ timeout: 15_000 });
});

test("canvas zoom controls change the viewport", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Insert diagram"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeVisible();

  // Mount runs an animated fitView that lands AT max zoom for the small
  // starter drawing, so wait until the transform stops moving, then zoom
  // OUT first (zooming in from max is a legitimate no-op).
  const transform = () =>
    tauriPage.evaluate<string>(
      `document.querySelector('.react-flow__viewport')?.style.transform || ''`,
    );
  await tauriPage.waitForFunction(
    `!!(document.querySelector('.react-flow__viewport')?.style.transform) && !!document.querySelector('.react-flow__controls-zoomin')`,
    10_000,
  );
  let fitted = await transform();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const now = await transform();
    if (now === fitted) break;
    fitted = now;
  }

  await tauriPage.click(".react-flow__controls-zoomout");
  await tauriPage.waitForFunction(
    `(document.querySelector('.react-flow__viewport')?.style.transform || '') !== ${JSON.stringify(fitted)}`,
    5_000,
  );
  const zoomedOut = await transform();

  await tauriPage.click(".react-flow__controls-zoomin");
  await tauriPage.waitForFunction(
    `(document.querySelector('.react-flow__viewport')?.style.transform || '') !== ${JSON.stringify(zoomedOut)}`,
    5_000,
  );

  await tauriPage.click(".react-flow__controls-fitview");
  await tauriPage.waitForFunction(
    `(document.querySelector('.react-flow__viewport')?.style.transform || '') === ${JSON.stringify(fitted)}`,
    10_000,
  );
  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Back to project"]');
});

test("arrow styling stays selected and matches the generated TikZ", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Insert diagram"]');
  await tauriPage.waitForFunction(`!!document.querySelector('.react-flow__edge-path')`, 10_000);
  await tauriPage.evaluate(
    `(() => {
      const path = document.querySelector('.react-flow__edge-interaction') ||
        document.querySelector('.react-flow__edge-path');
      path.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    })()`,
  );
  const inspector = tauriPage.locator('[role="complementary"][aria-label="Shape style"]');
  await expect(inspector).toBeVisible();
  await expect(tauriPage.getByText("Arrowhead", { exact: true })).toBeVisible();

  const choose = async (field: string, value: string) => {
    await tauriPage.evaluate(
      `(() => {
        const panel = document.querySelector('[role="complementary"][aria-label="Shape style"]');
        const row = Array.from(panel.querySelectorAll('div')).find((el) =>
          Array.from(el.children).some((child) => child.textContent?.trim() === ${JSON.stringify(field)})
        );
        const trigger = row?.querySelector('button[role="combobox"]');
        if (!trigger) throw new Error('diagram field not found: ' + ${JSON.stringify(field)});
        trigger.click();
        return true;
      })()`,
    );
    await tauriPage.getByText(value, { exact: true }).click();
    // Regression: rebuilding an edge used to clear React Flow's selected flag,
    // which immediately removed this entire inspector after any value change.
    await expect(inspector).toBeVisible();
  };

  await choose("Arrowhead", "Both");
  await choose("Routing", "Curved");
  await choose("Line", "Dotted");
  await tauriPage.click('[data-testid="diagram-tab-code"]');
  await tauriPage.waitForFunction(
    `Array.from(document.querySelectorAll('.cm-content')).some((el) =>
      (el.textContent || '').includes('<->, dash pattern=on 0.038cm off 0.1cm') &&
      (el.textContent || '').includes('.south') &&
      (el.textContent || '').includes('.north')
    )`,
    10_000,
  );
  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Back to project"]');
});
