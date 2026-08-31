import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillTextarea,
  openRailTab,
  openSettings,
  waitLong,
  type Page,
} from "../helpers";

const TOOLS_DISCLOSURE = "The assistant currently supports these tools";

async function openAiTab(page: Page, tab: "providers" | "instructions" | "personas") {
  const trigger = page.locator(`[data-testid="ai-settings-tab-${tab}"]`);
  await trigger.focus();
  await trigger.press("Enter");
  await waitLong(
    page,
    `document.querySelector('[data-testid="ai-settings-tab-${tab}"]')?.getAttribute('data-state') === 'active'`,
    8_000,
  );
}

async function expandProvider(page: Page, id: string) {
  await page.evaluate(
    `(() => {
      const card = document.querySelector('[data-testid="ai-provider-card-${id}"]');
      if (!card) throw new Error('provider card missing: ${id}');
      const header = card.querySelector('button[aria-expanded]');
      if (header && header.getAttribute('aria-expanded') !== 'true') header.click();
      return 1;
    })()`,
  );
}

async function confirmDialog(page: Page, label: string) {
  const dialog = page.locator('[role="alertdialog"]');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await dialog.getByText(label, { exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 8_000 });
}

async function openPersonaMenu(page: Page) {
  await page.evaluate(
    `(() => {
      const btn = document.querySelector('[data-tour="ai-persona"] button');
      if (!btn) throw new Error('Persona trigger not found');
      btn.click();
      return 1;
    })()`,
  );
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="ai-persona-create"], [data-testid="ai-persona-none"]')`,
    8_000,
  );
}

test("connect a provider and manage its models with validation and restore", async ({ tauriPage }) => {
  const page = tauriPage;
  await openSettings(page, "ai");
  await expect(page.locator('[data-testid="ai-settings-tab-providers"]')).toBeVisible();
  await expect(page.getByText(TOOLS_DISCLOSURE)).toBeHidden();

  await expandProvider(page, "perplexity");
  await page.fill('[data-testid="ai-provider-key-perplexity"]', "pplx-e2e-test");
  await expect(page.locator('[data-testid="ai-provider-save-perplexity"]')).toBeVisible({
    timeout: 8_000,
  });
  await page.click('[data-testid="ai-provider-save-perplexity"]');
  await expect(page.locator('[data-testid="ai-provider-status-perplexity"]')).toContainText(
    "Key valid",
    { timeout: 10_000 },
  );
  await expect(
    page.locator('[data-testid="ai-provider-card-perplexity"]').getByText("Connected"),
  ).toBeVisible();

  await expect(page.locator('[data-testid="ai-model-row-sonar"]')).toBeVisible();

  await page.click('[data-testid="ai-add-model-submit-perplexity"]');
  await expect(page.locator('[data-testid="ai-add-model-error-perplexity"]')).toContainText(
    "Enter a model id",
  );
  await page.fill('[data-testid="ai-add-model-id-perplexity"]', "two words");
  await page.click('[data-testid="ai-add-model-submit-perplexity"]');
  await expect(page.locator('[data-testid="ai-add-model-error-perplexity"]')).toContainText(
    "can't contain spaces",
  );
  await page.fill('[data-testid="ai-add-model-id-perplexity"]', "sonar");
  await page.click('[data-testid="ai-add-model-submit-perplexity"]');
  await expect(page.locator('[data-testid="ai-add-model-error-perplexity"]')).toContainText(
    "already in the list",
  );
  await page.fill('[data-testid="ai-add-model-id-perplexity"]', "test-model");
  await page.click('[data-testid="ai-add-model-submit-perplexity"]');
  await expect(page.locator('[data-testid="ai-model-row-test-model"]')).toBeVisible();

  await page.click('[data-testid="ai-model-delete-test-model"]');
  await confirmDialog(page, "Delete");
  await expect(page.locator('[data-testid="ai-model-row-test-model"]')).toBeHidden();

  await expect(page.locator('[data-testid="ai-restore-models-perplexity"]')).toBeHidden();
  await page.click('[data-testid="ai-model-delete-sonar"]');
  await confirmDialog(page, "Delete");
  await expect(page.locator('[data-testid="ai-model-row-sonar"]')).toBeHidden();
  await page.click('[data-testid="ai-restore-models-perplexity"]');
  await expect(page.locator('[data-testid="ai-model-row-sonar"]')).toBeVisible();
  await expect(page.locator('[data-testid="ai-restore-models-perplexity"]')).toBeHidden();

  await page.click('[aria-label="Close settings"]');
});

test("custom provider dialog validates its fields inline", async ({ tauriPage }) => {
  const page = tauriPage;
  await openSettings(page, "ai");
  await page.click('[data-testid="ai-add-custom-provider"]');
  await expect(page.locator('[data-testid="custom-provider-submit"]')).toBeVisible({
    timeout: 8_000,
  });

  await page.click('[data-testid="custom-provider-submit"]');
  await expect(page.locator('[data-testid="custom-provider-id-error"]')).toBeVisible();
  await expect(page.locator('[data-testid="custom-provider-name-error"]')).toBeVisible();
  await expect(page.locator('[data-testid="custom-provider-baseurl-error"]')).toBeVisible();

  await page.fill('[data-testid="custom-provider-id"]', "acme");
  await page.fill('[data-testid="custom-provider-name"]', "Acme");
  await page.fill('[data-testid="custom-provider-baseurl"]', "sdcsdc");
  await page.click('[data-testid="custom-provider-submit"]');
  await expect(page.locator('[data-testid="custom-provider-id-error"]')).toBeHidden();
  await expect(page.locator('[data-testid="custom-provider-name-error"]')).toBeHidden();
  await expect(page.locator('[data-testid="custom-provider-baseurl-error"]')).toContainText(
    "full URL",
  );

  await page.press("body", "Escape");
  await expect(page.locator('[data-testid="custom-provider-submit"]')).toBeHidden();
  await page.evaluate(
    `(() => { const b = document.querySelector('[aria-label="Close settings"]'); if (b instanceof HTMLElement) b.click(); return 1; })()`,
  );
});

test("instructions tab hosts the tools list and a working default-model picker", async ({
  tauriPage,
}) => {
  const page = tauriPage;
  await openSettings(page, "ai");
  await openAiTab(page, "instructions");

  await expect(page.getByText(TOOLS_DISCLOSURE)).toBeVisible();
  const disclosureExpanded = await page.evaluate<string>(
    `(() => {
      const btn = Array.from(document.querySelectorAll('button[aria-expanded]'))
        .find(b => (b.textContent || '').includes(${JSON.stringify(TOOLS_DISCLOSURE)}));
      return btn ? btn.getAttribute('aria-expanded') : 'missing';
    })()`,
  );
  expect(disclosureExpanded).toBe("false");

  const trigger = page.locator('[data-testid="ai-default-model"] [aria-label="AI model"]');
  await page.evaluate(
    `(() => {
      const button = document.querySelector('[data-testid="ai-default-model"] [aria-label="AI model"]');
      if (!(button instanceof HTMLButtonElement)) throw new Error('default model trigger unavailable');
      button.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
      }));
      button.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0,
      }));
      button.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0,
      }));
      button.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0,
      }));
      button.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, button: 0,
      }));
      return true;
    })()`,
  );
  await waitLong(page, `!!document.querySelector('[cmdk-input]')`, 8_000);
  await page.locator("[cmdk-input]").fill("Sonar");
  await waitLong(
    page,
    `[...document.querySelectorAll('[cmdk-item]')].some((item) => item.textContent?.trim().endsWith('Sonar'))`,
    8_000,
  );
  await page.evaluate(
    `(() => {
      const item = [...document.querySelectorAll('[cmdk-item]')]
        .find((element) => element.textContent?.trim().endsWith('Sonar'));
      if (!(item instanceof HTMLElement)) throw new Error('Sonar option unavailable');
      item.click();
      return true;
    })()`,
  );
  await expect(trigger).toContainText("Sonar", { timeout: 8_000 });

  await page.click('[aria-label="Close settings"]');
});

test("personas: deep link from persona menu, create, switch in chat", async ({ tauriPage }) => {
  const page = tauriPage;
  await createBlankProject(page, "ai-revamp-e2e");
  await openRailTab(page, "Research Assistant");
  await waitLong(
    page,
    `!!document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')`,
    15_000,
  );

  // The menu's create shortcut only renders while no persona exists; a
  // profile that already carries personas from earlier specs goes to the
  // Personas settings tab directly instead. Either path lands on the same
  // create button, and a unique name keeps reruns independent.
  const personaName = `Copyeditor-${Date.now()}`;
  await openPersonaMenu(page);
  const createShortcut = await page.evaluate<boolean>(
    `!!document.querySelector('[data-testid="ai-persona-create"]')`,
  );
  if (createShortcut) {
    await page.click('[data-testid="ai-persona-create"]');
  } else {
    await page.press("body", "Escape");
    await openSettings(page, "ai");
    await openAiTab(page, "personas");
  }
  await expect(page.locator('[data-testid="ai-create-persona"]')).toBeVisible({ timeout: 10_000 });

  await page.click('[data-testid="ai-create-persona"]');
  await expect(page.locator('[data-testid="persona-name"]')).toBeVisible({ timeout: 8_000 });
  await page.fill('[data-testid="persona-name"]', personaName);
  await fillTextarea(page, '[data-testid="persona-prompt"]', "Fix grammar only.");
  await page.click('[data-testid="persona-submit"]');
  await expect(page.locator(`[data-testid="ai-persona-row-${personaName}"]`)).toBeVisible({
    timeout: 8_000,
  });
  await page.click('[aria-label="Close settings"]');

  await openPersonaMenu(page);
  await expect(page.locator(`[data-testid="ai-persona-${personaName}"]`)).toBeVisible();
  await page.click(`[data-testid="ai-persona-${personaName}"]`);

  await openPersonaMenu(page);
  await expect(
    page.locator(`[data-testid="ai-persona-${personaName}"] svg`),
  ).toBeVisible();
  await page.click('[data-testid="ai-persona-none"]');
});
