// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { StrictMode, useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpImportedServer, McpImportSourceTool } from "@/lib/tauri";
import {
  McpServerImportDialog,
  type McpServerImportSelection,
} from "./McpServerImportDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
let requestedSources: McpImportSourceTool[];
type SourceResult = McpImportedServer[] | Error | Promise<McpImportedServer[]>;
let sourceResults: Partial<Record<McpImportSourceTool, SourceResult>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("McpServerImportDialog", () => {
  beforeEach(() => {
    requestedSources = [];
    sourceResults = {};
    mockInvoke.mockReset().mockImplementation(async (command, args) => {
      if (command !== "mcp_import_source") {
        throw new Error(`Unexpected command: ${command}`);
      }
      const { sourceTool } = args as { sourceTool: McpImportSourceTool };
      requestedSources.push(sourceTool);
      const result = sourceResults[sourceTool] ?? [];
      if (result instanceof Error) throw result;
      return await result;
    });
  });

  it("detects supported sources only after the parent opens the dialog", async () => {
    const props = {
      existingNames: [] as const,
      onClose: vi.fn(),
      onImport: async () => undefined,
    };
    const { rerender } = render(<McpServerImportDialog {...props} open={false} />);

    await Promise.resolve();
    expect(requestedSources).toEqual([]);

    rerender(<McpServerImportDialog {...props} open />);

    await waitFor(() => {
      expect(requestedSources).toEqual([
        "claude-desktop",
        "claude-code",
        "codex",
        "cursor",
        "windsurf",
      ]);
    });
  });

  it("explains when installed tools have no MCP servers to import", async () => {
    render(
      <McpServerImportDialog
        open
        existingNames={[]}
        onClose={vi.fn()}
        onImport={async () => undefined}
      />,
    );

    expect(
      await screen.findByText("No MCP server configurations were found."),
    ).toBeInTheDocument();
    expect(screen.queryByText("When names match")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import selected" })).toBeDisabled();
  });

  it("scans each source once when an open dialog mounts in app StrictMode", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open import
          </button>
          {open ? (
            <McpServerImportDialog
              open
              existingNames={[]}
              onClose={() => setOpen(false)}
              onImport={async () => undefined}
            />
          ) : null}
        </>
      );
    }

    const user = userEvent.setup();
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: "Open import" }));

    await waitFor(() => {
      expect(requestedSources).toEqual([
        "claude-desktop",
        "claude-code",
        "codex",
        "cursor",
        "windsurf",
      ]);
    });
  });

  it("shows detected servers without exposing connection secrets", async () => {
    sourceResults = {
      "claude-desktop": [
        {
          name: "Local files",
          enabled: true,
          transport: "stdio",
          command: "npx",
          args: ["-y", "@private/server", "--token=argument-secret"],
          env: {
            API_TOKEN: "environment-secret",
            LOG_LEVEL: "debug",
          },
          sourceTool: "claude-desktop",
        },
      ],
      cursor: [
        {
          name: "Research API",
          enabled: true,
          transport: "remote",
          url: "https://mcp.example.test/private?token=query-secret",
          headers: {
            Authorization: "header-secret",
            "X-Workspace": "workspace-secret",
          },
          sourceTool: "cursor",
        },
      ],
    };

    render(
      <McpServerImportDialog
        open
        existingNames={["Local files"]}
        onClose={vi.fn()}
        onImport={async () => undefined}
      />,
    );

    const localGroup = await screen.findByRole("group", { name: "Claude Desktop" });
    const remoteGroup = screen.getByRole("group", { name: "Cursor" });
    expect(screen.queryByRole("group", { name: "Codex" })).not.toBeInTheDocument();
    expect(within(localGroup).getByRole("checkbox", { name: /Local files/ })).toBeChecked();
    expect(within(remoteGroup).getByRole("checkbox", { name: /Research API/ })).toBeChecked();
    expect(within(localGroup).getByText("Local command: npx. 3 arguments.")).toBeInTheDocument();
    expect(
      within(remoteGroup).getByText("Remote server: https://mcp.example.test."),
    ).toBeInTheDocument();
    expect(within(localGroup).getByText("Environment: API_TOKEN, LOG_LEVEL")).toBeInTheDocument();
    expect(
      within(remoteGroup).getByText("Headers: Authorization, X-Workspace"),
    ).toBeInTheDocument();
    expect(screen.getByText("Already exists. It will be skipped.")).toBeInTheDocument();

    const renderedText = document.body.textContent ?? "";
    for (const secret of [
      "@private/server",
      "argument-secret",
      "environment-secret",
      "query-secret",
      "header-secret",
      "workspace-secret",
    ]) {
      expect(renderedText).not.toContain(secret);
    }
  });

  it("shows one source parse error while keeping another source usable", async () => {
    sourceResults = {
      "claude-code": new Error(
        "Invalid Claude Code MCP config at line 7: expected a server object.",
      ),
      windsurf: [
        {
          name: "Working server",
          enabled: true,
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          sourceTool: "windsurf",
        },
      ],
    };

    render(
      <McpServerImportDialog
        open
        existingNames={[]}
        onClose={vi.fn()}
        onImport={async () => undefined}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Claude Code: Invalid Claude Code MCP config at line 7: expected a server object.",
    );
    expect(screen.getByRole("group", { name: "Windsurf" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Working server/ })).toBeChecked();
  });

  it("submits the selected servers and overwrite choice, stays busy, then closes", async () => {
    sourceResults = {
      "claude-desktop": [
        {
          name: "Local files",
          enabled: true,
          transport: "stdio",
          command: "npx",
          args: ["server.js"],
          env: {},
          sourceTool: "claude-desktop",
        },
      ],
      cursor: [
        {
          name: "Research API",
          enabled: false,
          transport: "remote",
          url: "https://mcp.example.test/private?token=secret",
          headers: { Authorization: "Bearer secret" },
          sourceTool: "cursor",
        },
      ],
    };
    const importFinished = deferred<void>();
    const submitted: McpServerImportSelection[] = [];
    const closeEvents: string[] = [];

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <McpServerImportDialog
          open={open}
          existingNames={["Research API"]}
          onClose={() => {
            closeEvents.push("closed");
            setOpen(false);
          }}
          onImport={(selection) => {
            submitted.push(selection);
            return importFinished.promise;
          }}
        />
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const localCheckbox = await screen.findByRole("checkbox", { name: /Local files/ });
    await user.click(localCheckbox);
    await user.click(screen.getByRole("radio", { name: "Overwrite existing" }));

    expect(screen.getByText("Already exists. It will be overwritten.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Import selected" }));

    expect(submitted).toEqual([
      {
        duplicateAction: "overwrite",
        selected: [
          {
            name: "Research API",
            enabled: false,
            transport: "remote",
            url: "https://mcp.example.test/private?token=secret",
            headers: { Authorization: "Bearer secret" },
            sourceTool: "cursor",
          },
        ],
      },
    ]);
    expect(screen.getByRole("button", { name: "Importing..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(closeEvents).toEqual([]);

    await act(async () => importFinished.resolve());

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Import MCP servers" })).not.toBeInTheDocument();
    });
    expect(closeEvents).toEqual(["closed"]);
  });

  it("keeps an import failure in the dialog and restores its controls", async () => {
    sourceResults = {
      codex: [
        {
          name: "Broken save",
          enabled: true,
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: {},
          sourceTool: "codex",
        },
      ],
    };
    const closeEvents: string[] = [];

    render(
      <McpServerImportDialog
        open
        existingNames={[]}
        onClose={() => closeEvents.push("closed")}
        onImport={async () => {
          throw new Error("Could not save imported MCP servers.");
        }}
      />,
    );

    const user = userEvent.setup();
    await screen.findByRole("checkbox", { name: /Broken save/ });
    await user.click(screen.getByRole("button", { name: "Import selected" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save imported MCP servers.",
    );
    expect(screen.getByRole("dialog", { name: "Import MCP servers" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import selected" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(closeEvents).toEqual([]);
  });

  it("cancels without importing and drops late candidates before the next open", async () => {
    const staleResult = deferred<McpImportedServer[]>();
    sourceResults = { "claude-desktop": staleResult.promise };
    const submitted: McpServerImportSelection[] = [];
    const closeEvents: string[] = [];
    const props = {
      existingNames: [] as const,
      onClose: () => closeEvents.push("closed"),
      onImport: async (selection: McpServerImportSelection) => {
        submitted.push(selection);
      },
    };
    const { rerender } = render(<McpServerImportDialog {...props} open />);
    const user = userEvent.setup();
    await waitFor(() => expect(requestedSources).toHaveLength(5));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(<McpServerImportDialog {...props} open={false} />);

    sourceResults = {
      cursor: [
        {
          name: "Current candidate",
          enabled: true,
          transport: "remote",
          url: "https://current.example.test/mcp",
          headers: {},
          sourceTool: "cursor",
        },
      ],
    };
    rerender(<McpServerImportDialog {...props} open />);

    expect(
      await screen.findByRole("checkbox", { name: /Current candidate/ }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: "Skip existing" })).toBeChecked();

    await act(async () => {
      staleResult.resolve([
        {
          name: "Stale candidate",
          enabled: true,
          transport: "stdio",
          command: "node",
          args: ["old-server.js"],
          env: {},
          sourceTool: "claude-desktop",
        },
      ]);
    });

    expect(screen.queryByText("Stale candidate")).not.toBeInTheDocument();
    expect(submitted).toEqual([]);
    expect(closeEvents).toEqual(["closed"]);
  });
});
