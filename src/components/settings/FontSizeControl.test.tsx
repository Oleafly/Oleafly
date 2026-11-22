// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { allowRadixSelect, chooseOption } from "@/features/collab/tests/select";
import { loadNamespace } from "@/i18n";
import { FontSizeControl } from "./FontSizeControl";

const RANGE = { min: 10, max: 40, step: 1 };
const clamp = (value: number) => Math.min(40, Math.max(10, value));

function setup(value: number, automatic?: { label: string; value: number; size: number }) {
  const onChange = vi.fn();
  const view = render(
    <FontSizeControl
      value={value}
      onChange={onChange}
      presets={[12, 14, 16]}
      range={RANGE}
      clamp={clamp}
      customOption="Custom"
      customLabel="Custom size"
      ariaLabel="Font size"
      triggerTestId="size-trigger"
      customTestId="size-custom"
      automatic={automatic}
    />,
  );
  return { onChange, view };
}

beforeAll(async () => {
  await loadNamespace("settings");
});

beforeEach(() => {
  allowRadixSelect();
});

describe("FontSizeControl", () => {
  it("picks a preset size", async () => {
    const user = userEvent.setup();
    const { onChange } = setup(14);
    expect(screen.queryByTestId("size-custom")).not.toBeInTheDocument();
    await chooseOption(user, "Font size", "16px");
    expect(onChange).toHaveBeenCalledWith(16);
  });

  it("shows the number field for Custom and for a size that is not a preset", async () => {
    const user = userEvent.setup();
    const { onChange, view } = setup(14);
    await chooseOption(user, "Font size", "Custom");
    const field = screen.getByRole("spinbutton", { name: "Custom size" });
    fireEvent.change(field, { target: { value: "19" } });
    expect(onChange).toHaveBeenCalledWith(19);
    view.unmount();
    setup(19);
    expect(screen.getByTestId("size-custom")).toHaveValue(19);
  });

  it("offers an automatic size first and seeds Custom with the size it stands for", async () => {
    const user = userEvent.setup();
    const automatic = { label: "Match editor", value: 0, size: 15 };
    const { onChange, view } = setup(0, automatic);
    expect(screen.getByTestId("size-trigger")).toHaveTextContent("Match editor");
    await chooseOption(user, "Font size", "Custom");
    expect(screen.getByRole("spinbutton", { name: "Custom size" })).toHaveValue(15);
    view.unmount();
    expect(onChange).not.toHaveBeenCalled();
    const fixed = setup(16, automatic);
    await chooseOption(user, "Font size", "Match editor");
    expect(fixed.onChange).toHaveBeenCalledWith(0);
  });
});
