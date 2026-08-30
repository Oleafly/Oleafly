// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalModeSelector } from "./ApprovalModeSelector";

describe("ApprovalModeSelector", () => {
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
