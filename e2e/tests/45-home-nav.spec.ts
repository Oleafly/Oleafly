import { test, expect } from "../fixtures";

// Deadlines and LaTeX Tools are now glass modals over the dashboard (not
// full pages), and clicking a tool inside the Tools modal hands off to that
// tool's own dedicated full view (back button returns straight to Library).
test("dock opens Deadlines and Tools as modals, mutually exclusive", async ({ tauriPage }) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();

  await tauriPage.click('[data-testid="open-deadlines"]');
  await expect(tauriPage.locator('[data-testid="deadlines-view"]')).toBeVisible({
    timeout: 20_000,
  });

  // Opening Tools while Deadlines is open closes Deadlines first.
  await tauriPage.click('[data-testid="open-latex-tools"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="deadlines-view"]')).toBeHidden();

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

test("LaTeX Tools gallery filters by category and search, and opens a dedicated tool view", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await tauriPage.click('[data-testid="open-latex-tools"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tool-card-bibtex"]')).toBeVisible();

  await tauriPage.fill('input[placeholder^="Search"]', "table");
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
