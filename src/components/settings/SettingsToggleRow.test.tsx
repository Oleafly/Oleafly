// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsToggleRow } from "./SettingsToggleRow";

describe("SettingsToggleRow", () => {
  it("supports pointer and keyboard toggles in both states", () => {
    const onChange = vi.fn();
    const view = render(
      <SettingsToggleRow label="Feature" checked={false} onChange={onChange} />,
    );
    const toggle = screen.getByRole("switch", { name: "Feature" });

    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.keyDown(toggle, { key: " " });
    fireEvent.keyDown(toggle, { key: "ArrowRight" });
    expect(onChange.mock.calls).toEqual([[true], [true], [true]]);

    view.rerender(
      <SettingsToggleRow
        label="Feature"
        description="A useful setting."
        checked
        onChange={onChange}
      />,
    );
    expect(screen.getByText("A useful setting.")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
