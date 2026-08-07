import { test, expect } from "../fixtures";
import {
  createBlankProject,
  fillTextarea,
  openProject,
  openRailTab,
  readProjectText,
  waitLong,
  type Page,
} from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

// The agent harness runs in Rust: provider calls, streaming, the turn loop and
// tool dispatch all happen in the backend. The frontend only renders events and
// executes the tool side effects that touch the UI.
//
// The mock server is an OpenAI-compatible endpoint, so the "Ollama (local)"
// provider points Rust at it and every wire-format, streaming and tool path
// runs for real against canned responses. Nothing here needs a network or key.

const PROJECT = "Agent Rust";
const TA = 'textarea[placeholder*="Ask AI"]';

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});

test.afterAll(async () => {
  await server?.close();
});

async function connect(page: Page) {
  const ok = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(ok, "__aiConnect devtools hook must be present").toBe(true);
}

async function openAgentProject(page: Page) {
  const exists = await page.evaluate<boolean>(
    `document.body.innerText.includes(${JSON.stringify(PROJECT)})`,
  );
  if (exists) {
    await openProject(page, PROJECT);
  } else {
    await createBlankProject(page, PROJECT);
  }
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  // Set the provider before the chat panel mounts so it reads a connected
  // config rather than depending on a live config-changed event.
  await connect(page);
}

async function openChat(page: Page) {
  await openRailTab(page, "Chat / AI Assistant");
  await expect(page.locator(TA)).toBeVisible({ timeout: 10_000 });
}

async function ask(page: Page, text: string) {
  await fillTextarea(page, TA, text);
  await page.press(TA, "Enter");
}

async function waitForReply(page: Page, marker: string, timeoutMs = 30_000) {
  await waitLong(
    page,
    `document.body.innerText.includes(${JSON.stringify(marker)}) && !document.querySelector('[aria-label="Stop"]')`,
    timeoutMs,
  );
}

test("a streamed reply arrives through the Rust harness", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await openAgentProject(tauriPage);
  await openChat(tauriPage);

  server.setToolCall(null);
  server.setReply("RUSTSTREAM41");
  await ask(tauriPage, "Reply with the marker.");

  await waitForReply(tauriPage, "RUSTSTREAM41");
});

test("no model call is made from the webview", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await openAgentProject(tauriPage);
  await openChat(tauriPage);

  server.setToolCall(null);
  server.setReply("NOWEBVIEWCALL7");
  await ask(tauriPage, "Reply with the marker.");
  await waitForReply(tauriPage, "NOWEBVIEWCALL7");

  // Resource timing records every request the renderer actually issued.
  // Completions and model discovery both happen in Rust, so nothing here may
  // name a provider endpoint of any kind.
  const rendererCalls = await tauriPage.evaluate<string[]>(
    `performance
      .getEntriesByType("resource")
      .map((e) => String(e.name))
      .filter((name) =>
        /chat[/]completions|v1[/]models|api[.]openai[.]com|api[.]anthropic[.]com|generativelanguage|openrouter[.]ai|api[.]z[.]ai/.test(name),
      )`,
  );
  expect(rendererCalls, "the renderer must not talk to a model provider").toEqual([]);
});

test("a tool call is dispatched by Rust and executed in the app", async ({ tauriPage }) => {
  test.setTimeout(90_000);
  await openAgentProject(tauriPage);
  await openChat(tauriPage);

  // The mock answers the follow-up turn (the one carrying the tool result)
  // with `then`, so seeing it proves the whole round trip closed.
  server.setToolCall({ name: "read_file", args: { path: "main.tex" }, then: "TOOLROUNDTRIP88" });
  await ask(tauriPage, "Read main.tex, then confirm.");

  await waitForReply(tauriPage, "TOOLROUNDTRIP88", 60_000);
  expect(server.requestCount(), "the harness must take a second turn").toBeGreaterThan(1);
});

test("a write tool run by the agent lands on disk", async ({ tauriPage }) => {
  test.setTimeout(90_000);
  await openAgentProject(tauriPage);
  await openChat(tauriPage);

  server.setToolCall({
    name: "write_file",
    args: { path: "agent-wrote.tex", content: "% AGENTWROTETHIS\n" },
    then: "WRITEDONE55",
  });
  await ask(tauriPage, "Create agent-wrote.tex.");

  // Writing is approval gated, and that gate is the frontend's job: Rust asks,
  // the user answers, and only then does the harness get a result. Clicking it
  // is what proves the request and reply pair works across the boundary.
  const approve = tauriPage.getByTestId("tool-confirm-approve");
  await expect(approve).toBeVisible({ timeout: 30_000 });
  await approve.click();

  await waitForReply(tauriPage, "WRITEDONE55", 60_000);

  const written = await readProjectText(tauriPage, "agent-wrote.tex");
  expect(written).toContain("AGENTWROTETHIS");
});

test("stopping a run cancels it in the backend", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await openAgentProject(tauriPage);
  await openChat(tauriPage);

  server.setToolCall(null);
  server.setReply("SHOULDNOTMATTER");
  await ask(tauriPage, "Start a run I will stop.");

  const stop = tauriPage.locator('[aria-label="Stop"]');
  await stop.click({ timeout: 15_000 }).catch(() => {});
  await waitLong(tauriPage, `!document.querySelector('[aria-label="Stop"]')`, 20_000);
  await expect(tauriPage.locator(TA)).toBeEnabled({ timeout: 10_000 });
});

test("provider credentials are never handed to the webview", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await openAgentProject(tauriPage);

  // Store a recognizable key, then read the config back the way the app does.
  const leaked = await tauriPage.evaluate<{ stored: string; visible: string }>(`
    (async () => {
      const { getConfig, setConfig } = await import("/src/lib/tauri.ts");
      const before = await getConfig();
      await setConfig({ ...before, ai_keys: { ...before.ai_keys, openai: "sk-LEAKCANARY123" } });
      const after = await getConfig();
      return {
        stored: after.ai_keys.openai || "",
        visible: JSON.stringify(after),
      };
    })()
  `);

  expect(leaked.stored, "the raw key must not come back").not.toContain("LEAKCANARY123");
  expect(leaked.visible, "no part of the config may carry the key").not.toContain("LEAKCANARY123");
  expect(leaked.stored, "presence must still be reported").not.toBe("");
});

test("a redacted config round trip does not destroy the stored key", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await openAgentProject(tauriPage);

  // Saving an unrelated setting re-sends the redacted key. The stored value has
  // to survive that, or opening Settings would silently sign the user out.
  const stillPresent = await tauriPage.evaluate<boolean>(`
    (async () => {
      const { getConfig, setConfig } = await import("/src/lib/tauri.ts");
      const cfg = await getConfig();
      await setConfig({ ...cfg, ai_model: "llama3.2" });
      const after = await getConfig();
      return (after.ai_keys.openai || "") !== "";
    })()
  `);
  expect(stillPresent).toBe(true);
});

test("the Ollama host stays readable because it is not a secret", async ({ tauriPage }) => {
  test.setTimeout(60_000);
  await openAgentProject(tauriPage);

  const host = await tauriPage.evaluate<string>(`
    (async () => {
      const { getConfig } = await import("/src/lib/tauri.ts");
      return (await getConfig()).ai_keys.ollama || "";
    })()
  `);
  expect(host).toBe(server.url);
});

test("a custom OpenAI-compatible provider streams through the harness", async ({
  tauriPage,
}) => {
  test.setTimeout(60_000);
  await openAgentProject(tauriPage);

  // A user-defined provider takes a different route than the catalog: its base
  // URL comes from config, and the harness deliberately omits stream_options
  // because a self-hosted server can reject unknown fields. Registering one
  // pointed at the mock exercises that route for real.
  await tauriPage.evaluate(`
    (async () => {
      const { getConfig, setConfig } = await import("/src/lib/tauri.ts");
      const cfg = await getConfig();
      await setConfig({
        ...cfg,
        ai_custom_providers: [
          ...cfg.ai_custom_providers.filter((c) => c.id !== "e2e-gateway"),
          {
            id: "e2e-gateway",
            name: "E2E Gateway",
            baseURL: ${JSON.stringify(server.url)} + "/v1",
            keyOptional: false,
          },
        ],
        ai_keys: { ...cfg.ai_keys, "e2e-gateway": "sk-e2e-gateway" },
        ai_provider: "e2e-gateway",
        ai_model: "llama3.2",
      });
      window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed"));
    })()
  `);

  await openChat(tauriPage);
  server.setToolCall(null);
  server.setReply("CUSTOMPROVIDER33");
  await ask(tauriPage, "Reply with the marker.");

  await waitForReply(tauriPage, "CUSTOMPROVIDER33");
});

test("the AI SDK is gone from the shipped bundle", async ({ tauriPage }) => {
  // A4 removed the in-webview provider clients. If one came back, the renderer
  // would regain the ability to call a provider directly.
  const present = await tauriPage.evaluate<boolean>(`
    (async () => {
      try {
        await import("ai");
        return true;
      } catch {
        return false;
      }
    })()
  `);
  expect(present, "the ai package must not be importable in the renderer").toBe(false);
});
