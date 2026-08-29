// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDeadlines, refreshDeadlines } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { useDeadlines, useRefreshDeadlines } from "./deadlines";

vi.mock("@/lib/tauri", () => ({
  readDeadlines: vi.fn(),
  refreshDeadlines: vi.fn(),
}));

const mockRead = vi.mocked(readDeadlines);
const mockRefresh = vi.mocked(refreshDeadlines);

function Probe({ active = true }: { active?: boolean }) {
  const query = useDeadlines(active);
  const refresh = useRefreshDeadlines();
  return (
    <div>
      <p>venues:{query.data ? query.data.venues.length : "none"}</p>
      <p>generated:{query.data?.generatedAt ?? "none"}</p>
      <button type="button" onClick={() => refresh.mutate()}>
        refresh
      </button>
    </div>
  );
}

describe("deadlines queries", () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockRefresh.mockReset();
  });

  it("loads and parses the deadline dataset when the view is active", async () => {
    mockRead.mockResolvedValue(
      JSON.stringify({
        generated_at: "2026-08-01",
        venues: [{ id: "iclr" }, { id: "fse" }],
      }),
    );

    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("venues:2")).toBeInTheDocument();
    expect(screen.getByText("generated:2026-08-01")).toBeInTheDocument();
  });

  it("does not fetch while the view is inactive", async () => {
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <Probe active={false} />
      </QueryClientProvider>,
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("refresh triggers the CDN refresh and refetches the dataset", async () => {
    mockRead.mockResolvedValueOnce(JSON.stringify({ venues: [] }));
    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("venues:0")).toBeInTheDocument();

    mockRefresh.mockResolvedValue(undefined);
    mockRead.mockResolvedValue(
      JSON.stringify({ venues: [{ id: "new" }] }),
    );
    screen.getByText("refresh").click();

    expect(await screen.findByText("venues:1")).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledOnce();
  });
});
