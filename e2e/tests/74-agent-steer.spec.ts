import { test, expect } from "../fixtures";
import { fillTextarea, openProject, openRailTab, waitLong, type Page } from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

const TA = 'textarea[placeholder*="Ask AI"]';

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});

test.afterAll(async () => {
  await server?.close();
});

async function connectAndOpenChat(page: Page) {
  await openProject(page, "E2E Doc");
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const connected = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(connected, "__aiConnect devtools hook must be present").toBe(true);
  await openRailTab(page, "Research Assistant");
  await expect(page.locator(TA)).toBeVisible({ timeout: 10_000 });
}

async function enterMessage(page: Page, text: string) {
  await fillTextarea(page, TA, text);
  await page.press(TA, "Enter");
}

async function clickChipButton(page: Page, text: string, testId: string) {
  const clicked = await page.evaluate<boolean>(`(() => {
    const chip = [...document.querySelectorAll('[data-testid="agent-follow-up-chip"]')]
      .find((element) => element.textContent?.includes(${JSON.stringify(text)}));
    const button = chip?.querySelector('[data-testid=${JSON.stringify(testId)}]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`);
  expect(clicked, `${testId} button must belong to the queued message`).toBe(true);
}

test("Enter during a stream queues messages that can be steered, discarded, and auto-sent", async ({
  tauriPage,
}) => {
  test.setTimeout(120_000);
  await connectAndOpenChat(tauriPage);

  server.setToolCall(null);
  server.setReply("AGENTSTEERBOUNDARY71");
  server.setStreamDelay(12_000);
  const initialRequestCount = server.requestCount();

  await enterMessage(tauriPage, "Keep this agent turn running.");
  await waitLong(tauriPage, `!!document.querySelector('[aria-label="Stop"]')`, 15_000);
  await expect.poll(() => server.requestCount(), { timeout: 30_000 }).toBe(
    initialRequestCount + 1,
  );

  const steerText = "Apply this direction now";
  await enterMessage(tauriPage, steerText);
  await expect(
    tauriPage.getByText(`Queued for the next turn: ${steerText}`),
  ).toBeVisible({ timeout: 5_000 });
  await new Promise<void>((resolve) => setTimeout(resolve, 750));
  expect(server.requestCount()).toBe(initialRequestCount + 1);
  expect(
    await tauriPage.evaluate<boolean>(`[...document.querySelectorAll('[data-message-role="user"]')]
      .some((element) => element.textContent?.includes(${JSON.stringify(steerText)}))`),
  ).toBe(false);
  await clickChipButton(tauriPage, steerText, "agent-follow-up-steer");

  await expect(
    tauriPage.getByText(`Steered into the running turn: ${steerText}`),
  ).toBeVisible({ timeout: 25_000 });
  await expect(tauriPage.locator('[aria-label="Stop"]')).toBeVisible();

  const discardText = "Discard this queued direction";
  await enterMessage(tauriPage, discardText);
  await expect(
    tauriPage.getByText(`Queued for the next turn: ${discardText}`),
  ).toBeVisible({ timeout: 5_000 });
  await clickChipButton(tauriPage, discardText, "agent-follow-up-discard");
  await expect(
    tauriPage.getByText(`Queued for the next turn: ${discardText}`),
  ).toHaveCount(0);

  const autoSendText = "Send this after the current turn";
  await enterMessage(tauriPage, autoSendText);
  await expect(
    tauriPage.getByText(`Queued for the next turn: ${autoSendText}`),
  ).toBeVisible({ timeout: 5_000 });

  await expect.poll(() => server.requestCount(), { timeout: 45_000 }).toBe(
    initialRequestCount + 3,
  );
  await waitLong(
    tauriPage,
    `[...document.querySelectorAll('[data-message-role="user"]')].some((element) => element.textContent?.includes(${JSON.stringify(autoSendText).replace(/</g, "\\u003c")}))`,
    10_000,
  );
  await expect(
    tauriPage.getByText(`Queued for the next turn: ${autoSendText}`),
  ).toHaveCount(0, { timeout: 20_000 });
  await waitLong(tauriPage, `!document.querySelector('[aria-label="Stop"]')`, 25_000);
  server.setStreamDelay(0);
});
