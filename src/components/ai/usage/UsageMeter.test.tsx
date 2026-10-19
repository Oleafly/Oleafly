// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };
import { UsageMeter } from "./UsageMeter";

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

describe("UsageMeter", () => {
  it("opens the popover from the usage button", async () => {
    render(
      <UsageMeter
        snapshot={{ lastTurn: { inputTokens: 1200, outputTokens: 340 } }}
        tooltip={"Last run"}
        dataTour="ai-usage"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: en.header.usageAriaLabel }));
    expect(await screen.findByTestId("ai-usage-popover")).toBeInTheDocument();
    expect(screen.getByTestId("ai-run-usage")).toHaveTextContent("1,200");
  });
});
