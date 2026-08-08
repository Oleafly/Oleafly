import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillTextarea,
  openProject,
  openRailTab,
  waitLong,
  type Page,
} from "../helpers";

const TOKEN = process.env.E2E_AI_TOKEN;
const PROVIDER = process.env.E2E_AI_PROVIDER_ID || "zai";
const MODEL = process.env.E2E_AI_MODEL || "glm-5.2";
const OPENAI_COMPATIBLE = PROVIDER !== "anthropic" && PROVIDER !== "google";
const EXPECT_REASONING = process.env.E2E_AI_EXPECT_REASONING === "1" || PROVIDER === "zai";

const PROJECT = "Agent Live";
const TA = 'textarea[placeholder*="Ask AI"]';

const REPLY_TIMEOUT = 120_000;

async function openLiveProject(page: Page) {
  const exists = await page.evaluate<boolean>(
    `document.body.innerText.includes(${JSON.stringify(PROJECT)})`,
  );
  if (exists) {
    await openProject(page, PROJECT);
  } else {
    await createBlankProject(page, PROJECT);
  }
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
}

async function connectLive(page: Page, providerId: string, baseURL?: string) {
  const ok = await page.evaluate<boolean>(`
    (async () => {
      const { getConfig, setConfig } = await import("/src/lib/tauri.ts");
      const cfg = await getConfig();
      const custom = ${JSON.stringify(baseURL ?? null)}
        ? [
            ...cfg.ai_custom_providers.filter((c) => c.id !== ${JSON.stringify(providerId)}),
            {
              id: ${JSON.stringify(providerId)},
              name: "Live Gateway",
              baseURL: ${JSON.stringify(baseURL ?? "")},
              keyOptional: false,
            },
          ]
        : cfg.ai_custom_providers;
      await setConfig({
        ...cfg,
        ai_custom_providers: custom,
        ai_keys: { ...cfg.ai_keys, [${JSON.stringify(providerId)}]: ${JSON.stringify(TOKEN ?? "")} },
        ai_provider: ${JSON.stringify(providerId)},
        ai_model: ${JSON.stringify(MODEL)},
      });
      window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed"));
      return true;
    })()
  `);
  expect(ok).toBe(true);
}

async function openChat(page: Page) {
  await openRailTab(page, "Chat / AI Assistant");
  await expect(page.locator(TA)).toBeVisible({ timeout: 10_000 });
}

async function ask(page: Page, text: string) {
  await fillTextarea(page, TA, text);
  await page.press(TA, "Enter");
}

async function waitForRun(page: Page, timeoutMs = REPLY_TIMEOUT) {
  await waitLong(page, `!!document.querySelector('[aria-label="Stop"]')`, 30_000);
  await waitLong(page, `!document.querySelector('[aria-label="Stop"]')`, timeoutMs);
}

test.describe("live provider", () => {
  test.skip(!TOKEN, "set E2E_AI_TOKEN in e2e/.env to run against a real provider");

  test("lists the models the key actually has access to", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openLiveProject(tauriPage);
    await connectLive(tauriPage, PROVIDER);

    const models = await tauriPage.evaluate<{ id: string }[]>(`
      (async () => {
        const { agentListModels } = await import("/src/lib/tauri.ts");
        return await agentListModels({ providerId: ${JSON.stringify(PROVIDER)} });
      })()
    `);

    expect(models.length, "the provider returned no models").toBeGreaterThan(0);
    expect(models.every((m) => typeof m.id === "string" && m.id.length > 0)).toBe(true);
  });

  test("streams a real reply and records real token usage", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openLiveProject(tauriPage);
    await connectLive(tauriPage, PROVIDER);
    await openChat(tauriPage);

    await ask(tauriPage, "Reply with exactly this token and nothing else: LIVEPROVIDER7");
    await waitLong(
      tauriPage,
      `document.body.innerText.includes("LIVEPROVIDER7") && !document.querySelector('[aria-label="Stop"]')`,
      REPLY_TIMEOUT,
    );

    const usageButton = tauriPage.locator('button[aria-label="View AI usage"]');
    await expect(usageButton).toBeVisible({ timeout: 20_000 });
    await usageButton.click();
    const usage = tauriPage.getByTestId("ai-run-usage");
    await expect(usage).toBeVisible({ timeout: 10_000 });
    const text = await usage.textContent();
    expect(text ?? "", "token counts should not be zero").toMatch(/[1-9]/);
  });

  test("streams the thinking phase separately from the answer", async ({ tauriPage }) => {
    test.skip(!EXPECT_REASONING, `${PROVIDER} is not configured to expose reasoning tokens`);
    test.setTimeout(REPLY_TIMEOUT);
    await openLiveProject(tauriPage);
    await connectLive(tauriPage, PROVIDER);
    await openChat(tauriPage);

    await ask(tauriPage, "Think step by step, then answer: what is 17 times 23?");
    await waitForRun(tauriPage);

    const sawReasoning = await tauriPage.evaluate<boolean>(
      `/Thought for|Reasoning/i.test(document.body.innerText)`,
    );
    expect(sawReasoning, "no thinking phase was rendered").toBe(true);

    const answered = await tauriPage.evaluate<boolean>(
      `document.body.innerText.includes("391")`,
    );
    expect(answered, "the answer should survive the thinking phase").toBe(true);
  });

  test("runs a real tool call against the project", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openLiveProject(tauriPage);
    await connectLive(tauriPage, PROVIDER);
    await openChat(tauriPage);

    await ask(
      tauriPage,
      "Use the read_file tool to read main.tex, then reply with the documentclass name only.",
    );
    await waitForRun(tauriPage);

    const transcript = await tauriPage.evaluate<string>(`document.body.innerText`);
    expect(transcript, "the tool call should appear in the transcript").toContain("read_file");
    expect(transcript, "the model should report what it read").toMatch(/article/i);
  });

  test("the same key works through a custom provider entry", async ({ tauriPage }) => {
    test.skip(
      !OPENAI_COMPATIBLE,
      "custom provider entries use the OpenAI-compatible wire protocol",
    );
    test.setTimeout(REPLY_TIMEOUT);
    await openLiveProject(tauriPage);

    const baseURL =
      process.env.E2E_AI_BASE_URL || "https://api.z.ai/api/coding/paas/v4";
    await connectLive(tauriPage, "live-gateway", baseURL);
    await openChat(tauriPage);

    await ask(tauriPage, "Reply with exactly this token and nothing else: LIVECUSTOM9");
    await waitLong(
      tauriPage,
      `document.body.innerText.includes("LIVECUSTOM9") && !document.querySelector('[aria-label="Stop"]')`,
      REPLY_TIMEOUT,
    );
  });

  test("saving a key selects a model the provider actually offers", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openLiveProject(tauriPage);

    const outcome = await tauriPage.evaluate<{
      active: string;
      stored: string[];
      listed: string[];
    }>(`
      (async () => {
        const { agentListModels, getConfig, setConfig } = await import("/src/lib/tauri.ts");
        const { mergeFetchedModels, pickActiveModel, seedProviderModels } =
          await import("/src/lib/ai-model-state.ts");
        const { defaultModel } = await import("/src/lib/ai-providers.ts");

        const id = ${JSON.stringify(PROVIDER)};
        const listed = await agentListModels({ providerId: id, key: ${JSON.stringify(TOKEN ?? "")} });
        const merged = mergeFetchedModels(seedProviderModels(id), listed);
        const active = pickActiveModel(merged, defaultModel(id));

        const cfg = await getConfig();
        await setConfig({
          ...cfg,
          ai_keys: { ...cfg.ai_keys, [id]: ${JSON.stringify(TOKEN ?? "")} },
          ai_provider_models: { ...cfg.ai_provider_models, [id]: merged },
          ai_provider: id,
          ai_model: active,
        });

        const saved = await getConfig();
        return {
          active: saved.ai_model,
          stored: (saved.ai_provider_models[id] || []).map((m) => m.id),
          listed: listed.map((m) => m.id),
        };
      })()
    `);

    expect(outcome.listed.length, "the provider listed no models").toBeGreaterThan(0);
    expect(outcome.stored, "the fetched list must persist").toEqual(
      expect.arrayContaining(outcome.listed),
    );
    expect(
      outcome.listed.includes(outcome.active),
      "the selected model must be one the provider offers",
    ).toBe(true);
  });

  test("a refresh drops a model the provider no longer lists", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openLiveProject(tauriPage);

    const stillThere = await tauriPage.evaluate<boolean>(`
      (async () => {
        const { agentListModels } = await import("/src/lib/tauri.ts");
        const { mergeFetchedModels } = await import("/src/lib/ai-model-state.ts");
        const id = ${JSON.stringify(PROVIDER)};
        const listed = await agentListModels({ providerId: id, key: ${JSON.stringify(TOKEN ?? "")} });
        const withGhost = [
          { id: "glm-retired-0", name: "Retired", enabled: true, source: "fetched" },
          ...listed.map((m) => ({ ...m, enabled: true, source: "fetched" })),
        ];
        const merged = mergeFetchedModels(withGhost, listed);
        return merged.some((m) => m.id === "glm-retired-0");
      })()
    `);

    expect(stillThere, "a deprecated model survived the refresh").toBe(false);
  });

  test("a rejected key surfaces the provider's own message", async ({ tauriPage }) => {
    test.skip(
      !OPENAI_COMPATIBLE,
      "the custom-base invalid-key probe uses the OpenAI-compatible wire protocol",
    );
    test.setTimeout(REPLY_TIMEOUT);
    await openLiveProject(tauriPage);

    const failure = await tauriPage.evaluate<string>(`
      (async () => {
        const { agentListModels } = await import("/src/lib/tauri.ts");
        try {
          await agentListModels({
            providerId: "live-bad",
            key: "sk-definitely-not-valid",
            baseURL: ${JSON.stringify(process.env.E2E_AI_BASE_URL || "https://api.z.ai/api/coding/paas/v4")},
          });
          return "UNEXPECTED SUCCESS";
        } catch (error) {
          return String(error);
        }
      })()
    `);

    expect(failure).not.toBe("UNEXPECTED SUCCESS");
    expect(failure, "the provider's status should reach the user").toMatch(/40[13]|invalid|unauthor/i);
  });
});
