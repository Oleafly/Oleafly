import { test, expect } from "../fixtures";
import { openProject, openRailTab, openSettings } from "../helpers";

// Agentic AI surface that does NOT require a live model call.

test("AI settings shows the agent tool catalog and PDF capture toggle", async ({ tauriPage }) => {
  // Assert plain-text anchors, NOT the per-tool <code> chips: the
  // tauri-playwright bridge resolves those flakily.
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openSettings(tauriPage, "ai");

  await expect(
    tauriPage.getByText("The assistant currently supports these tools"),
  ).toBeVisible({ timeout: 10_000 });
  await expect(tauriPage.getByText("Allow PDF page capture for AI")).toBeVisible();

  await tauriPage.click('[aria-label="Close settings"]');
});

test("agent plan checklist renders from the todos store", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Chat / AI Assistant");
  await expect(tauriPage.getByTestId("ai-chat-float")).toBeVisible({ timeout: 10_000 });

  await tauriPage.evaluate(`window.__agentTodosSet?.([
    { id: "1", content: "E2E plan step A", status: "completed" },
    { id: "2", content: "E2E plan step B", status: "in_progress" },
    { id: "3", content: "E2E plan step C", status: "pending" },
  ])`);

  await expect(tauriPage.getByTestId("agent-todos")).toBeVisible({ timeout: 5_000 });
  await expect(tauriPage.getByText("E2E plan step A")).toBeVisible();
  await expect(tauriPage.getByText("E2E plan step B")).toBeVisible();
  await expect(tauriPage.getByText("E2E plan step C")).toBeVisible();
  await expect(tauriPage.getByText("Plan", { exact: true })).toBeVisible();

  await tauriPage.evaluate(`window.__agentTodosClear?.()`);
  await tauriPage.waitForFunction(
    `!document.querySelector('[data-testid="agent-todos"]')`,
    5_000,
  );
});

test("agent sticky memory persists to storage and reloads on reopen", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });
  await openRailTab(tauriPage, "Chat / AI Assistant");

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
               .filter((k) => k.startsWith("openleaf.agent-memory."))
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
    const k = Object.keys(localStorage).find((x) => x.startsWith("openleaf.agent-memory."));
    if (!k) return [];
    const pid = k.slice("openleaf.agent-memory.".length);
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
  await openRailTab(tauriPage, "Chat / AI Assistant");

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

  await openSettings(tauriPage, "mcp");
  const mcpToggle = tauriPage.locator('[data-testid="mcp-enable-toggle"]');
  if ((await mcpToggle.getAttribute("aria-checked")) === "true") {
    await mcpToggle.click();
    await expect(tauriPage.locator('[data-testid="mcp-status"]')).toContainText("Off", {
      timeout: 15_000,
    });
  }
  await tauriPage.click('[aria-label="Close settings"]');
  await expect(tauriPage.locator('[aria-label="MCP activity"]')).toHaveCount(0);

  await openSettings(tauriPage, "mcp");
  await tauriPage.click('[data-testid="mcp-enable-toggle"]');
  await expect(tauriPage.locator('[data-testid="mcp-status"]')).toContainText("Running", {
    timeout: 15_000,
  });
  await tauriPage.click('[aria-label="Close settings"]');

  await expect(tauriPage.locator('[aria-label="MCP activity"]')).toBeVisible({
    timeout: 10_000,
  });
  await openRailTab(tauriPage, "MCP activity");
  await expect(tauriPage.getByTestId("mcp-activity-panel")).toBeVisible();
  await expect(tauriPage.getByText("Waiting for external agents")).toBeVisible();

  // Disable again so later specs see a clean rail.
  await openSettings(tauriPage, "mcp");
  await tauriPage.click('[data-testid="mcp-enable-toggle"]');
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.waitForFunction(
    `!document.querySelector('[aria-label="MCP activity"]')`,
    10_000,
  );
});
