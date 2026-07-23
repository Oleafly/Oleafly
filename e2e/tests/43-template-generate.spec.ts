import { test, expect } from "../fixtures";
import { fillTextarea, openGallery, waitLong } from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

// Generator gating reads the configured provider, so connect the keyless
// Ollama provider (mock server) before opening the gallery.

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});
test.afterAll(async () => {
  await server?.close();
});

const GENERATED = JSON.stringify({
  slug: "e2e-generated-note",
  name: "E2E Generated Note",
  description: "Generated during e2e.",
  category: "Custom",
  engine: "markdown",
  main_doc: "main.md",
  source: "---\ntitle: Generated\n---\n\n# Generated Note\n\nBody.\n",
});

test("generate with AI saves a reusable custom template", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  const ok = await tauriPage.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(ok, "__aiConnect devtools hook must be present").toBe(true);
  server.setReply(GENERATED);
  await openGallery(tauriPage);
  await expect(tauriPage.locator('[data-testid="generate-template-with-ai"]')).toBeVisible({
    timeout: 20_000,
  });
  await tauriPage.click('[data-testid="generate-template-with-ai"]');
  await expect(tauriPage.locator('[data-testid="template-generate-modal"]')).toBeVisible();
  await fillTextarea(
    tauriPage,
    '[data-testid="template-generate-input"]',
    "A short markdown note template",
  );
  await tauriPage.click('[data-testid="template-generate-run"]');
  await expect(tauriPage.locator('[data-testid="template-generate-save"]')).toBeVisible({
    timeout: 60_000,
  });
  await tauriPage.click('[data-testid="template-generate-save"]');
  await waitLong(
    tauriPage,
    `!!document.querySelector('[data-testid="template-card-e2e-generated-note"]')`,
    20_000,
  );
});
