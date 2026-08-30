// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalModeSelector } from "./ApprovalModeSelector";

describe("ApprovalModeSelector", () => {
  it.each([
    ["ask-for-approval", "bg-amber-500/10", true],
    ["approve-for-me", "bg-muted/40", false],
    ["full-access", "bg-orange-500/10", true],
    ["custom", "bg-muted/40", false],
  ] as const)("styles %s with only its intended selection color", (mode, expectedClass, colored) => {
    render(
      <ApprovalModeSelector
        mode={mode}
        onChange={vi.fn()}
        onOpenProjectRules={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Approval mode\./u });
    expect(trigger).toHaveClass(expectedClass);
    const tintPattern = /\b(?:bg|border|text)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|primary|destructive)(?:-|\/|\b)/u;
    expect(tintPattern.test(trigger.className)).toBe(colored);
    if (!colored) {
      expect(trigger).toHaveClass("border-border/70", "bg-muted/40");
    }
  });

  it("keeps the full active mode in a tooltip when its label collapses", async () => {
    render(
      <ApprovalModeSelector
        mode="custom"
        onChange={vi.fn()}
        onOpenProjectRules={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Approval mode. Custom (approvals.toml)",
    });
    expect(trigger).toHaveClass("ai-composer-approval-trigger");
    const label = screen.getByText("Custom (approvals.toml)");
    expect(label).toHaveClass("ai-composer-approval-value");
    expect(label).not.toHaveClass("hidden");

    fireEvent.mouseEnter(trigger.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Custom (approvals.toml)",
    );
  });

  it("gives the selector and shield comfortable left spacing", () => {
    render(
      <ApprovalModeSelector
        mode="approve-for-me"
        onChange={vi.fn()}
        onOpenProjectRules={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Approval mode. Approve for me",
    });
    expect(trigger.closest(".ai-composer-approval")).toHaveClass("ml-1.5");
    expect(trigger).toHaveClass("pl-2.5", "pr-2");
  });

  it("shows the active mode and exposes exactly four choices", () => {
    render(
      <ApprovalModeSelector
        mode="approve-for-me"
        onChange={vi.fn()}
        onOpenProjectRules={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approval mode. Approve for me" }));

    expect(screen.getByRole("button", { name: "Ask for approval" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve for me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom (approvals.toml)" })).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.getAttribute("aria-pressed") !== null),
    ).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Approve for me" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Full access" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switches to the selected mode", () => {
    const onChange = vi.fn();
    render(
      <ApprovalModeSelector
        mode="approve-for-me"
        onChange={onChange}
        onOpenProjectRules={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approval mode. Approve for me" }));
    fireEvent.click(screen.getByRole("button", { name: "Full access" }));

    expect(onChange).toHaveBeenCalledWith("full-access");
  });

  it("opens project approval settings from Custom mode", () => {
    const onOpenProjectRules = vi.fn();
    render(
      <ApprovalModeSelector
        mode="custom"
        onChange={vi.fn()}
        onOpenProjectRules={onOpenProjectRules}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Approval mode. Custom (approvals.toml)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit project rules" }));

    expect(onOpenProjectRules).toHaveBeenCalledOnce();
  });

  it("cannot switch modes while disabled", () => {
    render(
      <ApprovalModeSelector
        mode="ask-for-approval"
        onChange={vi.fn()}
        onOpenProjectRules={vi.fn()}
        disabled
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Approval mode. Ask for approval",
    });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("button", { name: "Full access" })).not.toBeInTheDocument();
  });

  it("closes an open mode menu when it becomes disabled", () => {
    const onChange = vi.fn();
    const props = {
      mode: "approve-for-me" as const,
      onChange,
      onOpenProjectRules: vi.fn(),
    };
    const rendered = render(<ApprovalModeSelector {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Approval mode. Approve for me" }));
    expect(screen.getByRole("button", { name: "Full access" })).toBeInTheDocument();

    rendered.rerender(<ApprovalModeSelector {...props} disabled />);

    expect(screen.queryByRole("button", { name: "Full access" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
