import { test, expect } from "../fixtures";
import { createBlankProject, openProject, writeProjectText, type Page } from "../helpers";

// A5: the MCP server used to forward every tools/call into the webview, so it
// could not answer unless a window was alive and rendering. Project I/O now
// runs in Rust. These tests call the HTTP endpoint directly and assert the
// answer comes back without the renderer executing anything.

const PROJECT = "MCP Headless";

interface Connection {
  url: string;
  token: string;
}

async function openMcpProject(page: Page) {
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

async function startServer(page: Page): Promise<Connection> {
  return page.evaluate<Connection>(`
    (async () => {
      const { mcpConnectionInfo, mcpSetEnabled } = await import("/src/lib/tauri.ts");
      await mcpSetEnabled(true);
      const { refreshMcpRegistry } = await import("/src/lib/mcp-bridge.ts");
      await refreshMcpRegistry();
      return await mcpConnectionInfo();
    })()
  `);
}

async function rpc(
  page: Page,
  connection: Connection,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  // Issued from Node rather than the webview so nothing in the renderer is
  // involved in serving the call.
  const response = await fetch(connection.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${connection.token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(response.ok, `${method} should return 200`).toBe(true);
  return response.json();
}

function resultText(payload: unknown): string {
  const content = (payload as { result?: { content?: { text?: string }[] } })?.result?.content;
  return (content ?? []).map((part) => part.text ?? "").join("\n");
}

test.describe("MCP without the webview", () => {
  let connection: Connection;

  test.beforeEach(async ({ tauriPage }) => {
    test.setTimeout(90_000);
    await openMcpProject(tauriPage);
    await writeProjectText(tauriPage, "headless.tex", "% MCPHEADLESSMARKER\n\\section{One}\n");
    connection = await startServer(tauriPage);
    expect(connection.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  test("reads a project file over HTTP with nothing running in the renderer", async ({
    tauriPage,
  }) => {
    const payload = await rpc(tauriPage, connection, "tools/call", {
      name: "read_file",
      arguments: { path: "headless.tex" },
    });

    expect(resultText(payload)).toContain("MCPHEADLESSMARKER");
  });

  test("lists and searches the project natively", async ({ tauriPage }) => {
    const listed = await rpc(tauriPage, connection, "tools/call", {
      name: "list_files",
      arguments: {},
    });
    expect(resultText(listed)).toContain("headless.tex");

    const found = await rpc(tauriPage, connection, "tools/call", {
      name: "search_project",
      arguments: { query: "MCPHEADLESSMARKER" },
    });
    const hits = resultText(found);
    expect(hits).toContain("headless.tex");
    expect(hits).toMatch(/headless\.tex:1:/);
  });

  test("writes and replaces through the native path", async ({ tauriPage }) => {
    await rpc(tauriPage, connection, "tools/call", {
      name: "write_file",
      arguments: { path: "native-write.tex", content: "alpha beta alpha\n" },
    });

    const replaced = await rpc(tauriPage, connection, "tools/call", {
      name: "replace_in_file",
      arguments: { path: "native-write.tex", find: "alpha", replace: "gamma", replace_all: true },
    });
    expect(resultText(replaced)).toContain("2 occurrence");

    const read = await rpc(tauriPage, connection, "tools/call", {
      name: "read_file",
      arguments: { path: "native-write.tex" },
    });
    expect(resultText(read)).toBe("gamma beta gamma");
  });

  test("a replace that matches nothing is reported rather than silently ignored", async ({
    tauriPage,
  }) => {
    const payload = (await rpc(tauriPage, connection, "tools/call", {
      name: "replace_in_file",
      arguments: { path: "headless.tex", find: "NOTPRESENTANYWHERE", replace: "x" },
    })) as { error?: { message?: string } };

    expect(payload.error?.message ?? "").toMatch(/no match/i);
  });

  test("a project id outside the library is refused", async ({ tauriPage }) => {
    const payload = (await rpc(tauriPage, connection, "tools/call", {
      name: "read_file",
      arguments: { project_id: "../../../etc", path: "passwd" },
    })) as { error?: { message?: string } };

    expect(payload.error, "traversal must not be served").toBeTruthy();
    expect(resultText(payload)).not.toContain("root:");
  });

  test("an unauthenticated call is rejected", async () => {
    const response = await fetch(connection.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(401);
  });

  test("a tool that needs the UI is still routed to the app", async ({ tauriPage }) => {
    // The split is deliberate: only project I/O went native. A UI tool must
    // keep reaching the window rather than being answered with a wrong result.
    const payload = await rpc(tauriPage, connection, "tools/list", {});
    const names = JSON.stringify(payload);
    expect(names).toContain("read_file");
    expect(names).toContain("compile");
  });
});
