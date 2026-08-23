import { test, expect } from "../fixtures";
import { createBlankProject } from "../helpers";

// Oleafly Tools is a glass modal over the dashboard (not a full page), and
// clicking a tool inside it hands off to that tool's own dedicated full view
// (back button returns straight to Library). Deadlines moved from its own
// dock modal into a tool card here (Research & Analyze) and is now one of
// those full views too - see 44-deadlines.spec.ts for its own coverage.
test("dock opens Tools as a modal, and a tool card hands off to a full view", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();

  await tauriPage.click('[data-testid="open-latex-tools"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await expect(tauriPage.getByText("Oleafly Tools", { exact: true })).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tool-card-deadlines"]')).toBeVisible();

  // PDF to LaTeX is a card in the Tools modal; opening it closes the modal
  // and lands on the dropzone (not an immediately-triggered OS file picker).
  await tauriPage.click('[data-testid="latex-tool-card-pdf-to-latex"]');
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="pdf-dropzone"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeHidden();

  await tauriPage.click('[data-testid="import-back"]');
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
  await expect(tauriPage.locator('[data-testid="latex-tool-card-table"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tool-card-bibtex"]')).toBeHidden();

  await tauriPage.click('[data-testid="latex-tool-card-table"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeHidden();
  await expect(tauriPage.locator('[data-testid="table-tool-view"]')).toBeVisible();
  await expect(tauriPage.getByText("LaTeX Table Generator", { exact: true })).toBeVisible();

  // Back returns straight to the Library dashboard, not to the Tools picker.
  await tauriPage.click('[data-testid="table-tool-view-back"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await expect(tauriPage.locator('[data-testid="table-tool-view"]')).toBeHidden();
});

test("dock opens the Diagram Composer as a standalone page and back returns to Library", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  // Library (and the dock with it) unmounts entirely once another home page
  // is active (Library.tsx: `if (page !== "library") return null`), so there
  // is no dock button left to check an active state on once the dialog opens.
  await tauriPage.click('[data-testid="open-diagram-composer"]');
  await expect(
    tauriPage.locator('[role="dialog"][data-tour="diagram-composer"]'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(tauriPage.getByTestId("library")).toBeHidden();

  await tauriPage.click('[role="dialog"][data-tour="diagram-composer"] [aria-label="Home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await expect(
    tauriPage.locator('[role="dialog"][data-tour="diagram-composer"]'),
  ).toBeHidden();

  // Reopening reuses the same hidden scratch project rather than creating a
  // new one each time (idempotent get-or-create on the Rust side).
  await tauriPage.click('[data-testid="open-diagram-composer"]');
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
