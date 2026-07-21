import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "../fixtures";
import { openProject, openRailTab, waitLong, type Page } from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

// Tier 2 of the import pipeline: the refine handoff and image-to-LaTeX both
// need a vision-capable model, so connect the keyless Ollama provider with a
// "llava" model id against the mock server (llava passes modelSupportsVision).

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});
test.afterAll(async () => {
  await server?.close();
});

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(join(here, "..", "fixture-files", name)).toString("base64");

async function connectVision(page: Page) {
  const ok = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llava") ?? false`,
  );
  expect(ok, "__aiConnect devtools hook must be present").toBe(true);
}

test("refine with AI creates the project and hands off to the agent", async ({ tauriPage }) => {
  test.setTimeout(180_000);
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]') as Parameters<
      typeof expect
    >[0],
  ).toBeVisible({ timeout: 30_000 });
  await connectVision(tauriPage);
  const before = server.requestCount();
  await tauriPage.evaluate<boolean>(
    `(window.__importFile(${JSON.stringify("refine.pdf")}, ${JSON.stringify(
      fixture("tiny.pdf"),
    )}), true)`,
  );
  await expect(tauriPage.locator('[data-testid="pdf-import-view"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(tauriPage.locator('[data-testid="import-refine"]')).toBeVisible({
    timeout: 20_000,
  });
  await tauriPage.click('[data-testid="import-refine"]');
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 60_000 });
  await openRailTab(tauriPage, "Chat / AI Assistant");
  const deadline = Date.now() + 60_000;
  while (server.requestCount() <= before) {
    if (Date.now() > deadline) throw new Error("agent handoff never reached the model");
    await new Promise((r) => setTimeout(r, 1000));
  }
});

test("image to LaTeX transcribes into the editor", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await expect(
    tauriPage.locator('[data-testid="library"][data-projects-loaded="true"]') as Parameters<
      typeof expect
    >[0],
  ).toBeVisible({ timeout: 30_000 });
  await connectVision(tauriPage);
  server.setReply("\\begin{equation}E=mc^2\\end{equation}");
  await openProject(tauriPage, "refine");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 30_000 });
  await expect(tauriPage.locator('[data-testid="image-to-latex-input"]')).toBeAttached({
    timeout: 20_000,
  });
  const RED_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAOElEQVR42u3OMQEAAAgDoK1/aM3g4QcFaCbvKpFIJBKJRCKRSCQSiUQikUgkEolEIpFIJBLJpiXW5QG/aCsc/gAAAABJRU5ErkJggg==";
  await tauriPage.evaluate(
    `(() => {
      const input = document.querySelector('[data-testid="image-to-latex-input"]');
      const bytes = Uint8Array.from(atob(${JSON.stringify(RED_PNG)}), (c) => c.charCodeAt(0));
      const file = new File([bytes], "equation.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`,
  );
  await waitLong(
    tauriPage,
    `(document.querySelector(".cm-content")?.textContent ?? "").includes("E=mc^2")`,
    60_000,
  );
});
