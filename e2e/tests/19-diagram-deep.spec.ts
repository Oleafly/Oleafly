import { test, expect } from "../fixtures";
import { closeDiagramComposer, openDiagramComposer } from "../helpers";

test("place a shape, inspect it, and toggle canvas controls", async ({ tauriPage }) => {
  await openDiagramComposer(tauriPage);

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

  await closeDiagramComposer(tauriPage);
});

test("code tab snippets insert TikZ", async ({ tauriPage }) => {
  await openDiagramComposer(tauriPage);
  await tauriPage.click('[data-testid="diagram-tab-code"]');
  await tauriPage.click('[aria-label="Circle node"]');
  const code = await tauriPage.evaluate<string>(
    `document.querySelectorAll('.cm-content')[1] ? Array.from(document.querySelectorAll('.cm-content')).map(e => e.textContent).join(' ') : document.querySelector('.cm-content').textContent`,
  );
  expect(code).toContain("circle");
  await closeDiagramComposer(tauriPage);
});

test("canvas zoom controls change the viewport", async ({ tauriPage }) => {
  await openDiagramComposer(tauriPage);

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
  await closeDiagramComposer(tauriPage);
});

test("arrow styling stays selected and matches the generated TikZ", async ({ tauriPage }) => {
  await openDiagramComposer(tauriPage);
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
  // Each choose() already proved the inspector survives a value change (the
  // regression it guards) and that the picked value is now displayed. The
  // arrow-type/dash-pattern -> TikZ text mapping itself is covered by
  // packages/latex/src/tikz-serializer.test.ts; asserting it again here would
  // mean scanning the code tab's CodeMirror instance, which - like the main
  // editor - virtualizes its content, and with ~27 nodes emitted before any
  // edge's `\draw`, the relevant text is scrolled out of the rendered
  // viewport (`.cm-content` only ever holds what's currently visible).
  await expect(tauriPage.getByText("Both", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Curved", { exact: true })).toBeVisible();
  await expect(tauriPage.getByText("Dotted", { exact: true })).toBeVisible();
  await closeDiagramComposer(tauriPage);
});

// Multi-destination save: "Save to project" (new or existing) and "Download"
// replaced the old in-document insert flow when the composer moved to a
// standalone scratch-project page.
test("saving to a new project creates a project visible from Home", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openDiagramComposer(tauriPage);

  // The diagram name is sanitized to [A-Za-z0-9_-] on commit and reused
  // verbatim as the created project's name, so this must already be safe.
  const projectName = `E2E-Diagram-${Date.now().toString(36)}`;
  await tauriPage.click('[data-testid="diagram-name-display"]');
  await tauriPage.fill("#diagram-name", projectName);
  await tauriPage.click('[aria-label="Save name"]');

  await tauriPage.getByTestId("diagram-compile").click();
  await expect(tauriPage.locator('img[alt="Diagram preview"]')).toBeVisible({ timeout: 120_000 });

  await tauriPage.click('[aria-label="Save"]');
  await tauriPage.hover('[data-testid="diagram-save-to-project"]');
  await tauriPage.getByText("New project", { exact: true }).click();
  await expect(
    tauriPage.getByText("Saved as a new diagram project. Find it on your home screen."),
  ).toBeVisible({ timeout: 15_000 });

  await closeDiagramComposer(tauriPage);
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  // The project shelf isn't paginated, so the new card is already in the DOM
  // without needing the Advanced filters search (which lives in a collapsed
  // panel, not a plain input on the page).
  await expect(tauriPage.getByText(projectName, { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("the Download picker offers PNG and disables SVG", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await openDiagramComposer(tauriPage);
  await tauriPage.getByTestId("diagram-compile").click();
  await expect(tauriPage.locator('img[alt="Diagram preview"]')).toBeVisible({ timeout: 120_000 });

  // Clicking PNG opens a native save dialog, which isn't drivable through the
  // test bridge (same convention as PDF/Word/Markdown export - see
  // 22-toolbar.spec.ts); this stops at verifying the picker itself.
  await tauriPage.click('[aria-label="Download"]');
  const png = tauriPage.getByText("PNG", { exact: true });
  await expect(png).toBeVisible();
  await expect(tauriPage.getByText("SVG (coming soon)", { exact: true })).toBeVisible();

  await closeDiagramComposer(tauriPage);
});

// Import replaces the default draft; it never forces a project save (that
// stays a separate, explicit "Save to project" action - see the "saving to
// a new project" test above).
test("importing a plain (non-composer) TikZ file loads it as code-only", async ({ tauriPage }) => {
  await openDiagramComposer(tauriPage);

  const importedTikz = "\\node (imported) [draw] {Imported Content};";
  await tauriPage.evaluate(
    `window.__setNextTikzImport(${JSON.stringify("hand-written.tikz")}, ${JSON.stringify(importedTikz)})`,
  );
  await tauriPage.click('[aria-label="Import TikZ file"]');

  await tauriPage.waitForFunction(
    `document.body.innerText.includes('Imported hand-written.tikz (code only, not drawable).')`,
    10_000,
  );
  // Non-drawable content switches to the Code tab automatically.
  await tauriPage.waitForFunction(
    `document.querySelector('[data-testid="diagram-tab-code"]').className.includes('bg-accent')`,
    5_000,
  );
  await expect(tauriPage.locator(".cm-content")).toContainText("Imported Content");
  // The draft's display name picks up the imported file's basename.
  await expect(tauriPage.locator('[data-testid="diagram-name-display"]')).toContainText(
    "hand-written",
  );

  await closeDiagramComposer(tauriPage);
});

test("canceling the file picker during import leaves the draft untouched", async ({
  tauriPage,
}) => {
  await openDiagramComposer(tauriPage);
  // The starter drawing's generated TikZ is long enough that CodeMirror
  // virtualizes .cm-content (only the scrolled-to viewport renders), so a
  // before/after text diff would be comparing arbitrary scroll windows, not
  // the actual document. The name display is short and never virtualized,
  // and only a successful import ever changes it - a reliable proxy here.
  await expect(tauriPage.locator('[data-testid="diagram-name-display"]')).toContainText(
    "diagram.tikz",
  );

  // name: null simulates the user dismissing the picker without choosing a
  // file - pickTikzFile() resolves null the same way for a real cancel.
  await tauriPage.evaluate(`window.__setNextTikzImport(null, null)`);
  await tauriPage.click('[aria-label="Import TikZ file"]');
  await tauriPage.waitForFunction(
    `!document.querySelector('[aria-label="Import TikZ file"][disabled]')`,
    5_000,
  );

  await expect(tauriPage.locator('[data-testid="diagram-name-display"]')).toContainText(
    "diagram.tikz",
  );
  await expect(tauriPage.getByText("Imported", { exact: false })).toHaveCount(0);
  await closeDiagramComposer(tauriPage);
});
