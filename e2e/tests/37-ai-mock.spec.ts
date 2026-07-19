import { test, expect } from "../fixtures";
import { fillTextarea, openProject, openRailTab, waitLong, type Page } from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

// A REAL AI conversation with NO key and NO network: the keyless "Ollama
// (local)" provider streams via `<host>/v1/chat/completions`, so we point it
// at a local fake OpenAI-compatible server (mock-ai-server.ts) and the actual
// streaming/usage/handoff pipeline runs in CI. __aiConnect stands in only for
// the Settings connect step; the conversation itself is real. This closes the
// coverage gap where CI never exercised a real conversation (28/35/31 are
// token-gated and skipped there).

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});
test.afterAll(async () => {
  await server?.close();
});

const TA = 'textarea[placeholder*="Ask AI"]';

async function connectAndOpenChat(page: Page) {
  await openProject(page, "E2E Doc");
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Set the provider BEFORE the panel mounts, so ChatPanel reads the connected
  // config on mount rather than relying on a live config-changed event.
  const ok = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(ok, "__aiConnect devtools hook must be present").toBe(true);
  await openRailTab(page, "Chat / AI Assistant");
  await expect(page.locator(TA)).toBeVisible({ timeout: 10_000 });
}

test("a real streamed conversation round-trips and records usage", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await connectAndOpenChat(tauriPage);

  server.setReply("MOCKPONG42");
  server.setToolCall(null);
  await fillTextarea(tauriPage, TA, "Reply with the marker.");
  await tauriPage.press(TA, "Enter");

  await waitLong(
    tauriPage,
    `document.body.innerText.includes('MOCKPONG42') && !document.querySelector('[aria-label="Stop"]')`,
    30_000,
  );
  await expect(tauriPage.getByTestId("ai-chat-usage")).not.toBeVisible();
  const usageButton = tauriPage.locator('button[aria-label="View AI usage"]');
  await expect(usageButton).toBeVisible({ timeout: 10_000 });
  await usageButton.click();
  await expect(tauriPage.getByTestId("ai-run-usage")).toBeVisible({ timeout: 5_000 });
  await expect(tauriPage.getByTestId("ai-chat-usage")).toBeVisible();
});

test("the assistant runs a real tool call end to end", async ({ tauriPage }) => {
  test.setTimeout(90_000);
  await connectAndOpenChat(tauriPage);

  // The mock's `then` triggers a second turn carrying the tool result, which
  // streams the confirmation text.
  server.setToolCall({ name: "read_file", args: { path: "main.tex" }, then: "READFILEDONE99" });
  await fillTextarea(tauriPage, TA, "Read main.tex, then confirm.");
  await tauriPage.press(TA, "Enter");

  await waitLong(
    tauriPage,
    `document.body.innerText.includes('READFILEDONE99') && !document.querySelector('[aria-label="Stop"]')`,
    45_000,
  );
  expect(server.requestCount()).toBeGreaterThanOrEqual(2);
});

test("agent handoff delivers the prompt into the live composer", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await connectAndOpenChat(tauriPage);

  const marker = `E2E handoff ${Date.now().toString(36)}`;
  await tauriPage.evaluate(`window.__agentHandoff?.(${JSON.stringify(marker)}, false)`);
  // Provider is connected here, so unlike 36-ai-agentic.spec.ts this can assert
  // hard instead of soft-gating on `if (hasInput)`.
  await expect
    .poll(
      async () =>
        tauriPage.evaluate<string>(
          `document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')?.value ?? ""`,
        ),
      { timeout: 8_000 },
    )
    .toContain(marker);
});
