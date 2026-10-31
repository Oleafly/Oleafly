// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };
import { UsagePopover } from "./UsagePopover";

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UsagePopover", () => {
  it("shows context, last run and chat totals", () => {
    render(
      <UsagePopover
        snapshot={{
          context: { used: 160_000, size: 200_000 },
          lastTurn: { inputTokens: 1200, outputTokens: 340, steps: 3 },
          session: { inputTokens: 5000, outputTokens: 1000, turns: 2, steps: 6, cachedReadTokens: 800 },
        }}
      />,
    );
    expect(screen.getByTestId("usage-context")).toHaveTextContent("160,000");
    const run = screen.getByTestId("ai-run-usage");
    expect(run).toHaveTextContent("1,200");
    expect(run).toHaveTextContent("340");
    expect(screen.getByTestId("ai-chat-usage")).toHaveTextContent("6,000");
    expect(screen.getByTestId("ai-chat-usage")).toHaveTextContent(en.usage.cacheRead);
  });

  it("shows plan windows with reset times and status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
    render(
      <UsagePopover
        snapshot={{
          plan: {
            windows: [
              { id: "5h", label: "5 hours", utilization: 1, status: "blocked", resetsAt: Date.parse("2026-10-18T13:00:00Z") },
            ],
          },
        }}
      />,
    );
    const plan = screen.getByTestId("usage-plan");
    expect(plan).toHaveTextContent("in 3 hours");
    expect(plan).toHaveTextContent(en.usage.windowBlocked);
  });

  it("gives every bar a name and a value for screen readers", () => {
    render(
      <UsagePopover
        snapshot={{
          context: { used: 160_000, size: 200_000 },
          plan: { windows: [{ id: "week", label: "Weekly", utilization: 0.62, status: "ok" }] },
          budget: { spentUsd: 4, limitUsd: 10 },
        }}
      />,
    );
    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((bar) => bar.getAttribute("aria-label"))).toEqual([en.usage.context, "Weekly", en.usage.budget]);
    expect(bars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["80", "62", "40"]);
    expect(bars[0].firstElementChild?.className).toContain("bg-amber-500");
    expect(bars[1].firstElementChild?.className).toContain("bg-primary");
  });

  it("shows provider credit and the project budget", () => {
    render(
      <UsagePopover
        snapshot={{
          credit: { remainingUsd: 12.5, limitUsd: 20, source: "openrouter" },
          budget: { spentUsd: 4, limitUsd: 10 },
        }}
      />,
    );
    expect(screen.getByTestId("usage-credit")).toHaveTextContent("$12.50");
    expect(screen.getByTestId("usage-budget")).toHaveTextContent("$4.00");
  });

  it("lists notes such as trimmed history", () => {
    render(<UsagePopover snapshot={{ notes: ["Only the last 24 turns of this chat were sent to the model."] }} />);
    expect(screen.getByTestId("usage-notes")).toHaveTextContent("Only the last 24 turns");
    expect(screen.getByText(en.usage.empty)).toBeInTheDocument();
  });

  it("renders a refreshed plan report and asks for a refresh", () => {
    const onRefreshPlan = vi.fn();
    const { rerender } = render(
      <UsagePopover snapshot={{ planMarkdown: "**Plan** usage" }} onRefreshPlan={onRefreshPlan} />,
    );
    expect(screen.getByTestId("usage-plan-markdown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.usage.refreshPlan }));
    expect(onRefreshPlan).toHaveBeenCalledOnce();
    rerender(<UsagePopover snapshot={{}} onRefreshPlan={onRefreshPlan} refreshing />);
    expect(screen.getByRole("button", { name: en.usage.refreshing })).toBeDisabled();
  });

  it("merges extras loaded when it opens", async () => {
    const loadExtras = vi.fn(async () => ({ budget: { spentUsd: 1, limitUsd: 5 } }));
    render(<UsagePopover snapshot={{ lastTurn: { inputTokens: 1, outputTokens: 1 } }} loadExtras={loadExtras} />);
    expect(await screen.findByTestId("usage-budget")).toBeInTheDocument();
    expect(loadExtras).toHaveBeenCalledOnce();
  });
});
