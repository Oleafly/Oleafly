import { test, expect } from "../fixtures";
import { openProject, openRailTab } from "../helpers";

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
  await tauriPage.click(".react-flow__pane");
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

  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Close"]');
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
  await tauriPage.click('[role="dialog"][aria-label="Insert diagram"] [aria-label="Close"]');
});

test("insert as code lands editable TikZ in the document and a figures/ file", async ({
  tauriPage,
}) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[aria-label="Insert diagram"]');

  const name = `e2efig${Date.now().toString(36)}`;
  await tauriPage.fill("#diagram-name", name);
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
