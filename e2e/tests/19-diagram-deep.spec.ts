import { test, expect } from "../fixtures";
import { caretIn, openProject, openRailTab } from "../helpers";

// Deep diagram-composer coverage: shape placement, the inspector, canvas
// controls, code snippets, and the insert-as-code round trip into the
// document and figures/ folder.

test("place a shape, inspect it, and toggle canvas controls", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Insert diagram"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeVisible();

  // Arm the rectangle tool and click the canvas: a node appears.
  const nodes = () =>
    tauriPage.evaluate<number>(`document.querySelectorAll('.react-flow__node').length`);
  const before = await nodes();
  await tauriPage.click('[aria-label="Rectangle"]');
  // Node creation is now click-drag-to-draw (pointer events), not a plain click.
  // A pointerdown with a tool armed creates the node; the drag sizes it.
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

  // Selecting a node brings up the style inspector.
  await tauriPage.click(".react-flow__node");
  await expect(tauriPage.getByText("Border style")).toBeVisible();
  await expect(tauriPage.getByText("Corner radius")).toBeVisible();

  // Canvas chrome: theme + minimap toggles.
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
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Insert-as-code lands at the caret: put it in the document body first,
  // or the figure would land before \documentclass and break every
  // subsequent compile.
  await caretIn(tauriPage, "here.", 1, "end");
  await tauriPage.click('[aria-label="Insert diagram"]');

  const name = `e2efig${Date.now().toString(36)}`;
  // Name is plain text until clicked — same pattern as the project title.
  await tauriPage.click('[data-testid="diagram-name-display"]');
  await tauriPage.fill("#diagram-name", name);
  await tauriPage.click('[aria-label="Save name"]');
  // Insert actions live on the Code tab's preview chrome.
  await tauriPage.click('[data-testid="diagram-tab-code"]');
  await tauriPage.getByText("Insert as code (vector)").click();
  // Composer closes and the tikzpicture is in the real document.
  await expect(
    tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]'),
  ).toBeHidden({ timeout: 20_000 });
  await expect(tauriPage.locator(".cm-content")).toContainText("tikzpicture");
  // And the re-openable snippet was written into figures/.
  await openRailTab(tauriPage, "Source Tree");
  await tauriPage.getByText("figures").click(); // expand the folder
  await expect(tauriPage.getByText(`${name}.tikz`)).toBeVisible({ timeout: 15_000 });
});

test("canvas zoom controls change the viewport", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Insert diagram"]');
  await expect(tauriPage.locator('[role="dialog"][aria-label="Insert diagram"]')).toBeVisible();

  // React Flow paints the zoom level into the viewport transform. The mount
  // runs an animated fitView that lands AT max zoom for the small starter
  // drawing, so wait until the transform stops moving, then zoom OUT first
  // (zooming in from max is a legitimate no-op).
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

  // Fit view animates back to the fitted framing.
  await tauriPage.click(".react-flow__controls-fitview");
  await tauriPage.waitForFunction(
    `(document.querySelector('.react-flow__viewport')?.style.transform || '') === ${JSON.stringify(fitted)}`,
    10_000,
  );
  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Back to project"]');
});
