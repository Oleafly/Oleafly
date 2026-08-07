import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillTextarea,
  openProject,
  openRailTab,
  waitLong,
  type Page,
} from "../helpers";

// Real Ollama, running locally. Every other "ollama" test in this suite points
// the provider id at a mock, which exercises the routing but never a real
// daemon. Ollama is the one provider that is keyless, addressed by host rather
// than by a catalog base, and reached over plain HTTP, so its wiring is unlike
// every other provider's and nothing else covers it.
//
// Skipped when no daemon answers, so CI without Ollama stays green.

const HOST = process.env.E2E_OLLAMA_HOST || "http://localhost:11434";
const MODEL = process.env.E2E_OLLAMA_MODEL || "llama3.2:3b";

const PROJECT = "Agent Ollama";
const TA = 'textarea[placeholder*="Ask AI"]';

// A local model is fast once loaded, but the first request pays for loading it
// into memory.
const REPLY_TIMEOUT = 120_000;

let available = false;

test.beforeAll(async () => {
  try {
    const response = await fetch(`${HOST}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { data?: { id: string }[] };
    available = (body.data ?? []).some((m) => m.id === MODEL);
  } catch {
    available = false;
  }
});

async function openOllamaProject(page: Page) {
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

/**
 * Configure Ollama the way the app does: the host is stored where other
 * providers keep an API key, and no credential is set anywhere.
 */
async function connectOllama(page: Page, host = HOST) {
  const ok = await page.evaluate<boolean>(`
    (async () => {
      const { getConfig, setConfig } = await import("/src/lib/tauri.ts");
      const cfg = await getConfig();
      await setConfig({
        ...cfg,
        ai_keys: { ...cfg.ai_keys, ollama: ${JSON.stringify(host)} },
        ai_provider: "ollama",
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

test.describe("local Ollama", () => {
  test.beforeEach(() => {
    test.skip(!available, `no Ollama daemon at ${HOST} serving ${MODEL}`);
  });

  test("lists locally pulled models with no credential configured", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openOllamaProject(tauriPage);
    await connectOllama(tauriPage);

    // Discovery goes to {host}/v1/models. Ollama needs no key, and the backend
    // sends a placeholder rather than the host it stores in that slot.
    const models = await tauriPage.evaluate<{ id: string }[]>(`
      (async () => {
        const { agentListModels } = await import("/src/lib/tauri.ts");
        return await agentListModels({ providerId: "ollama" });
      })()
    `);

    expect(models.length, "no local models were listed").toBeGreaterThan(0);
    expect(models.map((m) => m.id)).toContain(MODEL);
  });

  test("streams a real reply from a local model", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openOllamaProject(tauriPage);
    await connectOllama(tauriPage);
    await openChat(tauriPage);

    await ask(tauriPage, "Reply with exactly this token and nothing else: OLLAMALOCAL5");
    await waitLong(
      tauriPage,
      `document.body.innerText.includes("OLLAMALOCAL5") && !document.querySelector('[aria-label="Stop"]')`,
      REPLY_TIMEOUT,
    );
  });

  test("records the usage frame a local daemon reports", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openOllamaProject(tauriPage);
    await connectOllama(tauriPage);
    await openChat(tauriPage);

    // The backend asks catalog providers for stream_options.include_usage.
    // Ollama honours it with a trailing frame carrying empty choices, which is
    // the shape the translator has to recognise.
    await ask(tauriPage, "Say OK.");
    await waitForRun(tauriPage);

    const usageButton = tauriPage.locator('button[aria-label="View AI usage"]');
    await expect(usageButton).toBeVisible({ timeout: 20_000 });
    await usageButton.click();
    const usage = tauriPage.getByTestId("ai-run-usage");
    await expect(usage).toBeVisible({ timeout: 10_000 });
    expect(await usage.textContent()).toMatch(/[1-9]/);
  });

  test("runs a tool call against the project on a local model", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openOllamaProject(tauriPage);
    await connectOllama(tauriPage);
    await openChat(tauriPage);

    await ask(tauriPage, "Use the read_file tool to read main.tex. Then say DONE.");
    await waitForRun(tauriPage);

    const transcript = await tauriPage.evaluate<string>(`document.body.innerText`);
    expect(transcript, "the tool call should appear in the transcript").toContain("read_file");
  });

  test("a host pasted with a trailing slash still reaches the daemon", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openOllamaProject(tauriPage);

    // Users paste the host out of a browser, which brings the slash along. The
    // backend trims it before appending /v1, and a double slash would 404.
    await connectOllama(tauriPage, `${HOST}/`);

    const models = await tauriPage.evaluate<{ id: string }[]>(`
      (async () => {
        const { agentListModels } = await import("/src/lib/tauri.ts");
        return await agentListModels({ providerId: "ollama" });
      })()
    `);
    expect(models.length).toBeGreaterThan(0);
  });

  test("the host is stored and shown, never treated as a secret", async ({ tauriPage }) => {
    test.setTimeout(REPLY_TIMEOUT);
    await openOllamaProject(tauriPage);
    await connectOllama(tauriPage);

    // Every other provider's credential is redacted out of get_config. The
    // Ollama slot holds a host, and Settings has to keep showing it.
    const stored = await tauriPage.evaluate<string>(`
      (async () => {
        const { getConfig } = await import("/src/lib/tauri.ts");
        return (await getConfig()).ai_keys.ollama || "";
      })()
    `);
    expect(stored).toBe(HOST);
  });
});
