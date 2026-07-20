import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures";
import { createBlankProject, openSettings } from "../helpers";

async function rpc(url: string, token: string, body: object) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = res.status === 202 ? null : await res.text();
  let json: Record<string, unknown> | null = null;
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { _raw: text };
    }
  }
  return { status: res.status, json };
}

function toolPayload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { text?: string }[] } | null)?.content;
  const text = content?.at(-1)?.text;
  if (!text) return { _result: result };
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { _text: text };
  }
}

test.describe.configure({ mode: "serial" });

test("mcp server serves the in-app tool surface end to end", async ({ tauriPage }) => {
  test.setTimeout(120_000);
  await createBlankProject(tauriPage, `MCP E2E ${Date.now()}`);
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  await openSettings(tauriPage, "mcp");
  await expect(tauriPage.locator('[data-testid="settings-section-mcp"]')).toBeVisible();
  await tauriPage.click('[data-testid="mcp-enable-toggle"]');
  await expect(tauriPage.locator('[data-testid="mcp-status"]')).toContainText("Running", {
    timeout: 15_000,
  });
  await tauriPage.click('[aria-label="Close settings"]');

  const dataDir = process.env.OPENLEAF_DATA_DIR;
  test.skip(!dataDir, "requires the e2e data-dir override");
  const { url, token } = JSON.parse(readFileSync(join(dataDir!, "mcp.json"), "utf8")) as {
    url: string;
    token: string;
  };
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  expect(token.length).toBe(64);

  await openSettings(tauriPage, "mcp");
  const discoveryPath = join(dataDir!, "mcp.json");
  const discoveryMtime = statSync(discoveryPath).mtimeMs;
  await tauriPage.click('[aria-label="Restart MCP server and select an available port"]');
  await expect
    .poll(
      () => {
        if (!existsSync(discoveryPath)) return false;
        if (statSync(discoveryPath).mtimeMs <= discoveryMtime) return false;
        const restarted = JSON.parse(readFileSync(discoveryPath, "utf8")) as {
          url: string;
          token: string;
        };
        return restarted.token === token && /^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(restarted.url);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const restarted = JSON.parse(readFileSync(discoveryPath, "utf8")) as {
    url: string;
    token: string;
  };
  await tauriPage.click('[aria-label="Close settings"]');

  const init = await rpc(restarted.url, token, {
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
    "openleaf",
  );
  await rpc(restarted.url, token, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });

  const unauthorized = await fetch(restarted.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }),
  });
  expect(unauthorized.status).toBe(401);

  // Tool list mirrors the in-app agent (bridge registers after mount).
  let names: string[] = [];
  for (let i = 0; i < 20; i++) {
    const list = await rpc(restarted.url, token, {
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

  const read = await rpc(restarted.url, token, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "read_file", arguments: { path: "main.tex" } },
  });
  const readPayload = toolPayload((read.json as { result?: unknown })?.result);
  expect(readPayload.content).toContain("\\documentclass");

  const writePromise = rpc(restarted.url, token, {
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
  const writePayload = toolPayload((write.json as { result?: unknown })?.result);
  expect(writePayload.success, JSON.stringify(writePayload)).toBe(true);
  // Drain leftover approval cards so they don't interfere with the delete flow.
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

  const delPromise = rpc(restarted.url, token, {
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
  const delPayload = toolPayload((del.json as { result?: unknown })?.result);
  expect(delPayload.success, JSON.stringify(delPayload)).not.toBe(true);
  expect(delPayload.declined, JSON.stringify(delPayload)).toBe(true);

  const reread = await rpc(restarted.url, token, {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "read_file", arguments: { path: "mcp-note.tex" } },
  });
  const rereadPayload = toolPayload((reread.json as { result?: unknown })?.result);
  expect(rereadPayload.content, JSON.stringify(rereadPayload)).toContain("written over MCP");

  // MCP-enabled persists in the shared e2e config, so disable it here or it
  // leaks into later specs (e.g. 36, which asserts the tab is off by default).
  await openSettings(tauriPage, "mcp");
  await tauriPage.click('[data-testid="mcp-enable-toggle"]');
  await tauriPage.click('[aria-label="Close settings"]');
  await tauriPage.waitForFunction(
    `!document.querySelector('[aria-label="MCP activity"]')`,
    10_000,
  );
});
