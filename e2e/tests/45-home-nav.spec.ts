import { test, expect } from "../fixtures";

// Regression: the sidebar used to open each home-shell page (deadlines,
// pdf-import, latex-tools) as its own independent overlay, so switching
// straight from one to another left both mounted and visible; the user had
// to click Back first. All four pages are now gated on a single active-page
// store, so clicking a different nav item switches directly.
test("sidebar switches directly between home pages without closing first", async ({
  tauriPage,
}) => {
  await expect(tauriPage.getByTestId("library")).toBeVisible();

  await tauriPage.click('[data-testid="open-deadlines"]');
  await expect(tauriPage.locator('[data-testid="deadlines-view"]')).toBeVisible({
    timeout: 20_000,
  });

  // Switch straight to LaTeX Tools without clicking Back.
  await tauriPage.click('[data-testid="open-latex-tools"]');
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="deadlines-view"]')).toBeHidden();

  // PDF to LaTeX now lives only as a card in the LaTeX Tools gallery; opening
  // it switches straight there and lands on the dropzone (not an
  // immediately-triggered OS file picker).
  await tauriPage.click('[data-testid="latex-tool-card-pdf-to-latex"]');
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="pdf-dropzone"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tools-view"]')).toBeHidden();

  // The logo returns to the library directly.
  await tauriPage.click('[data-testid="sidebar-home"]');
  await expect(tauriPage.getByTestId("library")).toBeVisible();
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeHidden();
});

test("LaTeX Tools gallery filters by category and search, and opens a tool", async ({
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
  await expect(tauriPage.getByText("LaTeX Table Generator", { exact: true })).toBeVisible();
  await expect(tauriPage.locator('[data-testid="latex-tool-card-table"]')).toBeHidden();

  await tauriPage.click('[data-testid="latex-tools-back"]');
  await expect(tauriPage.locator('[data-testid="latex-tool-card-bibtex"]')).toBeVisible();
});
