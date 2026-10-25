// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };
import { WebToggle } from "./WebToggle";

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

describe("WebToggle", () => {
  it("toggles web access and reports it to assistive technology", () => {
    const onChange = vi.fn();
    const { rerender } = render(<WebToggle on={false} onChange={onChange} />);
    const button = screen.getByRole("button", { name: en.web.ariaLabel });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<WebToggle on onChange={onChange} />);
    expect(screen.getByRole("button", { name: en.web.ariaLabel })).toHaveAttribute("data-state", "on");
  });

  it("marks the button and says why when the model needs a search key", async () => {
    const { rerender } = render(<WebToggle on={false} needsKey onChange={vi.fn()} />);
    expect(screen.queryByTestId("ai-web-needs-key")).toBeNull();
    rerender(<WebToggle on needsKey onChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: en.web.ariaLabel });
    expect(button).toHaveAttribute("data-needs-key", "true");
    expect(screen.getByTestId("ai-web-needs-key")).toBeInTheDocument();
    fireEvent.mouseEnter(button.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(en.web.needsKey);
  });
});
