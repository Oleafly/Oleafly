import { test, expect } from "../fixtures";
import { createBlankProject, openProject, writeProjectText, type Page } from "../helpers";

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

async function startServer(page: Page, policy = "trust"): Promise<Connection> {
  return page.evaluate<Connection>(`
    (async () => {
      const { getConfig, mcpConnectionInfo, mcpSetEnabled, setConfig } =
        await import("/src/lib/tauri.ts");
      const cfg = await getConfig();
      await setConfig({
        ...cfg,
        mcp_approval_policy: ${JSON.stringify(policy)},
        mcp_read_only: false,
      });
      await mcpSetEnabled(true);
      const { refreshMcpRegistry, startMcpBridge } = await import("/src/lib/mcp-bridge.ts");
      await startMcpBridge();
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
    const files = JSON.parse(resultText(listed)).files as { path: string }[];
    expect(files.map((f) => f.path)).toContain("headless.tex");

    const found = await rpc(tauriPage, connection, "tools/call", {
      name: "search_project",
      arguments: { query: "MCPHEADLESSMARKER" },
    });
    const matches = JSON.parse(resultText(found)).matches as { path: string; line: number }[];
    expect(matches.some((m) => m.path === "headless.tex" && m.line === 1)).toBe(true);
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
    expect(JSON.parse(resultText(replaced)).replacements).toBe(2);

    const read = await rpc(tauriPage, connection, "tools/call", {
      name: "read_file",
      arguments: { path: "native-write.tex" },
    });
    expect(JSON.parse(resultText(read)).content).toBe("gamma beta gamma");
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

  test("the default policy sends a change to the app to be approved", async ({ tauriPage }) => {
    const asking = await startServer(tauriPage, "ask");

    const pending = rpc(tauriPage, asking, "tools/call", {
      name: "write_file",
      arguments: { path: "must-not-exist.tex", content: "x" },
    });

    await expect(tauriPage.getByTestId("mcp-approval-panel")).toBeVisible({ timeout: 20_000 });
    await tauriPage.getByTestId("tool-confirm-reject").click();
    await pending;

    const listed = await rpc(tauriPage, asking, "tools/call", { name: "list_files", arguments: {} });
    expect(resultText(listed), "a rejected write must not reach disk").not.toContain(
      "must-not-exist.tex",
    );
  });

  test("auto_writes still stops at a delete", async ({ tauriPage }) => {
    const auto = await startServer(tauriPage, "auto_writes");

    await rpc(tauriPage, auto, "tools/call", {
      name: "write_file",
      arguments: { path: "auto-written.tex", content: "kept\n" },
    });
    const listed = await rpc(tauriPage, auto, "tools/call", { name: "list_files", arguments: {} });
    expect(resultText(listed), "an edit is auto approved").toContain("auto-written.tex");

    const pending = rpc(tauriPage, auto, "tools/call", {
      name: "delete_file",
      arguments: { path: "auto-written.tex" },
    });
    await expect(tauriPage.getByTestId("mcp-approval-panel")).toBeVisible({ timeout: 20_000 });
    await tauriPage.getByTestId("tool-confirm-reject").click();
    await pending;

    const after = await rpc(tauriPage, auto, "tools/call", { name: "list_files", arguments: {} });
    expect(resultText(after), "the file must survive an unapproved delete").toContain(
      "auto-written.tex",
    );
  });

  test("a tool that needs the UI is still routed to the app", async ({ tauriPage }) => {
    const payload = await rpc(tauriPage, connection, "tools/list", {});
    const names = JSON.stringify(payload);
    expect(names).toContain("read_file");
    expect(names).toContain("compile");
  });
});
