import { test, expect } from "../fixtures";
import { closeAssistant, fillTextarea, openProject, selectWord, waitLong, type Page } from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

let server: MockAiServer;

test.beforeAll(async () => {
  server = await startMockAiServer();
});
test.afterAll(async () => {
  await server?.close();
});

const KEEP = "Keep every LaTeX command exactly as it is.";
const CHIPS = 'fieldset[aria-label="Saved instructions"] button';
const QUOTES = "Don't change anything inside quotation marks.";

async function connectWithSavedInstructions(page: Page) {
  await openProject(page, "E2E Doc");
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const ok = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(ok, "__aiConnect devtools hook must be present").toBe(true);
  await page.evaluate(
    `import("/src/lib/tauri.ts").then(async ({ getConfig, setConfig }) => {
      const cfg = await getConfig();
      const next = {
        ...cfg,
        ai_system_prompt: "Always write in British English.",
        ai_saved_instructions: [
          { id: "e2e-keep", name: "Keep commands", text: ${JSON.stringify(KEEP)} },
          { id: "e2e-quotes", name: "Quoted text", text: ${JSON.stringify(QUOTES)} },
        ],
        ai_saved_instruction_uses: {},
      };
      await setConfig(next);
      window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed", { detail: next }));
      return true;
    })`,
  );
  await page.evaluate(
    `import("/src/store/inlineEdit.ts").then(({ useInlineEditStore }) => {
      useInlineEditStore.getState().reset();
      useInlineEditStore.setState({ picked: [] });
    })`,
  );
  await closeAssistant(page);
}

async function savedConfig(page: Page) {
  return page.evaluate<{ names: string[]; uses: Record<string, number> }>(
    `import("/src/lib/tauri.ts").then(async ({ getConfig }) => {
      const cfg = await getConfig();
      return {
        names: (cfg.ai_saved_instructions ?? []).map((entry) => entry.name),
        uses: cfg.ai_saved_instruction_uses ?? {},
      };
    })`,
  );
}

test("a saved instruction picked under Ask AI goes with the inline edit", async ({ tauriPage }) => {
  test.setTimeout(90_000);
  await connectWithSavedInstructions(tauriPage);
  server.setToolCall(null);
  server.setReply("Rewritten");
  server.resetRequests();

  await selectWord(tauriPage, "Write");
  await tauriPage.getByText("Ask AI", { exact: true }).click();
  const chip = tauriPage.locator(CHIPS).filter({ hasText: "Quoted text" });
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(tauriPage.getByText("Improve Writing", { exact: true })).toBeVisible();

  await tauriPage.getByText("Improve Writing", { exact: true }).click();
  await expect(tauriPage.locator('button[aria-label="Accept"]')).toBeVisible({ timeout: 30_000 });

  const body = server.requestBodies().at(-1) ?? "";
  expect(body).toContain("Improve the clarity, tone, and flow of the following text");
  expect(body).toContain("Also follow these instructions:");
  expect(body).toContain("inside quotation marks");
  expect(body).not.toContain("exactly as it is");
  expect(body).toContain("USER_PREFERENCES");
  expect(body).toContain("Always write in British English.");

  await tauriPage.locator('button[aria-label="Accept"]').click();
  await waitLong(tauriPage, `document.querySelector(".cm-content")?.textContent?.includes("Rewritten") === true`, 10_000);
  await expect.poll(async () => (await savedConfig(tauriPage)).uses, { timeout: 10_000 }).toEqual({ "e2e-quotes": 1 });
  await tauriPage.evaluate(
    `import("/src/components/editor/cm/controller.ts").then(({ getEditorView }) => {
      const view = getEditorView();
      const from = view.state.doc.toString().indexOf("Rewritten");
      if (from >= 0) view.dispatch({ changes: { from, to: from + "Rewritten".length, insert: "Write" } });
      return true;
    })`,
  );
});

test("an instruction typed in the inline AI box can be saved and picked", async ({ tauriPage }) => {
  test.setTimeout(90_000);
  await connectWithSavedInstructions(tauriPage);
  server.setToolCall(null);
  server.setReply("Rewritten again");
  server.resetRequests();

  await tauriPage.evaluate(
    `Promise.all([
      import("/src/components/editor/cm/controller.ts"),
      import("/src/store/inlineEdit.ts"),
    ]).then(([{ getEditorView }, { useInlineEditStore }]) => {
      const view = getEditorView();
      const line = view.state.doc.line(1);
      view.dispatch({ selection: { anchor: line.from, head: line.to } });
      useInlineEditStore.getState().open({ from: line.from, to: line.to, original: line.text });
      return true;
    })`,
  );
  const prompt = tauriPage.locator(".cm-inline-prompt textarea");
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await fillTextarea(tauriPage, ".cm-inline-prompt textarea", "Use a formal tone throughout");

  await tauriPage.locator(CHIPS).filter({ hasText: "Save instruction" }).click();
  const name = tauriPage.locator('input[aria-label="Name this instruction"]');
  await expect(name).toHaveValue("Use a formal tone throughout");
  await name.fill("Formal tone");
  await name.press("Enter");

  const saved = tauriPage.locator(CHIPS).filter({ hasText: "Formal tone" });
  await expect(saved).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await expect(prompt).toHaveValue("");
  await expect.poll(async () => (await savedConfig(tauriPage)).names, { timeout: 10_000 }).toEqual([
    "Keep commands",
    "Quoted text",
    "Formal tone",
  ]);

  await tauriPage.locator('.cm-inline-prompt button[aria-label="Submit"]').click();
  await expect(tauriPage.locator('button[aria-label="Accept"]')).toBeVisible({ timeout: 30_000 });
  const body = server.requestBodies().at(-1) ?? "";
  expect(body).toContain("Instructions:");
  expect(body).toContain("Use a formal tone throughout");

  await tauriPage.locator('button[aria-label="Reject"]').click();
  await tauriPage.evaluate(
    `import("/src/store/inlineEdit.ts").then(({ useInlineEditStore }) => useInlineEditStore.setState({ picked: [] }))`,
  );
});
