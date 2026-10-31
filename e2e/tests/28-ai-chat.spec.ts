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

const TOKEN = process.env.E2E_AI_TOKEN;
const PROVIDER = process.env.E2E_AI_PROVIDER || "Z.AI";

test("connect an AI provider through the settings UI", async ({ tauriPage }) => {
  // Ignored on purpose without a live AI token, because the run calls a real provider.
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openSettings(tauriPage, "ai");
  await expandProviderCard(tauriPage);
  await tauriPage.evaluate(
    inProviderCard(`
      const replace = card.querySelector('[data-testid^="ai-provider-replace-"]');
      if (replace) replace.click();
      return 1;
    `),
  );
  await tauriPage
    .waitForFunction(
      inProviderCard(`return !!card.querySelector('input[type="password"]');`),
      5_000,
    )
    .catch(() => {});
  await tauriPage.evaluate(
    inProviderCard(`
      const input = card.querySelector('input[type="password"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(input, ${JSON.stringify(TOKEN)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 1;
    `),
  );
  await tauriPage
    .waitForFunction(
      inProviderCard(
        `return Array.from(card.querySelectorAll('button')).some(b => ['Save', 'Activate'].includes(b.textContent.trim()));`,
      ),
      5_000,
    )
    .catch(() => {});
  const clicked = await tauriPage.evaluate<boolean>(
    inProviderCard(`
      const btn = Array.from(card.querySelectorAll('button'))
        .find(b => ['Save', 'Activate'].includes(b.textContent.trim()));
      if (!btn) return false;
      btn.click();
      return true;
    `),
  );
  if (clicked) {
    await tauriPage.waitForFunction(
      inProviderCard(`return (card.textContent || '').includes('Connected');`),
      10_000,
    );
  }
  await tauriPage.click('[aria-label="Close settings"]');

  await openRailTab(tauriPage, "Research Assistant");
  await expect(
    tauriPage.locator('[data-tour="ai-assistant"][data-tour-configured="true"]'),
  ).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.locator('textarea[placeholder*="Ask AI"]')).toBeVisible({
    timeout: 10_000,
  });
});

test("choose the GLM-4.6 model in settings and persist it", async ({ tauriPage }) => {
  // Ignored on purpose without a live AI token, because the run calls a real provider.
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);

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
  // Ignored on purpose without a live AI token, because the run calls a real provider.
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  test.setTimeout(180_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);
  await pickModel(tauriPage, "GLM-5.2");
  await newChat(tauriPage);

  const ta = 'textarea[placeholder*="Ask AI"]';
  await expect(tauriPage.locator(ta)).toBeVisible({ timeout: 10_000 });
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
  // Ignored on purpose without a live AI token, because the run calls a real provider.
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run");
  test.setTimeout(240_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await ensureAiConnected(tauriPage);
  await newChat(tauriPage);

  const ta = 'textarea[placeholder*="Ask AI"]';
  await expect(tauriPage.locator(ta)).toBeVisible({ timeout: 10_000 });
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
