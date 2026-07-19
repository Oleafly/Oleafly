import { test, expect } from "../fixtures";
import {
  caretIn,
  ensureAiConnected,
  fillTextarea,
  newChat,
  openGallery,
  openProject,
  type Page,
} from "../helpers";

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

  const projectName = `E2E Figure ${RUN}`;
  await openGallery(tauriPage);
  await tauriPage.click('[data-testid="template-card-blank"]');
  await tauriPage.fill("#new-project-name", projectName);
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
  let assistantCount = await tauriPage.evaluate<number>(
    `document.querySelectorAll('[data-message-role="assistant"]').length`,
  );
  await tauriPage.press(ta, "Enter");

  let inserted = false;
  for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
    const attemptDeadline = Date.now() + 120_000;
    while (Date.now() < attemptDeadline) {
      await approveIfAsked(tauriPage);
      inserted = await tauriPage.evaluate<boolean>(
        `!!document.querySelector('[data-tool-name="insert_figure"][data-tool-status="done"][data-tool-result="success"]')`,
      );
      if (inserted) break;
      const stopped = await tauriPage.evaluate<boolean>(
        `!document.querySelector('[aria-label="Stop"]')`,
      );
      const responseArrived = await tauriPage.evaluate<number>(
        `document.querySelectorAll('[data-message-role="assistant"]').length`,
      );
      if (stopped && responseArrived > assistantCount) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!inserted && attempt < 2) {
      assistantCount = await tauriPage.evaluate<number>(
        `document.querySelectorAll('[data-message-role="assistant"]').length`,
      );
      await fillTextarea(
        tauriPage,
        ta,
        "The figure has not been inserted yet. Call insert_figure now using the valid TikZ code from your preview, with caption E2E circle. Do not reply without calling the tool.",
      );
      await tauriPage.press(ta, "Enter");
    }
  }
  expect(inserted, "insert_figure never landed a tikzpicture in the document").toBe(true);
  await openProject(tauriPage, projectName);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await tauriPage.click(".cm-content");
  await tauriPage.press(".cm-content", process.platform === "darwin" ? "Meta+End" : "Control+End");
  await tauriPage.waitForFunction(
    `(document.querySelector('.cm-content')?.textContent || '').includes('tikzpicture')`,
    5_000,
  );
});
