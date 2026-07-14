import { test, expect } from "../fixtures";
import { caretIn, ensureAiConnected, fillTextarea, newChat, openGallery, type Page } from "../helpers";

// Runs in a throwaway project so the inserted tikzpicture never poisons
// E2E Doc's compiles. Opt-in via E2E_AI_TOKEN; the model's output is
// nondeterministic, so the prompt pins it to the smallest possible task and
// the assertions check the pipeline, not the drawing.

const TOKEN = process.env.E2E_AI_TOKEN;
const RUN = Date.now().toString(36);

async function approveIfAsked(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(
    `(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === 'Approve');
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
}

test("figure mode generates, previews, and inserts a real TikZ figure", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  test.setTimeout(480_000);

  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank"]');
  await tauriPage.fill("#new-project-name", `E2E Figure ${RUN}`);
  await tauriPage.click('[data-testid="create-project"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Caret must sit in the prose, not the preamble, or the insertion breaks the document.
  await caretIn(tauriPage, "here.", 1, "end");

  await ensureAiConnected(tauriPage);
  await newChat(tauriPage);
  await tauriPage.click('[aria-label="Toggle figure mode"]');

  const ta = 'textarea[placeholder*="Describe a figure"]';
  await expect(tauriPage.locator(ta)).toBeVisible({ timeout: 10_000 });
  await fillTextarea(
    tauriPage,
    ta,
    "Draw the simplest possible TikZ figure: one filled blue circle of radius 1. " +
      "Verify it compiles with preview_figure, then insert it with insert_figure " +
      "(caption: E2E circle). Keep the code minimal and do not iterate on style.",
  );
  await tauriPage.press(ta, "Enter");

  const deadline = Date.now() + 420_000;
  let inserted = false;
  while (Date.now() < deadline) {
    await approveIfAsked(tauriPage);
    inserted = await tauriPage.evaluate<boolean>(
      `(document.querySelector('.cm-content')?.textContent || '').includes('tikzpicture')`,
    );
    if (inserted) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  expect(inserted, "insert_figure never landed a tikzpicture in the document").toBe(true);

  // The badge may render the raw tool id or a prettified label.
  const transcript = await tauriPage.evaluate<string>(`document.body.innerText.toLowerCase()`);
  expect(transcript.includes("insert_figure") || transcript.includes("insert figure")).toBe(true);
});
