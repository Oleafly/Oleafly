// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsToggleRow } from "./SettingsToggleRow";

const LABEL = "Feature";
const DESCRIPTION = "A useful setting.";

describe("SettingsToggleRow", () => {
  it("supports pointer and keyboard toggles in both states", () => {
    const onChange = vi.fn();
    const view = render(
      <SettingsToggleRow label={LABEL} checked={false} onChange={onChange} />,
    );
    const toggle = screen.getByRole("switch", { name: LABEL });

    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.keyDown(toggle, { key: " " });
    fireEvent.keyDown(toggle, { key: "ArrowRight" });
    expect(onChange.mock.calls).toEqual([[true], [true], [true]]);

    view.rerender(
      <SettingsToggleRow
        label={LABEL}
        description={DESCRIPTION}
        checked
        onChange={onChange}
      />,
    );
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});
