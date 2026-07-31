import { test, expect } from "../fixtures";

/**
 * Document citation scan + paper review UI (OpenLeaf parity surfaces).
 * Live literature/LLM calls are avoided via DEV hooks that seed results.
 */

async function openCitationSearch(page: {
  click: (s: string) => Promise<void>;
  locator: (s: string) => { waitFor: (o?: { state?: string; timeout?: number }) => Promise<void> };
  getByTestId: (id: string) => unknown;
}) {
  await expect(page.getByTestId("library") as never).toBeVisible();
  await page.click('[data-testid="open-latex-tools"]');
  await expect(page.locator('[data-testid="latex-tools-view"]') as never).toBeVisible();
  // Tool card id from tool-catalog: literature-search
  await page.click('[data-testid="latex-tool-card-literature-search"]');
  await expect(page.locator('[data-testid="literature-search-panel"]') as never).toBeVisible({
    timeout: 15_000,
  });
}

test("Citation Search exposes From document and Review modes; e2e hooks seed results", async ({
  tauriPage,
}) => {
  await openCitationSearch(tauriPage);

  await expect(tauriPage.locator('[data-testid="citation-search-mode"]')).toBeVisible();
  await tauriPage.click('[data-testid="citation-search-mode-document"]');
  await expect(
    tauriPage.locator('[data-testid="document-citation-scan-panel"]'),
  ).toBeVisible({ timeout: 10_000 });

  const hookReady = await tauriPage.evaluate<boolean>(
    `typeof window.__e2eDocumentCitation?.seedResults === "function"`,
  );
  expect(hookReady, "__e2eDocumentCitation hook must be present in DEV").toBe(true);

  // The bridge evaluates a single expression; multi-statement scripts hang.
  await tauriPage.evaluate(`(() => {
    window.__e2eDocumentCitation.setSourceOverride(
      "Graph neural networks are used for molecule generation in this work.\\n\\n" +
      "Transformers also appear in related protein folding research."
    );
    window.__e2eDocumentCitation.seedResults([
      {
        paragraphIndex: 0,
        paragraphPreview: "Graph neural networks are used for molecule generation…",
        query: "graph neural networks molecule generation",
        sourceErrors: [],
        suggestions: [
          {
            score: 88,
            reasoning: { for: "Core method paper", against: "Older work" },
            record: {
              id: "e2e:gcn",
              sourceIds: { openalex: "W1" },
              sources: ["openalex"],
              title: "Semi-Supervised Classification with Graph Convolutional Networks",
              authors: ["Kipf", "Welling"],
              year: 2017,
              publicationDate: null,
              venue: "ICLR",
              type: "article",
              doi: "10.1000/e2e-gcn",
              url: "https://doi.org/10.1000/e2e-gcn",
              pdfUrl: null,
              abstract: "GCN intro",
              citationCount: 1000,
              openAccess: true,
            },
          },
        ],
      },
    ]);
    return true;
  })()`);

  await expect(tauriPage.getByText("Paragraph 1", { exact: false })).toBeVisible({
    timeout: 5_000,
  });
  await expect(
    tauriPage.getByText("Semi-Supervised Classification with Graph Convolutional Networks", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    tauriPage.locator('[title="Relevance score"]'),
  ).toContainText("88");

  // Review mode
  await tauriPage.click('[data-testid="citation-search-mode-review"]');
  await expect(tauriPage.locator('[data-testid="paper-review-panel"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(tauriPage.locator('[data-testid="paper-review-mode-friendly"]')).toBeVisible();
  await expect(tauriPage.locator('[data-testid="paper-review-mode-fire"]')).toBeVisible();

  const reviewHook = await tauriPage.evaluate<boolean>(
    `typeof window.__e2ePaperReview?.seed === "function"`,
  );
  expect(reviewHook, "__e2ePaperReview hook must be present in DEV").toBe(true);

  await tauriPage.evaluate(`(window.__e2ePaperReview.seed(
    "friendly",
    "## Summary\\n\\nA solid contribution with clear strengths.\\n\\n## Strengths\\n\\n- Clear motivation"
  ), true)`);
  await expect(tauriPage.getByText("A solid contribution", { exact: false })).toBeVisible({
    timeout: 5_000,
  });
});
