import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures";
import { openProject, openSettings } from "../helpers";

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
  return { status: res.status, json: res.status === 202 ? null : await res.json() };
}

test.describe.configure({ mode: "serial" });

test("mcp server serves the in-app tool surface end to end", async ({ tauriPage }) => {
  await openProject(tauriPage, "E2E Doc");
  await expect(tauriPage.locator(".cm-content")).toBeVisible({ timeout: 20_000 });

  // Enable the server through Settings.
  await openSettings(tauriPage, "mcp");
  await expect(tauriPage.locator('[data-testid="settings-section-mcp"]')).toBeVisible();
  await tauriPage.click('[data-testid="mcp-enable-toggle"]');
  await expect(tauriPage.locator('[data-testid="mcp-status"]')).toContainText("Running", {
    timeout: 15_000,
  });
  await tauriPage.click('[aria-label="Close settings"]');

  // Read the discovery file the server just wrote.
  const dataDir = process.env.OPENLEAF_DATA_DIR;
  test.skip(!dataDir, "requires the e2e data-dir override");
  const { url, token } = JSON.parse(readFileSync(join(dataDir!, "mcp.json"), "utf8")) as {
    url: string;
    token: string;
  };
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  expect(token.length).toBe(64);

  // Handshake.
  const init = await rpc(url, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0" },
    },
  });
  expect(init.json.result.serverInfo.name).toBe("openleaf");
  await rpc(url, token, { jsonrpc: "2.0", method: "notifications/initialized" });

  // Auth is enforced.
  const unauthorized = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "ping" }),
  });
  expect(unauthorized.status).toBe(401);

  // Tool list mirrors the in-app agent (bridge registers after mount).
  let names: string[] = [];
  for (let i = 0; i < 20; i++) {
    const list = await rpc(url, token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    names = (list.json.result.tools as { name: string }[]).map((t) => t.name);
    if (names.includes("read_file") && names.includes("get_status")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const n of ["read_file", "write_file", "compile", "project_map", "get_status"]) {
    expect(names).toContain(n);
  }

  // A read tool round-trips through the webview.
  const read = await rpc(url, token, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "read_file", arguments: { path: "main.tex" } },
  });
  const readPayload = JSON.parse(read.json.result.content.at(-1).text);
  expect(readPayload.content).toContain("\\documentclass");

  // A write tool pauses on the approval card; approving applies it.
  const writePromise = rpc(url, token, {
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
  await tauriPage.getByRole("button", { name: "Approve" }).click();
  const write = await writePromise;
  const writePayload = JSON.parse(write.json.result.content.at(-1).text);
  expect(writePayload.success).toBe(true);

  // Rejecting a delete leaves the file alone and reports declined.
  const delPromise = rpc(url, token, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "delete_file", arguments: { path: "mcp-note.tex" } },
  });
  await expect(tauriPage.locator('[data-testid="mcp-approval-panel"]')).toBeVisible({
    timeout: 15_000,
  });
  await tauriPage.getByRole("button", { name: "Reject" }).click();
  const del = await delPromise;
  const delPayload = JSON.parse(del.json.result.content.at(-1).text);
  expect(delPayload.declined).toBe(true);
});
