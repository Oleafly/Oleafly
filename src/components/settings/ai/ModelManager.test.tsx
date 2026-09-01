// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredModel } from "@/lib/tauri";
import { agentListModels } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { ModelManager } from "./ModelManager";

vi.mock("@/lib/tauri", () => ({
  agentListModels: vi.fn(),
}));
vi.mock("@/lib/agent-backend", () => ({
  agentErrorKind: (error: unknown) =>
    String(error).includes("401") ? "auth" : "network",
}));

const mockList = vi.mocked(agentListModels);

const MODELS: StoredModel[] = [
  { id: "gpt-alpha", name: "Alpha", enabled: true, source: "builtin" },
];

function renderManager(onChange = vi.fn()) {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ModelManager
        providerId="openai"
        models={MODELS}
        apiKey="sk-test"
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("ModelManager refresh", () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it("merges the fetched provider models into the stored list", async () => {
    mockList.mockResolvedValue([{ id: "gpt-beta", name: "Beta" }]);
    const onChange = renderManager();

    fireEvent.click(screen.getByTestId("ai-refresh-models-openai"));

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const next = onChange.mock.calls[0]?.[0] as StoredModel[];
    expect(next.map((m) => m.id)).toContain("gpt-beta");
  });

  it("reports an invalid key distinctly from a network failure", async () => {
    mockList.mockRejectedValue(new Error("HTTP 401"));
    renderManager();

    fireEvent.click(screen.getByTestId("ai-refresh-models-openai"));

    expect(await screen.findByText("Invalid API key.")).toBeInTheDocument();
  });
});
