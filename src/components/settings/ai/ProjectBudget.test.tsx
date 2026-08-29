// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetGet, budgetSet, usageSummary } from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { useFilesStore } from "@/store/files";
import { ProjectBudget } from "./ProjectBudget";

vi.mock("@/lib/tauri", () => ({
  budgetGet: vi.fn(),
  budgetSet: vi.fn(() => Promise.resolve()),
  usageSummary: vi.fn(),
  listProjects: vi.fn(),
}));

const mockGet = vi.mocked(budgetGet);
const mockSet = vi.mocked(budgetSet);
const mockUsage = vi.mocked(usageSummary);

function renderCard() {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <ProjectBudget />
    </QueryClientProvider>,
  );
}

describe("ProjectBudget", () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(5);
    mockSet.mockClear();
    mockUsage.mockReset().mockResolvedValue({
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 1.25,
    });
    useFilesStore.setState({ projectId: "proj-1", projectName: "Thesis" });
  });

  it("shows the spend so far against the saved budget", async () => {
    renderCard();
    expect(await screen.findByDisplayValue("5")).toBeInTheDocument();
    expect(await screen.findByText(/\$1\.25/)).toBeInTheDocument();
  });

  it("saves a new budget", async () => {
    renderCard();
    const input = await screen.findByLabelText("AI budget in US dollars");
    fireEvent.change(input, { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));

    await vi.waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith("proj-1", 12.5),
    );
  });

  it("clears the budget", async () => {
    renderCard();
    await screen.findByDisplayValue("5");
    fireEvent.click(screen.getByRole("button", { name: "Clear budget" }));

    await vi.waitFor(() => expect(mockSet).toHaveBeenCalledWith("proj-1", null));
  });
});
