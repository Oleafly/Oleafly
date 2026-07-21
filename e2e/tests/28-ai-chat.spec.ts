import { test, expect } from "../fixtures";
import {
  ensureAiConnected,
  expandProviderCard,
  fillTextarea,
  inProviderCard,
  newChat,
  openProject,
  openRailTab,
  openSettings,
  waitLong,
} from "../helpers";

// Real AI conversations against a real provider. Opt in by setting
// E2E_AI_TOKEN (and optionally E2E_AI_PROVIDER, default "Z.AI") in e2e/.env.
// The key is saved through the actual Settings UI into the hermetic data
// dir's config - nothing touches your real ~/.oleafly.

const TOKEN = process.env.E2E_AI_TOKEN;
// Visible provider-card name in Settings -> AI (substring match).
const PROVIDER = process.env.E2E_AI_PROVIDER || "Z.AI";

test("connect an AI provider through the settings UI", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openSettings(tauriPage, "ai");
  await expandProviderCard(tauriPage);
  // Everything below is scoped to the provider CARD: OpenAI and Z.AI share
  // the same input placeholder and Save label, and a page-wide selector once
  // saved the key into the wrong provider.
  await tauriPage.evaluate(
    inProviderCard(`
      const input = card.querySelector('input[type="password"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(input, ${JSON.stringify(TOKEN)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    `),
  );
  // Re-runs: filling the SAME saved key leaves the card clean (no Save).
  // On first connect the button renders one React frame after the input
  // event, so give it a moment instead of querying immediately.
  await tauriPage
    .waitForFunction(
      inProviderCard(
        `return Array.from(card.querySelectorAll('button')).some(b => ['Save', 'Use'].includes(b.textContent.trim()));`,
      ),
      5_000,
    )
    .catch(() => {});
  const clicked = await tauriPage.evaluate<boolean>(
    inProviderCard(`
      const btn = Array.from(card.querySelectorAll('button'))
        .find(b => ['Save', 'Use'].includes(b.textContent.trim()));
      if (!btn) return false;
      btn.click();
      return true;
    `),
  );
  if (clicked) {
    await tauriPage.waitForFunction(
      inProviderCard(`return (card.textContent || '').includes('Active');`),
      10_000,
    );
  }
  await tauriPage.click('[aria-label="Close settings"]');

  // The chat panel now offers the real input instead of the onboarding gate.
  await openRailTab(tauriPage, "Chat / AI Assistant");
  await expect(
    tauriPage.locator('[data-tour="ai-assistant"][data-tour-configured="true"]'),
  ).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator('textarea[placeholder*="Ask AI"]')).toBeVisible({
    timeout: 10_000,
  });
});

test("choose the GLM-4.6 model in settings and persist it", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);

  await openSettings(tauriPage, "ai");
  await expandProviderCard(tauriPage);
  // The model select lives inside the provider card; the chat panel behind
  // the modal has its own provider/model menu, so never search page-wide.
  // It renders only after the modal's async config fetch marks the provider
  // Active, so wait for it instead of querying immediately.
  await tauriPage.waitForFunction(
    inProviderCard(`return !!card.querySelector('[role="combobox"]');`),
    10_000,
  );
  await tauriPage.evaluate(
    inProviderCard(`
      const combo = card.querySelector('[role="combobox"]');
      if (!combo) throw new Error('model select not found in the provider card');
      combo.click();
      return 1;
    `),
  );
  await tauriPage.waitForFunction(`!!document.querySelector('[role="option"]')`, 5_000);
  const options = await tauriPage.evaluate<string>(
    `(() => {
      const opts = Array.from(document.querySelectorAll('[role="option"]'));
      const target = opts.find(o => o.textContent.trim() === 'GLM-4.6');
      if (!target) return JSON.stringify(opts.map(o => o.textContent.trim()));
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      target.click();
      return 'picked';
    })()`,
  );
  expect(options, `GLM-4.6 missing; options were: ${options}`).toBe("picked");
  await tauriPage.click('[aria-label="Close settings"]');

  await openSettings(tauriPage, "ai");
  await expandProviderCard(tauriPage);
  await tauriPage.waitForFunction(
    inProviderCard(`return Array.from(card.querySelectorAll('[role="combobox"]')).some(c => (c.textContent || '').includes('GLM-4.6'));`),
    10_000,
  );
});

async function pickModel(tauriPage: Parameters<typeof ensureAiConnected>[0], label: string) {
  await openSettings(tauriPage, "ai");
  await expandProviderCard(tauriPage);
  await tauriPage.waitForFunction(
    inProviderCard(`return !!card.querySelector('[role="combobox"]');`),
    10_000,
  );
  await tauriPage.evaluate(
    inProviderCard(`
      const combo = card.querySelector('[role="combobox"]');
      if (!combo) throw new Error('model select not found in the provider card');
      combo.click();
      return 1;
    `),
  );
  await tauriPage.waitForFunction(`!!document.querySelector('[role="option"]')`, 5_000);
  const picked = await tauriPage.evaluate<string>(
    `(() => {
      const opts = Array.from(document.querySelectorAll('[role="option"]'));
      const target = opts.find(o => o.textContent.trim() === ${JSON.stringify(label)});
      if (!target) return JSON.stringify(opts.map(o => o.textContent.trim()));
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      target.click();
      return 'picked';
    })()`,
  );
  expect(picked, `${label} missing; options were: ${picked}`).toBe("picked");
  await tauriPage.click('[aria-label="Close settings"]');
}

test("a real conversation round-trip", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  test.setTimeout(180_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);
  await pickModel(tauriPage, "GLM-5.2");
  await newChat(tauriPage); // restored transcripts must not satisfy the waits

  const ta = 'textarea[placeholder*="Ask AI"]';
  await expect(tauriPage.locator(ta)).toBeVisible({ timeout: 10_000 });
  // Concatenation marker: the reply contains PINGPONG but our prompt never
  // does, so neither our own bubble nor a case-variant reply can fool the
  // wait. (The plugin caps wait_for_function at ~30s server-side; reasoning
  // models take longer, so poll client-side via waitLong.)
  await fillTextarea(
    tauriPage,
    ta,
    "Reply with exactly the concatenation of the words PING and PONG in capitals " +
      "with no space between them, and nothing else. Do not use any tools.",
  );
  await tauriPage.press(ta, "Enter");
  await waitLong(
    tauriPage,
    `document.body.innerText.includes('PINGPONG') && !document.querySelector('[aria-label="Stop"]')`,
    180_000,
  );
});

test("the assistant can use a real project tool", async ({ tauriPage }) => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  test.setTimeout(240_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);
  await newChat(tauriPage); // restored transcripts must not satisfy the waits

  const ta = 'textarea[placeholder*="Ask AI"]';
  await expect(tauriPage.locator(ta)).toBeVisible({ timeout: 10_000 });
  // Reply-only marker: old chat titles in the recent list contain the words
  // "read_file", and the outline shows section names - so the assertion must
  // be a string only a REAL tool-informed reply can produce.
  await fillTextarea(
    tauriPage,
    ta,
    "Call the read_file tool on main.tex. Then reply with the name of the first " +
      "\\section in that file, immediately followed by the word VERIFIED, " +
      "concatenated with no space. Nothing else.",
  );
  await tauriPage.press(ta, "Enter");
  await waitLong(
    tauriPage,
    `document.body.innerText.includes('IntroductionVERIFIED') && !document.querySelector('[aria-label="Stop"]')`,
    180_000,
  );
});
