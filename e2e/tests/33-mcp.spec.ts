import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures";
import { createBlankProject, mcpPost, mcpToolJson, openOleaflyMcpSettings } from "../helpers";

test.describe.configure({ mode: "serial" });

test("mcp server serves the in-app tool surface end to end", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await createBlankProject(tauriPage, `MCP E2E ${Date.now()}`);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openOleaflyMcpSettings(tauriPage);
  await expect(tauriPage.getByTestId("oleafly-mcp-server")).toBeVisible();
  const enableToggle = tauriPage.locator('[data-testid="mcp-enable-toggle"]');
  await expect(enableToggle).toHaveAttribute("aria-checked", /^(?:true|false)$/);
  if ((await enableToggle.getAttribute("aria-checked")) !== "true") {
    await enableToggle.click();
  }
  await expect(enableToggle).toHaveAttribute("aria-checked", "true");
  await expect(tauriPage.locator('[data-testid="mcp-status"]')).toContainText("Running", {
    timeout: 15_000,
  });
  await expect(
    tauriPage.locator(
      '[aria-label="Restart MCP server and select an available port"]',
    ),
  ).toBeEnabled({ timeout: 15_000 });
  await tauriPage.click('[aria-label="Close settings"]');

  const dataDir = process.env.OLEAFLY_DATA_DIR;
  // Ignored on purpose outside the harness, because the discovery file lives in the throwaway data dir.
  test.skip(!dataDir, "requires the e2e data-dir override");
  const { url, token } = JSON.parse(readFileSync(join(dataDir!, "mcp.json"), "utf8")) as {
    url: string;
    token: string;
  };
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  expect(token).toHaveLength(64);

  await openOleaflyMcpSettings(tauriPage);
  const discoveryPath = join(dataDir!, "mcp.json");
  const restartButton = tauriPage.locator(
    '[aria-label="Restart MCP server and select an available port"]',
  );
  await expect(restartButton).toBeEnabled({ timeout: 15_000 });
  await restartButton.click();
  await expect(tauriPage.locator('[data-testid="mcp-status"]')).toContainText(
    "Restarted at http://127.0.0.1:",
    { timeout: 15_000 },
  );
  const restarted = JSON.parse(readFileSync(discoveryPath, "utf8")) as {
    url: string;
    token: string;
  };
  expect(restarted.token).toBe(token);
  expect(restarted.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  await tauriPage.click('[aria-label="Close settings"]');

  const init = await mcpPost(restarted, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0" },
    },
  });
  expect((init.json as { result?: { serverInfo?: { name?: string } } })?.result?.serverInfo?.name).toBe(
    "oleafly",
  );
  await mcpPost(restarted, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  const unauthorized = await fetch(restarted.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }),
  });
  expect(unauthorized.status).toBe(401);

  let names: string[] = [];
  for (let i = 0; i < 20; i++) {
    const list = await mcpPost(restarted, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const tools = (list.json as { result?: { tools?: { name: string }[] } })?.result?.tools ?? [];
    names = tools.map((t) => t.name);
    if (names.includes("read_file") && names.includes("get_status")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const n of ["read_file", "write_file", "compile", "project_map", "get_status"]) {
    expect(names).toContain(n);
  }

  const read = await mcpPost(restarted, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "read_file", arguments: { path: "main.tex" } },
  });
  const readPayload = mcpToolJson(read.json);
  expect(readPayload.content).toContain("\\documentclass");

  const writePromise = mcpPost(restarted, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "write_file",
      arguments: { path: "mcp-note.tex", content: "% written over MCP\n" },
    },
  });
  await expect(tauriPage.locator('[data-testid="mcp-approval-panel"]')).toBeVisible({
    timeout: 15_000,
  });
  // Bridge test hook, not a UI click: webview click targeting is unreliable
  // for the floating approval card under tauri-playwright.
  const approved = await tauriPage.evaluate<string>(`window.__mcpDecide("approve")`);
  expect(approved).toMatch(/approve:write_file/);
  const write = await writePromise;
  const writePayload = mcpToolJson(write.json);
  expect(writePayload.success, JSON.stringify(writePayload)).toBe(true);
  for (let i = 0; i < 5; i++) {
    const q = await tauriPage.evaluate<string[]>(`window.__mcpQueue?.() ?? []`);
    if (q.length === 0) break;
    await tauriPage.evaluate(`window.__mcpDecide("approve")`);
  }
  await expect
    .poll(async () => tauriPage.evaluate<string[]>(`window.__mcpQueue?.() ?? []`), {
      timeout: 5_000,
    })
    .toEqual([]);

  const delPromise = mcpPost(restarted, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "delete_file", arguments: { path: "mcp-note.tex" } },
  });
  await expect(tauriPage.locator('[data-testid="mcp-approval-panel"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => tauriPage.evaluate<string[]>(`window.__mcpQueue?.() ?? []`), {
      timeout: 5_000,
    })
    .toEqual(expect.arrayContaining([expect.stringContaining("delete_file")]));
  const rejected = await tauriPage.evaluate<string>(`window.__mcpDecide("reject")`);
  expect(rejected).toContain("delete_file");
  const del = await delPromise;
  const delPayload = mcpToolJson(del.json);
  expect(delPayload.success, JSON.stringify(delPayload)).not.toBe(true);
  expect(delPayload.declined, JSON.stringify(delPayload)).toBe(true);

  const reread = await mcpPost(restarted, {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "read_file", arguments: { path: "mcp-note.tex" } },
  });
  const rereadPayload = mcpToolJson(reread.json);
  expect(rereadPayload.content, JSON.stringify(rereadPayload)).toContain("written over MCP");

  await openOleaflyMcpSettings(tauriPage);
  await tauriPage.click('[data-testid="mcp-enable-toggle"]');
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.waitForFunction(
    `!document.querySelector('[aria-label="MCP activity"]')`,
    10_000,
  );
});
