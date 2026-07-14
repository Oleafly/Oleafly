import { test, expect } from "../fixtures";
import {
  ensureAiConnected,
  fillTextarea,
  inProviderCard,
  newChat,
  openProject,
  openRailTab,
  openSettings,
  waitLong,
} from "../helpers";

// Marker design: the assistant is asked to CONCATENATE two words, so the
// marker appears only in the REPLY, never in our own prompt. Chat titles are
// derived from the first user message and stay visible in the recent-chats
// list after "New chat", so a literal marker there would false-positive.

const TOKEN = process.env.E2E_AI_TOKEN;
const RUN = Date.now().toString(36);

async function askForConcat(
  page: Parameters<typeof fillTextarea>[0],
  chatTag: string,
  a: string,
  b: string,
) {
  const ta = 'textarea[placeholder*="Ask AI"]';
  await fillTextarea(
    page,
    ta,
    `This is ${chatTag}. Reply with exactly the concatenation of the words ` +
      `${a} and ${b} with no space between them, and nothing else. Do not use any tools.`,
  );
  await page.press(ta, "Enter");
  await waitLong(
    page,
    `document.body.innerText.includes(${JSON.stringify(a + b)}) && !document.querySelector('[aria-label="Stop"]')`,
    180_000,
  );
}

test("references panel guides toward Shift-F12", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "References (Shift-F12)");
  // Only the guidance empty-state; populated results are covered by the
  // code-intel spec's real find-references.
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('Shift-F12') || document.body.innerText.includes('References')`,
    10_000,
  );
});

test("new chat clears the transcript and history brings it back", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  test.setTimeout(300_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);

  await newChat(tauriPage);
  const tag = `chat ${RUN}h`;
  await askForConcat(tauriPage, tag, "ZEBRA", "APPLE");

  // The old chat's TITLE may stay visible in the recent list - expected.
  await tauriPage.click('[aria-label="New chat"]');
  await tauriPage.waitForFunction(
    `!document.body.innerText.includes('ZEBRAAPPLE')`,
    10_000,
  );

  await tauriPage.click('[aria-label="Chat history"]');
  await tauriPage.waitForFunction(
    `document.body.innerText.includes(${JSON.stringify(tag)})`,
    10_000,
  );
  await tauriPage.getByText(`This is ${tag}`).click();
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('ZEBRAAPPLE')`,
    10_000,
  );
});

test("custom instructions steer a real reply", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  test.setTimeout(300_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);

  // Unique per run so the Save button is always enabled (it disables when
  // the text is unchanged).
  const prefix = `MANGO${RUN}`;
  await openSettings(tauriPage, "ai");
  await tauriPage.waitForFunction(
    inProviderCard(`return (card.textContent || '').includes('Active');`),
    10_000,
  );
  const instructionTa = 'textarea[placeholder*="British English"]';
  await fillTextarea(
    tauriPage,
    instructionTa,
    `Always begin every reply with the exact word ${prefix} followed by a space.`,
  );
  await tauriPage.getByText("Save instructions").click();
  await tauriPage.waitForFunction(`document.body.innerText.includes('Saved')`, 10_000);
  await tauriPage.click('[aria-label="Close settings"]');

  await ensureAiConnected(tauriPage);
  await newChat(tauriPage);
  const ta = 'textarea[placeholder*="Ask AI"]';
  await fillTextarea(tauriPage, ta, "Say hello in three words. Do not use any tools.");
  await tauriPage.press(ta, "Enter");
  await waitLong(
    tauriPage,
    `document.body.innerText.includes(${JSON.stringify(prefix)}) && !document.querySelector('[aria-label="Stop"]')`,
    180_000,
  );

  // The modal hydrates the textarea from an async config fetch; clearing
  // before that resolves gets clobbered back to the saved text, leaving
  // Save disabled - hence the wait below before clearing.
  await openSettings(tauriPage, "ai");
  await tauriPage.waitForFunction(
    `((document.querySelector(${JSON.stringify(instructionTa)}) || {}).value || '').includes(${JSON.stringify(prefix)})`,
    10_000,
  );
  await fillTextarea(tauriPage, instructionTa, "");
  await tauriPage.getByText("Save instructions").click();
  await tauriPage.waitForFunction(`document.body.innerText.includes('Saved')`, 10_000);
  await tauriPage.click('[aria-label="Close settings"]');
});

test("the active conversation survives tab switches and sidebar collapse", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  test.setTimeout(300_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);
  await newChat(tauriPage);

  await askForConcat(tauriPage, `chat ${RUN}s`, "LEMON", "GRAPE");

  await openRailTab(tauriPage, "Source Tree");
  await openRailTab(tauriPage, "Chat / AI Assistant");
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('LEMONGRAPE')`,
    10_000,
  );

  await tauriPage.click('[aria-label="Hide sidebar"]');
  await tauriPage.click('[aria-label="Show sidebar"]');
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('LEMONGRAPE')`,
    10_000,
  );

  const copied = await tauriPage.evaluate<boolean>(
    `(() => {
      const btns = Array.from(document.querySelectorAll('[aria-label="Copy message"]'));
      if (!btns.length) return false;
      btns[btns.length - 1].click();
      return true;
    })()`,
  );
  expect(copied).toBe(true);
  await tauriPage.waitForFunction(
    `document.querySelector('[aria-label="Copy message"] svg.text-emerald-500') !== null`,
    5_000,
  );
});
