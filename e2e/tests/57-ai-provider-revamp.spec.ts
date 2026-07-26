import { test, expect } from "../fixtures";
import { createBlankProject, openRailTab, openSettings, waitLong, type Page } from "../helpers";

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

async function openPromptsMenu(page: Page) {
  await page.evaluate(
    `(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.textContent || '').trim().startsWith('Prompts'));
      if (!btn) throw new Error('Prompts trigger not found');
      btn.click();
      return 1;
    })()`,
  );
  await waitLong(
    page,
    `!!document.querySelector('[data-testid="ai-prompts-create-persona"], [data-testid="ai-prompts-persona-none"]')`,
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
  await page.click('[aria-label="Close settings"]');
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
  await trigger.focus();
  await trigger.press("Enter");
  await waitLong(page, `document.querySelectorAll('[role="option"]').length > 0`, 8_000);
  const option = page.locator('[role="option"]', { hasText: "Sonar Pro" });
  await option.focus();
  await option.press("Enter");
  await expect(trigger).toContainText("Sonar Pro", { timeout: 8_000 });

  await page.click('[aria-label="Close settings"]');
});

test("personas: deep link from prompts menu, create, switch in chat", async ({ tauriPage }) => {
  const page = tauriPage;
  await createBlankProject(page, "ai-revamp-e2e");
  await openRailTab(page, "Chat / AI Assistant");
  await waitLong(
    page,
    `!!document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')`,
    15_000,
  );

  await openPromptsMenu(page);
  await expect(page.locator('[data-testid="ai-prompts-create-persona"]')).toBeVisible();
  await page.click('[data-testid="ai-prompts-create-persona"]');
  await expect(page.locator('[data-testid="ai-create-persona"]')).toBeVisible({ timeout: 10_000 });

  await page.click('[data-testid="ai-create-persona"]');
  await expect(page.locator('[data-testid="persona-name"]')).toBeVisible({ timeout: 8_000 });
  await page.fill('[data-testid="persona-name"]', "Copyeditor");
  await page.fill('[data-testid="persona-prompt"]', "Fix grammar only.");
  await page.click('[data-testid="persona-submit"]');
  await expect(page.locator('[data-testid="ai-persona-row-Copyeditor"]')).toBeVisible({
    timeout: 8_000,
  });
  await page.click('[aria-label="Close settings"]');

  await openPromptsMenu(page);
  await expect(page.locator('[data-testid="ai-prompts-persona-Copyeditor"]')).toBeVisible();
  await page.click('[data-testid="ai-prompts-persona-Copyeditor"]');

  await openPromptsMenu(page);
  await expect(
    page.locator('[data-testid="ai-prompts-persona-Copyeditor"] svg'),
  ).toBeVisible();
  await page.click('[data-testid="ai-prompts-persona-none"]');
});
