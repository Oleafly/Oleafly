import { test, expect } from "../fixtures";
import {
  createBlankProject,
  editorSource,
  type McpConnection,
  mcpRequest,
  mcpToolText,
  openProject,
  startMcpServer,
  writeProjectText,
  type Page,
} from "../helpers";

const PROJECT = "MCP Headless";

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

async function disconnectRenderer(page: Page): Promise<void> {
  await page.evaluate<void>(`
    (() => {
      const disconnect = window.__mcpDisconnectRenderer;
      if (typeof disconnect !== "function") {
        throw new Error("MCP renderer disconnect hook is unavailable");
      }
      return disconnect();
    })()
  `);
}

async function reconnectRenderer(page: Page): Promise<void> {
  await page.evaluate<void>(`
    import("/src/lib/mcp-bridge.ts").then(({ startMcpBridge }) => startMcpBridge())
  `);
}

async function stopRendererHeartbeat(page: Page): Promise<void> {
  await page.evaluate<void>(`
    (() => {
      const stop = window.__mcpStopHeartbeat;
      if (typeof stop !== "function") {
        throw new Error("MCP heartbeat test hook is unavailable");
      }
      stop();
    })()
  `);
}

test.describe("MCP without the webview", () => {
  let connection: McpConnection;

  test.beforeEach(async ({ tauriPage }) => {
    test.setTimeout(90_000);
    await openMcpProject(tauriPage);
    await writeProjectText(tauriPage, "headless.tex", "% MCPHEADLESSMARKER\n\\section{One}\n");
    connection = await startMcpServer(tauriPage);
    expect(connection.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  test("reads a project file over HTTP with nothing running in the renderer", async ({
    tauriPage,
  }) => {
    const payload = await mcpRequest(connection, "tools/call", {
      name: "read_file",
      arguments: { path: "headless.tex" },
    });

    expect(mcpToolText(payload)).toContain("MCPHEADLESSMARKER");
  });

  test("lists and searches the project natively", async ({ tauriPage }) => {
    const listed = await mcpRequest(connection, "tools/call", {
      name: "list_files",
      arguments: {},
    });
    const files = JSON.parse(mcpToolText(listed)).files as { path: string }[];
    expect(files.map((f) => f.path)).toContain("headless.tex");

    const found = await mcpRequest(connection, "tools/call", {
      name: "search_project",
      arguments: { query: "mcpheadlessmarker" },
    });
    const parsed = JSON.parse(mcpToolText(found)) as {
      results: { path: string; line: number }[];
      total: number;
    };
    expect(parsed.results.some((m) => m.path === "headless.tex" && m.line === 1)).toBe(true);
    expect(parsed.total).toBeGreaterThanOrEqual(1);
  });

  test("rejects every mutation after the renderer disconnects", async ({ tauriPage }) => {
    await disconnectRenderer(tauriPage);
    try {
      for (const [name, arguments_] of [
        ["write_file", { path: "native-write.tex", content: "must not exist\n" }],
        ["replace_in_file", { path: "headless.tex", find: "One", replace: "Two" }],
        ["create_file", { path: "native-created.tex" }],
        ["rename_file", { from: "headless.tex", to: "renamed.tex" }],
        ["delete_file", { path: "headless.tex" }],
      ] as const) {
        const payload = (await mcpRequest(connection, "tools/call", {
          name,
          arguments: arguments_,
        })) as { result?: { isError?: boolean } };
        expect(payload.result?.isError, `${name} must require the renderer`).toBe(true);
        expect(mcpToolText(payload)).toMatch(/active Oleafly window|approval/i);
      }

      const listed = await mcpRequest(connection, "tools/call", {
        name: "list_files",
        arguments: {},
      });
      expect(mcpToolText(listed)).toContain("headless.tex");
      expect(mcpToolText(listed)).not.toContain("native-write.tex");
      expect(mcpToolText(listed)).not.toContain("native-created.tex");
    } finally {
      await reconnectRenderer(tauriPage);
    }
  });

  test("does not delete files without an active approval interface", async ({ tauriPage }) => {
    await disconnectRenderer(tauriPage);
    try {
      const payload = (await mcpRequest(connection, "tools/call", {
        name: "delete_file",
        arguments: { path: "headless.tex" },
      })) as { result?: { isError?: boolean } };
      expect(payload.result?.isError).toBe(true);

      const read = await mcpRequest(connection, "tools/call", {
        name: "read_file",
        arguments: { path: "headless.tex" },
      });
      expect(mcpToolText(read)).toContain("MCPHEADLESSMARKER");
    } finally {
      await reconnectRenderer(tauriPage);
    }
  });

  test("keeps native reads available after a renderer lease expires", async ({ tauriPage }) => {
    test.setTimeout(120_000);
    await stopRendererHeartbeat(tauriPage);
    await new Promise((resolve) => setTimeout(resolve, 46_000));

    const payload = await mcpRequest(connection, "tools/call", {
      name: "read_file",
      arguments: { path: "headless.tex" },
    });
    expect(mcpToolText(payload)).toContain("MCPHEADLESSMARKER");
  });

  test("a renderer-approved write refreshes an already-open editor buffer", async ({ tauriPage }) => {
    await tauriPage.evaluate(`
      import("/src/store/files.ts").then(({ useFilesStore }) =>
        useFilesStore.getState().openFile("headless.tex")
      )
    `);
    await expect.poll(() => editorSource(tauriPage)).toContain("MCPHEADLESSMARKER");

    await mcpRequest(connection, "tools/call", {
      name: "write_file",
      arguments: { path: "headless.tex", content: "% NATIVEBUFFERREFRESH\n\\section{Two}\n" },
    });

    await expect.poll(() => editorSource(tauriPage)).toContain("NATIVEBUFFERREFRESH");
  });

  test("read-only config is enforced even before the webview registry refreshes", async ({
    tauriPage,
  }) => {
    await tauriPage.evaluate(`
      import("/src/lib/tauri.ts").then(async ({ getConfig, setConfig }) => {
        const cfg = await getConfig();
        await setConfig({ ...cfg, mcp_read_only: true });
      })
    `);

    const payload = (await mcpRequest(connection, "tools/call", {
      name: "write_file",
      arguments: { path: "read-only-bypass.tex", content: "must not exist" },
    })) as { result?: { isError?: boolean } };
    expect(payload.result?.isError).toBe(true);
    expect(mcpToolText(payload)).toMatch(/read-only/i);

    const listed = await mcpRequest(connection, "tools/call", {
      name: "list_files",
      arguments: {},
    });
    expect(mcpToolText(listed)).not.toContain("read-only-bypass.tex");
  });

  test("a replace that matches nothing is reported rather than silently ignored", async ({
    tauriPage,
  }) => {
    const payload = (await mcpRequest(connection, "tools/call", {
      name: "replace_in_file",
      arguments: { path: "headless.tex", find: "NOTPRESENTANYWHERE", replace: "x" },
    })) as { result?: { isError?: boolean } };

    expect(payload.result?.isError).toBe(true);
    expect(mcpToolText(payload)).toMatch(/no match|not found/i);
  });

  test("a project id outside the library is refused", async ({ tauriPage }) => {
    const payload = (await mcpRequest(connection, "tools/call", {
      name: "read_file",
      arguments: { project_id: "../../../etc", path: "passwd" },
    })) as { result?: { isError?: boolean } };

    expect(payload.result?.isError, "traversal must not be served").toBe(true);
    expect(mcpToolText(payload)).not.toContain("root:");
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
    const asking = await startMcpServer(tauriPage, "ask");

    const pending = mcpRequest(asking, "tools/call", {
      name: "write_file",
      arguments: { path: "must-not-exist.tex", content: "x" },
    });

    await expect(tauriPage.getByTestId("mcp-approval-panel")).toBeVisible({ timeout: 20_000 });
    await tauriPage.getByTestId("tool-confirm-reject").click();
    await pending;

    const listed = await mcpRequest(asking, "tools/call", { name: "list_files", arguments: {} });
    expect(mcpToolText(listed), "a rejected write must not reach disk").not.toContain(
      "must-not-exist.tex",
    );
  });

  test("auto_writes still stops at a delete", async ({ tauriPage }) => {
    const auto = await startMcpServer(tauriPage, "auto_writes");

    await mcpRequest(auto, "tools/call", {
      name: "write_file",
      arguments: { path: "auto-written.tex", content: "kept\n" },
    });
    const listed = await mcpRequest(auto, "tools/call", { name: "list_files", arguments: {} });
    expect(mcpToolText(listed), "an edit is auto approved").toContain("auto-written.tex");

    const pending = mcpRequest(auto, "tools/call", {
      name: "delete_file",
      arguments: { path: "auto-written.tex" },
    });
    await expect(tauriPage.getByTestId("mcp-approval-panel")).toBeVisible({ timeout: 20_000 });
    await tauriPage.getByTestId("tool-confirm-reject").click();
    await pending;

    const after = await mcpRequest(auto, "tools/call", { name: "list_files", arguments: {} });
    expect(mcpToolText(after), "the file must survive an unapproved delete").toContain(
      "auto-written.tex",
    );
  });

  test("a tool that needs the UI is still routed to the app", async ({ tauriPage }) => {
    const payload = await mcpRequest(connection, "tools/list", {});
    const names = JSON.stringify(payload);
    expect(names).toContain("read_file");
    expect(names).toContain("compile");
  });
});
