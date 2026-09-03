import { test, expect } from "../fixtures";
import {
  fillTextarea,
  openOleaflyMcpSettings,
  openProject,
  openRailTab,
  openSettings,
  waitLong,
  type Page,
} from "../helpers";
import { startMockAiServer, type MockAiServer } from "../mock-ai-server";

// Agentic AI surface that does NOT require a live model call.

test("AI settings shows the agent tool catalog and PDF capture toggle", async ({ tauriPage }) => {
  // Assert plain-text anchors, NOT the per-tool <code> chips: the
  // tauri-playwright bridge resolves those flakily.
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "ai");
  const instructionsTab = tauriPage.locator('[data-testid="ai-settings-tab-instructions"]');
  await instructionsTab.focus();
  await instructionsTab.press("Enter");

  await expect(
    tauriPage.getByText("The assistant currently supports these tools"),
  ).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.getByText("Allow PDF page capture for AI")).toBeVisible();

  await tauriPage.click('[aria-label="Close settings"]');
});

let planServer: MockAiServer | undefined;

test.afterAll(async () => {
  await planServer?.close();
});

async function connectMockAndOpenChat(page: Page, server: MockAiServer) {
  await openProject(page, "E2E Doc");
  await expect(page.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  const connected = await page.evaluate<boolean>(
    `window.__aiConnect?.("ollama", ${JSON.stringify(server.url)}, "llama3.2") ?? false`,
  );
  expect(connected, "__aiConnect devtools hook must be present").toBe(true);
  await openRailTab(page, "Research Assistant");
  await expect(page.locator('textarea[placeholder*="Ask AI"]')).toBeVisible({ timeout: 10_000 });
}

async function ensurePlanPanelOpen(page: Page) {
  const open = await page.evaluate<boolean>(
    `!!document.querySelector('[data-testid="agent-todos"]')`,
  );
  if (!open) await page.click('[data-testid="agent-status-pill"]');
  await expect(page.getByTestId("agent-todos")).toBeVisible();
}

test("agent status pill renders the checklist from the todos store", async ({ tauriPage }) => {
  planServer = await startMockAiServer();
  await connectMockAndOpenChat(tauriPage, planServer);

  await tauriPage.evaluate(`window.__agentTodosSet?.([
    { id: "1", content: "E2E plan step A", status: "completed" },
    { id: "2", content: "E2E plan step B", status: "in_progress" },
    { id: "3", content: "E2E plan step C", status: "pending" },
  ])`);

  const pill = tauriPage.getByTestId("agent-status-pill");
  await expect(pill).toBeVisible({ timeout: 5_000 });
  await expect(pill).toContainText("STEP 2/3");
  await expect(tauriPage.getByText("E2E plan step A")).toHaveCount(0);

  await tauriPage.click('[data-testid="agent-status-pill"]');
  await expect(tauriPage.getByTestId("agent-todos")).toBeVisible();
  await expect(tauriPage.getByText("E2E plan step A")).toBeVisible();
  await expect(tauriPage.getByText("E2E plan step B")).toBeVisible();
  await expect(tauriPage.getByText("E2E plan step C")).toBeVisible();

  await tauriPage.evaluate(`window.__agentTodosClear?.()`);
  await tauriPage.waitForFunction(
    `!document.querySelector('[data-testid="agent-status-pill"]')`,
    5_000,
  );
});

test("agent sticky memory persists to storage and reloads on reopen", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Research Assistant");

  await tauriPage.evaluate(`window.__agentMemoryClear?.()`);

  const marker = `E2E always use British English ${Date.now().toString(36)}`;
  // The hook stands in for the model calling `remember_note`. This test verifies
  // add() PERSISTS to the per-project storage key, not just the in-memory store,
  // so we read storage directly rather than via __agentMemoryList. Poll because
  // ChatPanel's projectId binding can land a beat after mount (add no-ops until it does).
  await expect
    .poll(
      async () =>
        tauriPage.evaluate<boolean>(
          `(() => {
             window.__agentMemoryAdd?.(${JSON.stringify(marker)});
             return Object.keys(localStorage)
               .filter((k) => k.startsWith("oleafly.agent-memory."))
               .some((k) => (localStorage.getItem(k) || "").includes(${JSON.stringify(marker)}));
           })()`,
        ),
      { timeout: 8_000 },
    )
    .toBe(true);

  // Prove the store hydrates FROM storage on reopen, not from its module-level
  // cache: overwrite storage out-of-band, run the exact load() ChatPanel runs
  // on reopen, and confirm the stale in-memory note was dropped.
  const reloaded = await tauriPage.evaluate<string[]>(`(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("oleafly.agent-memory."));
    if (!k) return [];
    const pid = k.slice("oleafly.agent-memory.".length);
    localStorage.setItem(
      k,
      JSON.stringify([{ id: "m-e2e-disk", content: "reloaded from storage E2E", createdAt: 1 }]),
    );
    window.__agentMemoryLoad?.(pid);
    return window.__agentMemoryList?.() ?? [];
  })()`);
  expect(reloaded).toContain("reloaded from storage E2E");
  expect(reloaded, "reopen must re-read storage, not keep stale in-memory notes").not.toContain(
    marker,
  );

  await tauriPage.evaluate(`window.__agentMemoryClear?.()`);
});

test("agent handoff hook is available and stores a prompt", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Research Assistant");

  const marker = `E2E handoff prompt ${Date.now().toString(36)}`;
  const hasHook = await tauriPage.evaluate<boolean>(
    `typeof window.__agentHandoff === 'function'`,
  );
  expect(hasHook).toBe(true);

  await tauriPage.evaluate(
    `window.__agentHandoff?.(${JSON.stringify(marker)}, false)`,
  );

  const hasInput = await tauriPage.evaluate<boolean>(
    `!!document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')`,
  );
  if (hasInput) {
    // waitForFunction with an IIFE hangs the tauri bridge deep in a long
    // session (30s timeout); poll a plain evaluate instead.
    await expect
      .poll(
        async () =>
          tauriPage.evaluate<string>(
            `document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')?.value ?? ""`,
          ),
        { timeout: 8_000 },
      )
      .toContain(marker);
  }
});

// Chat-usage accumulation math is unit-tested in src/store/chats.test.ts; a
// former e2e test here re-asserted the same arithmetic via devtools hooks with
// no real conversation, so it was redundant. Real footer coverage is in
// 28-ai-chat.spec.ts.

test("MCP activity rail tab appears only when the server is running", async ({
  tauriPage,
}) => {
  test.setTimeout(60_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openOleaflyMcpSettings(tauriPage);
  const mcpToggle = tauriPage.locator('[data-testid="mcp-enable-toggle"]');
  if ((await mcpToggle.getAttribute("aria-checked")) === "true") {
    await mcpToggle.click();
    await expect(tauriPage.locator('[data-testid="mcp-status"]')).toContainText("Off", {
      timeout: 15_000,
    });
  }
  await tauriPage.click('[aria-label="Close settings"]');
  await expect(tauriPage.locator('[aria-label="MCP activity"]')).toHaveCount(0);

  await openOleaflyMcpSettings(tauriPage);
  await tauriPage.click('[data-testid="mcp-enable-toggle"]');
  await expect(tauriPage.locator('[data-testid="mcp-status"]')).toContainText("Running", {
    timeout: 15_000,
  });
  await tauriPage.click('[aria-label="Close settings"]');

  // The view switchers render in the sidebar bar; open it so the MCP switcher
  // that appears once MCP is running is actually mounted.
  await openRailTab(tauriPage, "Source Tree");
  await expect(tauriPage.locator('[aria-label="MCP activity"]')).toBeVisible({
    timeout: 10_000,
  });
  await openRailTab(tauriPage, "MCP activity");
  await expect(tauriPage.getByTestId("mcp-activity-panel")).toBeVisible();
  await expect(tauriPage.getByText("Waiting for external agents")).toBeVisible();

  // Disable again so later specs see a clean rail.
  await openOleaflyMcpSettings(tauriPage);
  await tauriPage.click('[data-testid="mcp-enable-toggle"]');
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.waitForFunction(
    `!document.querySelector('[aria-label="MCP activity"]')`,
    10_000,
  );
});

test("plan mode proposes a plan, waits for approval, then works through it", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  planServer ??= await startMockAiServer();
  await connectMockAndOpenChat(tauriPage, planServer);

  const planButton = tauriPage.locator('button[aria-label="Plan mode"]');
  await expect(planButton).toHaveAttribute("data-state", "off");
  await expect(tauriPage.getByTestId("ai-plan-mode-info")).toHaveCount(0);
  await planButton.click();
  await expect(planButton).toHaveAttribute("data-state", "on");
  await expect(tauriPage.getByTestId("ai-plan-mode-info")).toBeVisible();

  const steps = [
    { id: "title", content: "E2E plan: retitle main.tex", status: "pending" },
    { id: "abstract", content: "E2E plan: shorten the abstract", status: "pending" },
  ];
  planServer.setReply("PLANFALLBACK");
  planServer.setToolCall({ name: "update_todos", args: { todos: steps }, then: "PLANREADY51" });
  const composer = 'textarea[placeholder*="Ask AI"]';
  await fillTextarea(tauriPage, composer, "Retitle the document and shorten the abstract.");
  await tauriPage.press(composer, "Enter");

  await waitLong(
    tauriPage,
    `document.body.innerText.includes('PLANREADY51') && !document.querySelector('[aria-label="Stop"]')`,
    45_000,
  );
  const pill = tauriPage.getByTestId("agent-status-pill");
  await expect(pill).toHaveAttribute("data-plan-status", "awaiting", { timeout: 10_000 });
  await expect(pill).toContainText("PLAN");
  await expect(pill).toContainText("STEP 0/2");
  await expect(
    tauriPage.locator('textarea[placeholder="Describe what to change in the plan"]'),
  ).toBeVisible();

  const checklist = tauriPage.getByTestId("agent-todos");
  await expect(checklist).toBeVisible({ timeout: 5_000 });
  await ensurePlanPanelOpen(tauriPage);
  await expect(checklist).toHaveAttribute("data-plan-status", "awaiting");
  await expect(tauriPage.getByText("Awaiting approval")).toBeVisible();
  await expect(tauriPage.locator('[data-todo-status="pending"]')).toHaveCount(2);
  await expect(tauriPage.locator('button[aria-label="Approve plan"]')).toBeVisible();
  await expect(tauriPage.locator('button[aria-label="Revise"]')).toBeVisible();

  planServer.setToolCall({
    name: "update_todos",
    args: { todos: steps.map((step) => ({ ...step, status: "completed" })) },
    then: "PLANDONE52",
  });
  await tauriPage.click('button[aria-label="Approve plan"]');

  await waitLong(
    tauriPage,
    `document.body.innerText.includes('PLANDONE52') && !document.querySelector('[aria-label="Stop"]')`,
    45_000,
  );
  const summary = tauriPage.getByTestId("agent-run-summary");
  await expect(summary).toBeVisible({ timeout: 10_000 });
  await expect(summary).toContainText("Plan · 2/2 done");
  await expect(tauriPage.getByTestId("agent-status-pill")).toHaveCount(0);
  await expect(tauriPage.locator('button[aria-label="Approve plan"]')).toHaveCount(0);
  await expect(planButton).toHaveAttribute("data-state", "on");
  await expect(tauriPage.locator(composer)).toBeVisible();

  planServer.setToolCall(null);
  await planButton.click();
  await expect(planButton).toHaveAttribute("data-state", "off");
});
