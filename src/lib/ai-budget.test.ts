// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetGet, usageSummary } from "@/lib/tauri";
import { useToastStore } from "@/store/toast";
import { checkProjectBudget } from "./ai-budget";

vi.mock("@/lib/tauri", () => ({
  budgetGet: vi.fn(),
  usageSummary: vi.fn(),
}));

const mockBudget = vi.mocked(budgetGet);
const mockUsage = vi.mocked(usageSummary);

function totals(costUsd: number) {
  return { input_tokens: 0, output_tokens: 0, cost_usd: costUsd };
}

describe("checkProjectBudget", () => {
  beforeEach(() => {
    mockBudget.mockReset();
    mockUsage.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it("passes with no budget configured", async () => {
    mockBudget.mockResolvedValue(null);
    await expect(checkProjectBudget("p")).resolves.toBe("ok");
    expect(mockUsage).not.toHaveBeenCalled();
  });

  it("warns once past 80 percent of the budget", async () => {
    mockBudget.mockResolvedValue(10);
    mockUsage.mockResolvedValue(totals(8.5));

    await expect(checkProjectBudget("p")).resolves.toBe("warned");
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: "info" });
  });

  it("blocks the run at or past the budget", async () => {
    mockBudget.mockResolvedValue(10);
    mockUsage.mockResolvedValue(totals(10));

    await expect(checkProjectBudget("p")).resolves.toBe("blocked");
    expect(useToastStore.getState().toasts[0]).toMatchObject({ kind: "error" });
  });

  it("never blocks when the ledger is unreachable", async () => {
    mockBudget.mockRejectedValue(new Error("no backend"));
    await expect(checkProjectBudget("p")).resolves.toBe("ok");
  });
});
