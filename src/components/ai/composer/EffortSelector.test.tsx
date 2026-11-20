// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };
import { EffortSelector } from "./EffortSelector";

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

function open() {
  fireEvent.pointerDown(screen.getByTestId("ai-effort-selector"), { button: 0, ctrlKey: false, pointerType: "mouse" });
}

describe("EffortSelector", () => {
  it("hides itself when the model has no effort choices", () => {
    const { container } = render(<EffortSelector choices={[]} value={undefined} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Auto for a level the model does not offer", () => {
    render(<EffortSelector choices={["low", "high"]} value="max" onChange={vi.fn()} />);
    expect(screen.getByTestId("ai-effort-selector")).toHaveAccessibleName(
      en.effort.ariaLabel.replace("{{level}}", en.effort.auto),
    );
  });

  it("names the active level in its tooltip, so the level shows when the composer hides the label", () => {
    vi.useFakeTimers();
    try {
      render(<EffortSelector choices={["low", "medium", "high"]} value="medium" onChange={vi.fn()} />);
      fireEvent.mouseEnter(screen.getByTestId("ai-effort-selector").parentElement as Element);
      act(() => vi.advanceTimersByTime(400));
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toHaveTextContent(en.effort.ariaLabel.replace("{{level}}", en.effort.levels.medium));
      expect(tooltip).toHaveTextContent(en.effort.tooltip);
    } finally {
      vi.useRealTimers();
    }
  });

  it("picks a level and goes back to Auto", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<EffortSelector choices={["low", "medium", "high"]} value={undefined} onChange={onChange} />);
    open();
    fireEvent.click(await screen.findByRole("menuitemradio", { name: en.effort.levels.high }));
    expect(onChange).toHaveBeenLastCalledWith("high");
    rerender(<EffortSelector choices={["low", "medium", "high"]} value="high" onChange={onChange} />);
    open();
    fireEvent.click(await screen.findByRole("menuitemradio", { name: new RegExp(en.effort.auto) }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
