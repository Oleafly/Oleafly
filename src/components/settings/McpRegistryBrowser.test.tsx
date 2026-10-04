// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import type { McpRegistrySearchResult } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({ mcpRegistrySearch: vi.fn() }));

vi.mock("@/lib/tauri", () => ({ mcpRegistrySearch: mocks.mcpRegistrySearch }));

import { McpRegistryBrowser } from "./McpRegistryBrowser";

const copy = enSettings.mcp.registry;
const config = { name: "files", enabled: true, transport: "stdio", command: "npx", args: ["files"] };

function page(overrides: Partial<McpRegistrySearchResult> = {}): McpRegistrySearchResult {
  return {
    servers: [
      {
        name: "io.example/files",
        description: "Reads local files",
        version: "1.2.0",
        status: "active",
        reviews: [
          {
            label: "npm",
            transport: "stdio",
            commandOrUrl: "npx",
            arguments: ["-y", "@example/files"],
            environmentVariableNames: ["FILES_ROOT", "FILES_TOKEN"],
            config: config as never,
            unsupportedReason: null,
          },
          {
            label: "docker",
            transport: "stdio",
            commandOrUrl: "docker",
            arguments: [],
            environmentVariableNames: [],
            config: null,
            unsupportedReason: "Docker images are not supported.",
          },
        ],
      },
      { name: "io.example/bare", description: null, version: "0.1.0", status: null, reviews: [] },
    ],
    nextCursor: null,
    warnings: [],
    ...overrides,
  };
}

function search(query: string) {
  fireEvent.change(screen.getByRole("textbox", { name: copy.searchLabel }), { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: /Search/ }));
}

beforeEach(() => {
  mocks.mcpRegistrySearch.mockReset();
});

describe("McpRegistryBrowser", () => {
  it("asks for a query before searching", () => {
    render(<McpRegistryBrowser onReview={vi.fn()} />);

    search("   ");

    expect(screen.getByRole("alert")).toHaveTextContent(copy.emptyQuery);
    expect(mocks.mcpRegistrySearch).not.toHaveBeenCalled();
  });

  it("lists entries with their transport details and reviews a supported one", async () => {
    mocks.mcpRegistrySearch.mockResolvedValue(page({ warnings: ["Registry returned a partial page."] }));
    const onReview = vi.fn();
    render(<McpRegistryBrowser onReview={onReview} />);

    search(" files ");

    expect(await screen.findByRole("heading", { name: "io.example/files" })).toBeInTheDocument();
    expect(mocks.mcpRegistrySearch).toHaveBeenCalledWith({ query: "files", cursor: null });
    expect(screen.getByText("Reads local files")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText(copy.argumentsLine.replace("{{args}}", "-y @example/files"))).toBeInTheDocument();
    expect(screen.getByText(copy.environmentLine.replace("{{names}}", "FILES_ROOT, FILES_TOKEN"))).toBeInTheDocument();
    expect(screen.getByText("Docker images are not supported.")).toBeInTheDocument();
    expect(screen.getByText(copy.unsupportedEntry)).toBeInTheDocument();
    expect(screen.getByText("Registry returned a partial page.").closest("ul")).toHaveAttribute("role", "status");

    fireEvent.click(screen.getByRole("button", { name: copy.review }));
    expect(onReview).toHaveBeenCalledWith(config);
  });

  it("appends the next page to the results", async () => {
    mocks.mcpRegistrySearch
      .mockResolvedValueOnce(page({ nextCursor: "cursor-2" }))
      .mockResolvedValueOnce(
        page({ servers: [{ name: "io.example/more", description: null, version: "2.0.0", status: null, reviews: [] }] }),
      );
    render(<McpRegistryBrowser onReview={vi.fn()} />);

    search("files");
    fireEvent.click(await screen.findByRole("button", { name: copy.loadMore }));

    expect(await screen.findByRole("heading", { name: "io.example/more" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "io.example/files" })).toBeInTheDocument();
    expect(mocks.mcpRegistrySearch).toHaveBeenLastCalledWith({ query: "files", cursor: "cursor-2" });
    expect(screen.queryByRole("button", { name: copy.loadMore })).toBeNull();
  });

  it("says when nothing matched and shows a failed search", async () => {
    mocks.mcpRegistrySearch.mockResolvedValueOnce(page({ servers: [] }));
    render(<McpRegistryBrowser onReview={vi.fn()} />);

    search("nothing");
    expect(await screen.findByText(copy.noResults)).toBeInTheDocument();

    mocks.mcpRegistrySearch.mockRejectedValueOnce(new Error("registry offline"));
    search("again");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("registry offline"));
  });
});
