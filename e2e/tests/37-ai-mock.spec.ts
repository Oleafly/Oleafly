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
  await openRailTab(page, "Research Assistant");
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

async function sendAndWait(page: Page, text: string, marker: string) {
  server.setReply(marker);
  server.setToolCall(null);
  await fillTextarea(page, TA, text);
  await page.press(TA, "Enter");
  await waitLong(
    page,
    `document.body.innerText.includes(${JSON.stringify(marker)}) && !document.querySelector('[aria-label="Stop"]')`,
    30_000,
  );
}

test("Up recalls the last prompt in an empty message box", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await connectAndOpenChat(tauriPage);
  await sendAndWait(tauriPage, "first prompt", "RECALL1");
  await tauriPage.locator(TA).focus();
  await tauriPage.keyboard.press("ArrowUp");
  await expect(tauriPage.locator(TA)).toHaveValue("first prompt");
});

test("the message box keeps the height the user gives it", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await connectAndOpenChat(tauriPage);
  const handle = tauriPage.getByRole("separator", { name: "Resize the message box" });
  await handle.focus();
  for (let step = 0; step < 3; step += 1) await tauriPage.keyboard.press("ArrowUp");
  const grown = await tauriPage.locator(TA).evaluate((element) => element.getBoundingClientRect().height);
  expect(grown).toBeGreaterThanOrEqual(116);
  await openRailTab(tauriPage, "Explorer");
  await openRailTab(tauriPage, "Research Assistant");
  await expect(tauriPage.locator(TA)).toBeVisible();
  const kept = await tauriPage.locator(TA).evaluate((element) => element.getBoundingClientRect().height);
  expect(kept).toBeGreaterThanOrEqual(116);
});

test("a dropped text file reaches the model as text", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await connectAndOpenChat(tauriPage);
  await tauriPage.evaluate(`(() => {
    const target = document.querySelector("[data-chat-composer]");
    if (!target) throw new Error("composer missing");
    const transfer = new DataTransfer();
    transfer.items.add(new File(["E2EATTACH77"], "notes.txt", { type: "text/plain" }));
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }
    return true;
  })()`);
  await expect(tauriPage.locator('[data-status="ready"]')).toBeVisible({ timeout: 15_000 });
  server.resetRequests();
  await sendAndWait(tauriPage, "Summarize the attached notes.", "ATTACHDONE");
  expect(server.requestBodies().some((body) => body.includes("E2EATTACH77"))).toBe(true);
});

test("Regenerate sends the last prompt again", async ({ tauriPage }) => {
  test.setTimeout(90_000);
  await connectAndOpenChat(tauriPage);
  await sendAndWait(tauriPage, "Say the regenerate marker.", "REGEN1");
  const before = server.requestCount();
  server.setReply("REGEN2");
  // The button shows on hover, which a dispatched event can't trigger, so click it directly.
  const clicked = await tauriPage.evaluate<boolean>(`(() => {
    const buttons = [...document.querySelectorAll('[data-testid="message-action-regenerate"][aria-label="Regenerate reply"]')];
    if (!buttons.length) return false;
    buttons[buttons.length - 1].click();
    return true;
  })()`);
  expect(clicked).toBe(true);
  await waitLong(
    tauriPage,
    `document.body.innerText.includes('REGEN2') && !document.querySelector('[aria-label="Stop"]')`,
    30_000,
  );
  expect(server.requestCount()).toBeGreaterThan(before);
  expect(server.requestBodies().at(-1)).toContain("Say the regenerate marker.");
});
