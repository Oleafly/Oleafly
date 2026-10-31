import { test, expect } from "../fixtures";
import {
  chooseDiagramComposer,
  createBlankProject,
  fillCommandPalette,
  pressGlobal,
} from "../helpers";

test("dock opens the Tools page, and a converter returns to it", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();

  await tauriPage.click('[data-testid="open-latex-tools"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await expect(tauriPage.getByText("Oleafly Tools", { exact: true })).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tool-card-deadlines"]')).toBeVisible();

  await tauriPage.click('[data-testid="latex-tool-card-pdf-to-latex"]');
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="pdf-dropzone"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeHidden();

  await tauriPage.click('[data-testid="import-back"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await tauriPage.click('[data-testid="latex-tools-view-back"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeHidden();
});

test("Oleafly Tools gallery filters by category and search, and opens a dedicated tool view", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.click('[data-testid="open-latex-tools"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tool-card-bibtex"]')).toBeVisible();

  await tauriPage.fill(
    '[data-testid="latex-tools-view"] input[aria-label="Search Oleafly Tools"]',
    "table",
  );
  await expect(
    tauriPage.locator('[data-testid="latex-tool-card-table-to-latex"]'),
  ).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tool-card-bibtex"]')).toBeHidden();

  await tauriPage.click('[data-testid="latex-tool-card-table-to-latex"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeHidden();
  await expect(tauriPage.locator('[data-testid="table-tool-view"]')).toBeVisible();
  await expect(tauriPage.getByText("LaTeX Table Generator", { exact: true })).toBeVisible();

  await tauriPage.click('[data-testid="table-tool-view-back"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="table-tool-view"]')).toBeHidden();
});

test("a deterministic converter runs from its built-in example", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.click('[data-testid="open-latex-tools"]');
  await tauriPage.click('[data-testid="latex-tool-card-mermaid-to-latex"]');

  await expect(tauriPage.getByTestId("converter-tool-view")).toBeVisible();
  await expect(tauriPage.getByText("Mermaid to LaTeX", { exact: true })).toBeVisible();
  await tauriPage.click('[data-testid="converter-run"]');
  await expect(tauriPage.getByTestId("converter-output")).toContainText(
    "\\begin{tikzpicture}",
  );

  await tauriPage.click('[data-testid="converter-tool-view-back"]');
  await expect(tauriPage.getByTestId("latex-tools-view")).toBeVisible();
});

test("the bundled Pandoc converts Markdown without a project", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await pressGlobal(tauriPage, "f", { meta: true, shift: true });
  await expect(tauriPage.locator("[cmdk-input]")).toBeVisible();
  await fillCommandPalette(tauriPage, "markdown to latex");
  await expect(tauriPage.getByText("Open Markdown to LaTeX")).toBeVisible();
  await tauriPage.press("[cmdk-input]", "Enter");

  await expect(tauriPage.getByTestId("converter-tool-view")).toBeVisible();
  await expect(tauriPage.getByText("Markdown to LaTeX", { exact: true })).toBeVisible();
  await tauriPage.click('[data-testid="converter-run"]');
  await expect(tauriPage.getByTestId("converter-output")).toContainText(
    "\\documentclass",
    { timeout: 60_000 },
  );
  // CodeMirror virtualizes off-screen lines, so scroll the result to its end
  // before checking the source heading that Pandoc places in the document body.
  await tauriPage
    .getByTestId("converter-output")
    .locator(".cm-scroller")
    .evaluate((scroller) => scroller.scrollTo(0, scroller.scrollHeight));
  await expect(tauriPage.getByTestId("converter-output")).toContainText(
    "A compact example",
  );

  await tauriPage.click('[data-testid="converter-tool-view-back"]');
  await expect(tauriPage.getByTestId("latex-tools-view")).toBeVisible();
});

test("dock opens the Diagram Composer as a standalone page and back returns to Library", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.click('[data-testid="open-diagram-composer"]');
  await chooseDiagramComposer(tauriPage, "tikz");
  await expect(
    tauriPage.locator('[role="dialog"][data-tour="diagram-composer"]'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("library")).toBeHidden();

  await tauriPage.click('[role="dialog"][data-tour="diagram-composer"] [aria-label="Home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await expect(
    tauriPage.locator('[role="dialog"][data-tour="diagram-composer"]'),
  ).toBeHidden();

  await tauriPage.click('[data-testid="open-diagram-composer"]');
  await chooseDiagramComposer(tauriPage, "tikz");
  await expect(
    tauriPage.locator('[role="dialog"][data-tour="diagram-composer"]'),
  ).toBeVisible({ timeout: 20_000 });
  await tauriPage.click('[role="dialog"][data-tour="diagram-composer"] [aria-label="Home"]');
});

test("dock's Search button is gated on having at least one project", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  const hasProjects = await tauriPage.evaluate<boolean>(
    `!document.querySelector('[data-testid="create-first-project"]')`,
  );
  if (!hasProjects) {
    await expect(tauriPage.locator('[data-testid="open-search"]')).toBeHidden();
    await createBlankProject(tauriPage, `E2E Home Nav ${Date.now().toString(36)}`);
    await tauriPage.evaluate(`(() => { const b = document.querySelector('[title="Back to library"]'); if (b) b.click(); return true; })()`);
    await expect(tauriPage.getByTestId("library")).toBeVisible();
  }
  await expect(tauriPage.locator('[data-testid="open-search"]')).toBeVisible();
  await tauriPage.click('[data-testid="open-search"]');
  await expect(
    tauriPage.locator('input[placeholder^="Search projects, documents"]'),
  ).toBeVisible({ timeout: 10_000 });
});
