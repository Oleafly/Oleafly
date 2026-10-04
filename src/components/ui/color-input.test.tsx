// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ColorInput } from "./color-input";

const FILL_LABEL = "Fill colour";

describe("ColorInput", () => {
  it("is a round colour field that reports changes", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn((event: { target: HTMLInputElement }) => event.target.value);
    render(<ColorInput ref={ref} aria-label={FILL_LABEL} value="#2563eb" onChange={onChange} className="size-9" />);
    const field = screen.getByLabelText(FILL_LABEL) as HTMLInputElement;

    fireEvent.change(field, { target: { value: "#ff0000" } });

    expect(ref.current).toBe(field);
    expect(field.type).toBe("color");
    expect(field.className).toContain("rounded-full");
    expect(field.className).toContain("size-9");
    expect(onChange).toHaveReturnedWith("#ff0000");
  });
});
