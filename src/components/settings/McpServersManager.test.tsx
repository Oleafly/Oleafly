// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import type {
  McpManagedServer,
  McpServerConfig,
  McpServerValidation,
} from "@/lib/tauri";
import { McpServersManager } from "./McpServersManager";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const CONNECTED: McpManagedServer = {
  config: {
    name: "files",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/docs"],
    env: {},
  },
  validation: {
    name: "files",
    status: "connected",
    tool_count: 2,
    tools: [
      { name: "read_file", description: "Read a file" },
      { name: "list_directory", description: "List a directory" },
    ],
    error: null,
  },
};

const DISABLED: McpManagedServer = {
  config: {
    name: "docs-api",
    enabled: false,
    transport: "remote",
    url: "https://mcp.example.test/api",
    headers: { Authorization: "__stored__" },
  },
  validation: {
    name: "docs-api",
    status: "disabled",
    tool_count: 0,
    tools: [],
    error: null,
  },
};

const mockInvoke = vi.mocked(invoke);
let records: McpManagedServer[];
let validationCount: Record<string, number>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function connectedValidation(name: string): McpServerValidation {
  if (name === "files") return CONNECTED.validation;
  return {
    name,
    status: "connected",
    tool_count: 1,
    tools: [{ name: `${name}_search`, description: `Search ${name}` }],
    error: null,
  };
}

function renderManager() {
  return render(<McpServersManager />);
}

function ParentModal({ onClose }: { onClose: () => void }) {
  const { dialogRef } = useModalAccessibility<HTMLDivElement>(true, onClose);
  return (
    <div ref={dialogRef} role="dialog" aria-label="Settings" tabIndex={-1}>
      <McpServersManager />
    </div>
  );
}

describe("McpServersManager", () => {
  beforeEach(() => {
    records = [
      {
        ...CONNECTED,
        validation: {
          name: "files",
          status: "checking",
          tool_count: 0,
          tools: [],
          error: null,
        },
      },
      DISABLED,
    ];
    validationCount = {};
    mockInvoke.mockReset().mockImplementation(async (command, args) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_validate") {
        const { name } = args as { name: string };
        validationCount[name] = (validationCount[name] ?? 0) + 1;
        const validation = connectedValidation(name);
        records = records.map((record) =>
          record.config.name === name ? { ...record, validation } : record,
        );
        return validation;
      }
      if (command === "mcp_server_add") {
        const { server } = args as { server: McpServerConfig };
        const expected: McpServerConfig = {
          name: "papers",
          enabled: true,
          transport: "stdio",
          command: "node",
          args: ["server.js", "--root", "/tmp/papers"],
          env: { API_KEY: "secret" },
        };
        if (JSON.stringify(server) !== JSON.stringify(expected)) {
          throw new Error("The form sent the wrong stdio configuration.");
        }
        const next = {
          config: server,
          validation: server.enabled
            ? connectedValidation(server.name)
            : {
                name: server.name,
                status: "disabled" as const,
                tool_count: 0,
                tools: [],
                error: null,
              },
        };
        records = [...records, next];
        return next;
      }
      if (command === "mcp_server_update") {
        const { originalName, server } = args as {
          originalName: string;
          server: McpServerConfig;
        };
        if (
          originalName !== "docs-api" ||
          server.transport !== "remote" ||
          server.url !== "https://new.example.test/mcp" ||
          server.headers.Authorization !== "Bearer replacement"
        ) {
          throw new Error("The form sent the wrong remote configuration.");
        }
        const next = {
          config: server,
          validation: server.enabled
            ? connectedValidation(server.name)
            : {
                name: server.name,
                status: "disabled" as const,
                tool_count: 0,
                tools: [],
                error: null,
              },
        };
        records = records.map((record) =>
          record.config.name === originalName ? next : record,
        );
        return next;
      }
      if (command === "mcp_server_set_enabled") {
        const { name, enabled } = args as { name: string; enabled: boolean };
        const current = records.find((record) => record.config.name === name);
        if (!current) throw new Error(`Unknown server: ${name}`);
        const next: McpManagedServer = {
          config: { ...current.config, enabled } as McpServerConfig,
          validation: enabled
            ? {
                name,
                status: "connected",
                tool_count: 1,
                tools: [{ name: `${name}_search`, description: `Search ${name}` }],
                error: null,
              }
            : { name, status: "disabled", tool_count: 0, tools: [], error: null },
        };
        records = records.map((record) =>
          record.config.name === name ? next : record,
        );
        return next;
      }
      if (command === "mcp_server_remove") {
        const { name } = args as { name: string };
        records = records.filter((record) => record.config.name !== name);
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("checks enabled servers on load and shows status, tools, and disabled state", async () => {
    renderManager();

    expect(await screen.findByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("list_directory")).toBeInTheDocument();
    expect(screen.getByText("2 tools")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText("files_search")).not.toBeInTheDocument();
  });

  it("portals the server editor above the Settings modal", async () => {
    records = [];
    const { container } = renderManager();
    await screen.findByText("No servers added.");

    fireEvent.click(screen.getByRole("button", { name: "Add server" }));

    const dialog = screen.getByRole("dialog", { name: "Add MCP server" });
    expect(container).not.toContainElement(dialog);
    expect(dialog).toHaveClass("z-[120]");
    expect(dialog.previousElementSibling).toHaveClass("z-[120]");
    expect(screen.getByLabelText("Server name")).toBeEnabled();
  });

  it("keeps Tab navigation inside the server editor above a parent modal", async () => {
    records = [];
    const user = userEvent.setup();
    render(<ParentModal onClose={vi.fn()} />);
    await screen.findByText("No servers added.");

    await user.click(screen.getByRole("button", { name: "Add server" }));

    const dialog = screen.getByRole("dialog", { name: "Add MCP server" });
    const serverName = screen.getByLabelText("Server name");
    await waitFor(() => expect(serverName).toHaveFocus());
    await user.tab();

    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(serverName).not.toHaveFocus();
  });

  it("closes only the server editor when Escape is pressed", async () => {
    records = [];
    const user = userEvent.setup();
    const closeParent = vi.fn();
    render(<ParentModal onClose={closeParent} />);
    await screen.findByText("No servers added.");

    await user.click(screen.getByRole("button", { name: "Add server" }));
    await screen.findByRole("dialog", { name: "Add MCP server" });
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add MCP server" })).not.toBeInTheDocument();
    });
    expect(closeParent).not.toHaveBeenCalled();
  });

  it("validates enabled servers with bounded concurrency", async () => {
    const validations = Array.from({ length: 5 }, () => deferred<McpServerValidation>());
    records = validations.map((_, index) => ({
      config: { ...CONNECTED.config, name: `files-${index}` },
      validation: {
        name: `files-${index}`,
        status: "checking",
        tool_count: 0,
        tools: [],
        error: null,
      },
    }));
    const calls: string[] = [];
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_validate") {
        const { name } = args as { name: string };
        calls.push(name);
        return validations[Number(name.slice("files-".length))].promise;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    renderManager();

    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls).not.toContain("files-4");

    await act(async () => {
      validations[0].resolve(connectedValidation("files-0"));
    });
    await waitFor(() => expect(calls).toHaveLength(5));
    expect(calls).toContain("files-4");

    await act(async () => {
      for (let index = 1; index < validations.length; index += 1) {
        validations[index].resolve(connectedValidation(`files-${index}`));
      }
    });
  });

  it("refreshes enabled server status every minute while the page is open", async () => {
    records = [CONNECTED];
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_validate") {
        const { name } = args as { name: string };
        validationCount[name] = (validationCount[name] ?? 0) + 1;
        if (validationCount[name] === 1) return CONNECTED.validation;
        return {
          name,
          status: "error",
          tool_count: 0,
          tools: [],
          error: "Could not connect to the remote MCP server: connection refused.",
        } satisfies McpServerValidation;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const intervalSpy = vi.spyOn(window, "setInterval");
    const rendered = renderManager();
    await screen.findByText("read_file");
    const refresh = intervalSpy.mock.calls.find((call) => call[1] === 60_000)?.[0];

    expect(refresh).toBeTypeOf("function");
    await act(async () => {
      if (typeof refresh === "function") refresh();
    });

    expect(
      await screen.findByText("Could not connect to the remote MCP server: connection refused."),
    ).toBeInTheDocument();
    expect(validationCount.files).toBe(2);
    rendered.unmount();
    intervalSpy.mockRestore();
  });

  it("adds and validates a stdio server with exact arguments and environment values", async () => {
    records = [];
    renderManager();
    await screen.findByText("No servers added.");

    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    fireEvent.change(screen.getByLabelText("Server name"), { target: { value: "papers" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "node" } });
    fireEvent.change(screen.getByLabelText("Arguments"), {
      target: { value: "server.js\n--root\n/tmp/papers" },
    });
    fireEvent.change(screen.getByLabelText("Environment key 1"), {
      target: { value: "API_KEY" },
    });
    fireEvent.change(screen.getByLabelText("Environment value 1"), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add and validate" }));

    expect(await screen.findByText("papers_search")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable papers" })).toBeChecked();
  });

  it("validates a disabled server on demand while keeping its disabled state", async () => {
    records = [DISABLED];
    renderManager();
    await screen.findByText("docs-api");

    fireEvent.click(screen.getByRole("button", { name: "Validate docs-api" }));

    expect(await screen.findByText("docs-api_search")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable docs-api" })).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "docs-api is disabled. Last check found 1 tool.",
    );
  });

  it("shows a manual validation error without enabling a disabled server", async () => {
    records = [DISABLED];
    mockInvoke.mockImplementation(async (command) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_validate") {
        return {
          name: "docs-api",
          status: "error",
          tool_count: 0,
          tools: [],
          error: "Could not connect to the remote MCP server: connection refused.",
        } satisfies McpServerValidation;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    renderManager();
    await screen.findByText("docs-api");

    fireEvent.click(screen.getByRole("button", { name: "Validate docs-api" }));

    expect(
      await screen.findByText("Could not connect to the remote MCP server: connection refused."),
    ).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable docs-api" })).not.toBeChecked();
  });

  it("edits a disabled remote server without connecting automatically", async () => {
    records = [DISABLED];
    renderManager();
    await screen.findByText("docs-api");

    fireEvent.click(screen.getByRole("button", { name: "Edit docs-api" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Remote URL" }), {
      target: { value: "https://new.example.test/mcp" },
    });
    fireEvent.change(screen.getByLabelText("Header value 1"), {
      target: { value: "Bearer replacement" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("https://new.example.test/mcp")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText("docs-api_search")).not.toBeInTheDocument();
  });

  it("ignores an older validation result after an edit completes", async () => {
    const oldValidation = deferred<McpServerValidation>();
    const edited: McpManagedServer = {
      config: {
        name: "files",
        enabled: true,
        transport: "stdio",
        command: "new-node",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/docs"],
        env: {},
      },
      validation: {
        name: "files",
        status: "connected",
        tool_count: 1,
        tools: [{ name: "new_search", description: "Search the new server" }],
        error: null,
      },
    };
    records = [{ ...CONNECTED, validation: { ...CONNECTED.validation, status: "checking", tools: [], tool_count: 0 } }];
    mockInvoke.mockImplementation(async (command) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_validate") return oldValidation.promise;
      if (command === "mcp_server_update") return edited;
      throw new Error(`Unexpected command: ${command}`);
    });
    renderManager();
    await screen.findByText("files");

    fireEvent.click(screen.getByRole("button", { name: "Edit files" }));
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "new-node" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and validate" }));
    expect(await screen.findByText("new_search")).toBeInTheDocument();

    oldValidation.resolve(CONNECTED.validation);

    await waitFor(() => expect(screen.getByText("new_search")).toBeInTheDocument());
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("persists enable changes and replaces the status returned by the backend", async () => {
    records = [CONNECTED];
    renderManager();
    await screen.findByText("read_file");

    fireEvent.click(screen.getByRole("switch", { name: "Enable files" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Enable files" })).not.toBeChecked(),
    );
    expect(screen.getByText("Disabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Enable files" }));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Enable files" })).toBeChecked(),
    );
    expect(await screen.findByText("files_search")).toBeInTheDocument();
  });

  it("ignores an older validation result after the server is disabled", async () => {
    const oldValidation = deferred<McpServerValidation>();
    records = [{ ...CONNECTED, validation: { ...CONNECTED.validation, status: "checking", tools: [], tool_count: 0 } }];
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_validate") return oldValidation.promise;
      if (command === "mcp_server_set_enabled") {
        const { name } = args as { name: string };
        return {
          config: { ...CONNECTED.config, enabled: false },
          validation: { name, status: "disabled", tool_count: 0, tools: [], error: null },
        } satisfies McpManagedServer;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    renderManager();
    await screen.findByText("files");

    fireEvent.click(screen.getByRole("switch", { name: "Enable files" }));
    await waitFor(() => expect(screen.getByText("Disabled")).toBeInTheDocument());

    oldValidation.resolve(CONNECTED.validation);

    await waitFor(() => expect(screen.getByText("Disabled")).toBeInTheDocument());
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });

  it("surfaces the precise error from an on-demand validation", async () => {
    records = [CONNECTED];
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_validate") {
        const { name } = args as { name: string };
        validationCount[name] = (validationCount[name] ?? 0) + 1;
        if (validationCount[name] === 1) return CONNECTED.validation;
        return {
          name,
          status: "error",
          tool_count: 0,
          tools: [],
          error: 'Command "missing-mcp" was not found. Check the command and PATH.',
        } satisfies McpServerValidation;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    renderManager();
    await screen.findByText("read_file");

    fireEvent.click(screen.getByRole("button", { name: "Validate files" }));

    expect(
      await screen.findByText('Command "missing-mcp" was not found. Check the command and PATH.'),
    ).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("keeps a rejected add open and does not add the unreachable server", async () => {
    records = [];
    mockInvoke.mockImplementation(async (command) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_add") {
        throw new Error("Could not start 'missing-mcp': command not found.");
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    renderManager();
    await screen.findByText("No servers added.");

    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    fireEvent.change(screen.getByLabelText("Server name"), { target: { value: "broken" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "missing-mcp" } });
    fireEvent.click(screen.getByRole("button", { name: "Add and validate" }));

    expect(
      await screen.findByText("Could not start 'missing-mcp': command not found."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add MCP server" })).toBeInTheDocument();
    expect(screen.getByText("No servers added.")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Enable broken" })).not.toBeInTheDocument();
  });

  it("removes a server only after confirmation", async () => {
    records = [DISABLED];
    renderManager();
    await screen.findByText("docs-api");

    fireEvent.click(screen.getByRole("button", { name: "Remove docs-api" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Remove server?" });
    expect(within(confirmation).getByText(/docs-api/)).toBeInTheDocument();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Remove server" }));

    await waitFor(() => expect(screen.queryByText("docs-api")).not.toBeInTheDocument());
    expect(screen.getByText("No servers added.")).toBeInTheDocument();
  });

  it("does not apply an old validation after a server name is removed and reused", async () => {
    const oldValidation = deferred<McpServerValidation>();
    const replacement: McpManagedServer = {
      config: {
        name: "files",
        enabled: true,
        transport: "stdio",
        command: "new-node",
        args: [],
        env: {},
      },
      validation: {
        name: "files",
        status: "connected",
        tool_count: 1,
        tools: [{ name: "new_search", description: "Search the replacement server" }],
        error: null,
      },
    };
    records = [{ ...CONNECTED, validation: { ...CONNECTED.validation, status: "checking", tools: [], tool_count: 0 } }];
    mockInvoke.mockImplementation(async (command) => {
      if (command === "mcp_servers_list") return records;
      if (command === "mcp_server_validate") return oldValidation.promise;
      if (command === "mcp_server_remove") {
        records = [];
        return undefined;
      }
      if (command === "mcp_server_add") {
        records = [replacement];
        return replacement;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    renderManager();
    await screen.findByText("files");

    fireEvent.click(screen.getByRole("button", { name: "Remove files" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog", { name: "Remove server?" })).getByRole("button", {
        name: "Remove server",
      }),
    );
    await screen.findByText("No servers added.");

    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    fireEvent.change(screen.getByLabelText("Server name"), { target: { value: "files" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "new-node" } });
    fireEvent.click(screen.getByRole("button", { name: "Add and validate" }));
    expect(await screen.findByText("new_search")).toBeInTheDocument();

    oldValidation.resolve(CONNECTED.validation);

    await waitFor(() => expect(screen.getByText("new_search")).toBeInTheDocument());
    expect(screen.queryByText("read_file")).not.toBeInTheDocument();
  });
});
