import { test, expect } from "../fixtures";
import { openProject, openRailTab, openSettings } from "../helpers";

// Agentic AI surface that does NOT require a live model call: settings
// capabilities, sticky memory hooks, plan checklist UI, handoff into chat,
// and MCP activity rail visibility.

test("AI settings shows the agent tool catalog and PDF capture toggle", async ({ tauriPage }) => {
  // Pure-UI test (no model needed): AISection renders the agent tool catalog
  // (expanded by default) and the PDF-capture toggle. openSettings now navigates
  // reliably (locator waits, not the bridge eval that used to hang and forced the
  // old test.fixme). Assert plain-text anchors, NOT the per-tool <code> chips,
  // which the tauri-playwright bridge resolves flakily; the catalog header is
  // only rendered when the (default-open) tool list is showing.
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

  // Seed todos via the e2e hook (no model required).
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
  // ChatPanel binds the memory store to the open project on mount (load()).
  await openRailTab(tauriPage, "Chat / AI Assistant");

  await tauriPage.evaluate(`window.__agentMemoryClear?.()`);

  const marker = `E2E always use British English ${Date.now().toString(36)}`;
  // The hook stands in for the model calling `remember_note`. What this test
  // actually verifies is that add() PERSISTS (to the per-project storage key),
  // not merely that it mutates the in-memory store — so we read storage directly
  // rather than asserting via __agentMemoryList. Poll because ChatPanel's
  // projectId binding can land a beat after mount (add no-ops until it does).
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

  // Prove the store hydrates FROM storage when the project is (re)opened, not
  // from its module-level cache: overwrite storage out-of-band with a different
  // note, run the exact load() ChatPanel runs on reopen, and confirm the store
  // now reflects storage and dropped the stale in-memory note.
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

  // When a provider is already connected, ChatPanel consumes into the textarea.
  const hasInput = await tauriPage.evaluate<boolean>(
    `!!document.querySelector('textarea[placeholder*="Ask AI"], textarea[placeholder*="Describe a figure"]')`,
  );
  if (hasInput) {
    // Poll a plain evaluate (bridge-robust). waitForFunction with an IIFE hangs
    // the tauri bridge deep in a long session (30s timeout).
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

// The chat-usage accumulation math (input/output/steps/runs) is unit-tested in
// src/store/chats.test.ts. A former e2e test here re-asserted that same store
// arithmetic through devtools hooks (no real conversation, DOM footer skipped
// without a provider), so it was redundant and tautological. The real footer is
// exercised by the provider-backed chat test in 28-ai-chat.spec.ts.

test("MCP activity rail tab appears only when the server is running", async ({
  tauriPage,
}) => {
  test.setTimeout(60_000);
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Off by default: no MCP activity rail button.
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
