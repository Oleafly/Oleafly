import { test, expect } from "../fixtures";
import {
  ensureAiConnected,
  fillTextarea,
  newChat,
  openProject,
  openRailTab,
  openSettings,
  waitLong,
} from "../helpers";

// The references rail panel, the chat panel's session controls (new chat,
// history), custom instructions steering a real reply, and conversation
// persistence across panel remounts.
//
// Marker design: the assistant is asked to CONCATENATE two words, so the
// marker appears only in the REPLY - never in our own prompt. That matters
// because chat titles are derived from the first user message and stay
// visible in the recent-chats list after "New chat".

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
  // Fresh panel: the guidance empty-state (populated results are covered by
  // the code-intel spec, which drives a real find-references).
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

  // New chat: the reply disappears (the old chat's TITLE may stay visible in
  // the recent list - that's expected, and why the marker is reply-only).
  await tauriPage.click('[aria-label="New chat"]');
  await tauriPage.waitForFunction(
    `!document.body.innerText.includes('ZEBRAAPPLE')`,
    10_000,
  );

  // History: the old conversation is listed by its title and reopens whole.
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

  // Save an instruction with an unmistakable fingerprint. Unique per run so
  // the Save button is always enabled (it disables when the text is unchanged).
  const prefix = `MANGO${RUN}`;
  await openSettings(tauriPage, "ai");
  const instructionTa = 'textarea[placeholder*="British English"]';
  await fillTextarea(
    tauriPage,
    instructionTa,
    `Always begin every reply with the exact word ${prefix} followed by a space.`,
  );
  await tauriPage.getByText("Save instructions").click();
  await tauriPage.waitForFunction(`document.body.innerText.includes('Saved')`, 10_000);
  await tauriPage.click('[aria-label="Close settings"]');

  // ensureAiConnected is idempotent and lands with the chat input ready.
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

  // Restore: clear the instruction so later runs aren't steered.
  await openSettings(tauriPage, "ai");
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

  // Switch to the file tree and back: the conversation must still be there.
  await openRailTab(tauriPage, "Source Tree");
  await openRailTab(tauriPage, "Chat / AI Assistant");
  await tauriPage.waitForFunction(
    `document.body.innerText.includes('LEMONGRAPE')`,
    10_000,
  );

  // Collapse and reopen the sidebar: same conversation, not a new-chat view.
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
